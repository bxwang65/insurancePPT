import fs from "fs";
import path from "path";
import crypto from "crypto";
import { GeminiExtractor, CACHE_DIR, getCachePath, type TokenUsage } from "./gemini-client.ts";
import { OpenAIExtractor } from "./openai-extractor.ts";
import { SAVINGS_PLAN_SYSTEM_PROMPT, CI_PLAN_SYSTEM_PROMPT, IUL_SYSTEM_PROMPT, buildSavingsPrompt } from "./prompts.ts";
import { PdfPreprocessor } from "./pdf-preprocessor.ts";
import { SavingsPlanExtractionSchema, type SavingsPlanExtraction } from "../schemas/savings-plan.ts";
import { CiPlanExtractionSchema, type CiPlanExtraction } from "../schemas/critical-illness.ts";
import { IulExtractionSchema, type IulExtraction } from "../schemas/iul.ts";
import { extractSavingsTables } from "./savings-table-parser.ts";
import { tryFastExtraction } from "./fast-path.ts";
import { toSavingsPlanFromSignature } from "./fast-path-adapter.ts";
import { getSignatureById } from "./signatures/registry.ts";
import type { PlanType } from "../pipeline/types.ts";

/** Raw LLM JSON output before schema validation */
interface RawLLMOutput {
  product_name?: string;
  product_type?: string;
  insured?: { name?: string; age?: number; gender?: string };
  benefit_illustration?: unknown[];
  [key: string]: unknown;
}

function inferPlanType(raw: RawLLMOutput): PlanType {
  const t = (raw.product_type || "").toString().toLowerCase();
  if (t.includes("ci") || t.includes("critical")) return "ci";
  if (t.includes("iul") || t.includes("universal")) return "iul";

  const rows = Array.isArray(raw.benefit_illustration) ? raw.benefit_illustration as Array<Record<string, unknown>> : [];
  const hasSavingsFields = rows.some((r) =>
    r.total_surrender_value != null || r.guaranteed_cash_value != null || r.reversionary_bonus != null
  );
  const hasCiFields = rows.some((r) =>
    r.surrender_value_total != null || r.death_benefit_total != null
  );
  const hasIulFields = rows.some((r) =>
    r.cash_value != null || r.account_value != null
  );

  if (hasIulFields) return "iul";
  if (hasSavingsFields) return "savings";
  if (hasCiFields) return "ci";

  const policy = (raw.policy || {}) as Record<string, unknown>;
  if (policy.index_account_rate != null || policy.capital_partition != null) return "iul";
  if (policy.sum_insured != null) return "ci";
  return "savings";
}
export type PlanData = SavingsPlanExtraction | CiPlanExtraction | IulExtraction;

export interface ExtractionResult {
  pdfPath: string;
  productName: string;
  planType: PlanType;
  status: "success" | "cached" | "error";
  data?: PlanData;
  usage?: TokenUsage;
  error?: string;
  durationMs: number;
}

export interface ExtractionConfig {
  apiKey: string;
  provider?: "gemini" | "deepseek" | "openai" | "minimax";
  useCache?: boolean;
  cacheDir?: string;
}

const CACHE_VERSION = 3;

const PROMPTS: Record<PlanType, string> = {
  savings: SAVINGS_PLAN_SYSTEM_PROMPT,
  ci: CI_PLAN_SYSTEM_PROMPT,
  iul: IUL_SYSTEM_PROMPT,
};

export class ExtractionOrchestrator {
  private extractor: GeminiExtractor | null;
  private useCache: boolean;
  private cacheDir: string;

  constructor(config: ExtractionConfig) {
    // 关键: 按 provider 选 extractor
    //   gemini (默认) → GeminiExtractor
    //   deepseek/openai/minimax → OpenAIExtractor (OpenAI 兼容协议)
    // API key 缺失时跳过构造, 仍能跑 signature fast-path
    if (config.apiKey) {
      if (config.provider && config.provider !== "gemini") {
        this.extractor = new OpenAIExtractor({
          apiKey: config.apiKey,
          provider: config.provider as any,
        }) as any;
      } else {
        this.extractor = new GeminiExtractor({ apiKey: config.apiKey, model: "gemini-2.5-flash" });
      }
    } else {
      this.extractor = null as any;
    }
    this.useCache = config.useCache ?? true;
    this.cacheDir = config.cacheDir || CACHE_DIR;
  }

  async extractPlan(pdfPath: string, type: PlanType = "savings"): Promise<ExtractionResult> {
    const start = Date.now();
    const absPath = path.resolve(pdfPath);
    if (!fs.existsSync(absPath)) {
      return { pdfPath: absPath, productName: "unknown", planType: type, status: "error", error: "File not found", durationMs: Date.now() - start };
    }

    // Check cache
    if (this.useCache) {
      const cached = this.loadFromCache(absPath);
      if (cached) return { ...cached, durationMs: Date.now() - start };
    }

    // === Signature Fast Path: 命中后跳过 LLM ===
    // 关键修复: 原本只支持 savings, 现在 ci/iul 也能命中
    if (type === "savings" || type === "ci" || type === "iul") {
      try {
        const fast = await tryFastExtraction(absPath, { minConfidence: 0.7 });
        if (fast.matched && fast.data && fast.signature) {
          // 按 plan type 路由到对应 schema
          const sigPlanType = fast.signature.planType;
          if (sigPlanType === "savings") {
            const plan = toSavingsPlanFromSignature(fast.data, fast.signature.id, fast.signature.productName, fast.signature.currency);
            // Debug: 看转换结果
            console.log(`[orch] ${path.basename(absPath)}: no_withdraw=${Object.keys(fast.data.no_withdraw || {}).length} → benefit_illustration=${plan.benefit_illustration.length}, withdraw=${Object.keys(fast.data.withdraw || {}).length} → withdrawal=${plan.withdrawal_illustration.length}`);
            // 年龄兜底: 签名提取未提供年龄时, 从PDF首页文本提取
            if (!plan.insured.age || plan.insured.age === 0) {
              try {
                const scriptPath = path.resolve(import.meta.dir, "../../scripts/extract_age.py");
                const proc = Bun.spawn(["python3.11", scriptPath, absPath]);
                const ageStr = await new Response(proc.stdout).text();
                const age = parseInt(ageStr.trim(), 10);
                if (age > 0 && age < 120) { plan.insured.age = age; console.log('[orch] 年龄兜底: '+age); }
              } catch (e) { console.warn('[orch] 年龄兜底失败:', e); }
            }
            // fitz 始终覆盖签名数据 (列映射以脚本为准)
            try {
              const ft = await extractSavingsTables(absPath);
              if (ft.benefit_illustration.length > 20) {
                plan.benefit_illustration = ft.benefit_illustration as any;
                console.log(`[orch] fitz 覆盖 benefit: ${ft.benefit_illustration.length} rows`);
              }
              if (ft.withdrawal_illustration.length > 0) {
                plan.withdrawal_illustration = ft.withdrawal_illustration as any;
                console.log(`[orch] fitz 覆盖 withdrawal: ${ft.withdrawal_illustration.length} rows`);
              }
            } catch (_) { /* fitz 失败则用签名数据 */ }
            const validated = SavingsPlanExtractionSchema.safeParse(plan);
            if (validated.success) {
              if (this.useCache) this.saveToCache(absPath, validated.data);
              return {
                pdfPath: absPath, productName: validated.data.product_name,
                planType: "savings", status: "success", data: validated.data,
                durationMs: Date.now() - start,
              };
            }
            // 兼容路径: 注入 _meta 写 cache
            if (this.useCache) this.saveToCache(absPath, plan);
            return {
              pdfPath: absPath, productName: plan.product_name,
              planType: "savings", status: "success", data: plan as any,
              durationMs: Date.now() - start,
            };
          } else if (sigPlanType === "ci") {
            // CI: 把 SignatureExtractionResult 包成 SavingsPlanExtraction 兼容 schema
            // 使用 loose typed 变量避免 TypeScript 严格属性检查
            const s = fast.data.summary as any;
            const fd = fast.data as any;
            const benefitIllustration = (fd.benefit_illustration || fd.no_withdraw ? Object.values(fd.no_withdraw || {}).map((r: any) => ({ Y: r.Y, Paid: r.Paid, Guar_CV: r.Guar_CV, Rev: r.Rev, Term: r.Term, Total: r.Total })) : []);
            const wrapped = {
              product_name: fast.signature.productName,
              product_type: "ci" as const,
              insured: {
                name: s?.insured_name || "VIP",
                age: Number(s?.insured_age || 0),
                gender: s?.insured_gender || "",
                smoker: null,
              },
              policy: {
                product_name: fast.signature.productName,
                currency: s?.currency || fast.signature.currency || "USD",
                sum_insured: s?.sum_insured || null,
                basic_sum_insured: s?.sum_insured || null,
                // 关键: annual_premium 可能 null, 用 annual_premium_with_levy / cashflow table 兜底
                annual_premium: (() => {
                  if (s?.annual_premium && s.annual_premium > 0) return s.annual_premium;
                  if (s?.annual_premium_with_levy && s.annual_premium_with_levy > 0) return s.annual_premium_with_levy;
                  const y1 = benefitIllustration.find((r: any) => r.Y === 1);
                  return y1?.Paid || 0;
                })(),
                premium_payment_period: `${s?.payment_years || 10}年`,
                coverage_period: s?.coverage_period || "至100岁",
                total_premium_with_levy: s?.annual_premium_with_levy || null,
              },
              // CI 需要的 coverage_items (按 type 推断默认, 必带 source_page)
              coverage_items: (s?.coverage_items?.length ? s.coverage_items : [
                { label: "严重疾病保障", amount: s?.sum_insured || 0, percentage: 100, description: "首次确诊严重疾病" },
                { label: "早期危疾保障", amount: Math.round((s?.sum_insured || 0) * 0.5), percentage: 50, description: "首次确诊早期危疾" },
                { label: "保费豁免", amount: 0, percentage: 100, description: "确诊后豁免后续保费" },
              ]).map((item: any) => ({ ...item, source_page: item.source_page || 2 })),
              base_sum_insured: s?.sum_insured || null,
              upgrade_benefit_amount: Math.round((s?.sum_insured || 0) * 0.3),
              upgrade_benefit_years: 10,
              major_ci_count: 100,
              early_ci_count: 50,
              benefit_illustration: benefitIllustration.map((r: any) => ({
                policy_year: r.Y,
                total_premium_paid: r.Paid,
                guaranteed_cash_value: r.Guar_CV,
                reversionary_bonus: r.Rev,
                terminal_dividend: r.Term,
                total_surrender_value: r.Total,
                death_benefit: r.Total,  // CI: death benefit = 保额
              })),
              withdrawal_illustration: [],
              sales_insights: {
                target_customer: "高净值客户",
                key_selling_points: ["多重危疾保障", "保额定期还原", "保费豁免保障"],
                unique_advantages: `保额 ${s?.sum_insured?.toLocaleString() || ""} ${s?.currency || "USD"}`,
                suggested_narrative: "全方位危疾保障方案",
                highlight_numbers: [],
              },
              _meta: {
                source: "signature_fast_path" as const,
                signatureId: fast.signature.id,
                parser: fd?.diagnostics?.parser || "ci-signature",
                warnings: fd?.diagnostics?.warnings || [],
              },
            };
            if (this.useCache) this.saveToCache(absPath, wrapped);
            return {
              pdfPath: absPath, productName: wrapped.product_name,
              planType: "ci", status: "success", data: wrapped as any,
              durationMs: Date.now() - start,
            };
          } else if (sigPlanType === "iul") {
            // IUL 暂用 savings 兼容包装
            const wrapped = {
              product_name: fast.signature.productName,
              product_type: "iul" as const,
              insured: {
                name: fast.data.summary?.insured_name || "VIP",
                age: Number(fast.data.summary?.insured_age || 0),
                gender: fast.data.summary?.insured_gender || "",
                smoker: null,
              },
              policy: {
                product_name: fast.signature.productName,
                currency: fast.data.summary?.currency || fast.signature.currency || "USD",
                sum_insured: null,
                basic_sum_insured: null,
                annual_premium: fast.data.summary?.annual_premium || 0,
                premium_payment_period: `${fast.data.summary?.payment_years || 0}年`,
                coverage_period: fast.data.summary?.coverage_period || "终身",
                total_premium_with_levy: null,
              },
              benefit_illustration: [],
              withdrawal_illustration: [],
              sales_insights: {
                target_customer: "高净值客户",
                key_selling_points: ["指数账户", "身故保障杠杆"],
                unique_advantages: "万用寿险",
                suggested_narrative: "身故保障+指数账户",
                highlight_numbers: [],
              },
              _meta: {
                source: "signature_fast_path" as const,
                signatureId: fast.signature.id,
                parser: "iul-signature",
                warnings: [],
              },
            };
            // IUL: 按公司路由到专用提取器
            //   - Sunlife (文本型) → extract_sunlife_iul.py 走 find_tables 拿全部数据
            //   - Manulife (图片型) → extract_manulife_iul.py 走 OCR (tesseract eng+chi_tra)
            //   - Transamerica → extract_transamerica_iul.py (后续)
            let fitzGotRows = false;
            try {
              // 关键: 按 signature.companyId 选脚本, 而不是硬编码 Sunlife
              const iulScriptByCompany: Record<string, string> = {
                sunlife: "extract_sunlife_iul.py",
                manulife: "extract_manulife_iul.py",
              };
              const scriptName = iulScriptByCompany[fast.signature.companyId] || "extract_sunlife_iul.py";
              const scriptPath = path.resolve(import.meta.dir, "../../scripts", scriptName);
              if (fs.existsSync(scriptPath)) {
                const proc = Bun.spawn(["python3.11", scriptPath, absPath]);
                const out = await new Response(proc.stdout).text();
                const parsed = JSON.parse(out);
                const fitzBi = (parsed.benefit_illustration || []) as any[];
                if (fitzBi.length > 5) {
                  // 关键映射: 按 companyId 选字段映射
                  //   Sunlife: surrender_value (当前) / guaranteed_value (保证)
                  //   Manulife: surrender_value (当前) / min_surrender_value (保证最低)
                  const isManulife = fast.signature.companyId === "manulife";
                  wrapped.benefit_illustration = fitzBi.map((r: any) => ({
                    policy_year: r.policy_year,
                    age: r.age || 0,
                    annual_premium: r.planned_premium ?? r.premium ?? 0,
                    total_premium_paid: r.cumulative_premium_paid ?? r.premium ?? 0,
                    non_guaranteed_account_value: r.surrender_value || 0,
                    non_guaranteed_cash_value: r.surrender_value || 0,
                    guaranteed_account_value: isManulife ? (r.min_surrender_value || 0) : (r.guaranteed_value || 0),
                    guaranteed_cash_value: isManulife ? (r.min_surrender_value || 0) : (r.guaranteed_value || 0),
                    death_benefit: r.death_benefit || 0,
                    sum_insured: r.sum_insured || 0,
                    source_page: r.source_page || 1,
                  }));
                  fitzGotRows = true;
                  console.log(`[orch] IUL fitz overrode benefit: ${fitzBi.length} rows`);
                }
                // 关键: 把脚本返回的摘要合并到 wrapped
                const fitzSummary = parsed.summary || {};
                if (fitzSummary.annual_premium && !wrapped.policy.annual_premium) {
                  wrapped.policy.annual_premium = fitzSummary.annual_premium;
                  console.log(`[orch] IUL fitz merged annual_premium: ${fitzSummary.annual_premium}`);
                }
                if (fitzSummary.sum_insured && !wrapped.policy.sum_insured) {
                  wrapped.policy.sum_insured = fitzSummary.sum_insured;
                  wrapped.policy.basic_sum_insured = fitzSummary.sum_insured;
                }
                if (fitzSummary.insured_age && !wrapped.insured.age) {
                  wrapped.insured.age = Number(fitzSummary.insured_age);
                }
                if (fitzSummary.insured_gender && !wrapped.insured.gender) {
                  wrapped.insured.gender = fitzSummary.insured_gender;
                }
                // 关键: 自动计算 premium_payment_period (从 benefit_illustration 实际保费年数)
                // 避免 LLM 错填 "5年" 但实际是 10 年缴
                if (Array.isArray(wrapped.benefit_illustration) && wrapped.benefit_illustration.length > 0) {
                  const payYears = wrapped.benefit_illustration.filter((r: any) => Number(r?.annual_premium || 0) > 0).length;
                  if (payYears > 0) {
                    const correctPeriod = `${payYears}年`;
                    if (wrapped.policy.premium_payment_period !== correctPeriod) {
                      console.log(`[orch] IUL fix premium_payment_period: ${wrapped.policy.premium_payment_period} -> ${correctPeriod}`);
                      wrapped.policy.premium_payment_period = correctPeriod;
                    }
                  }
                }
                // 关键: 指数账户配置 (fitz 脚本从首页文本提取)
                if (Array.isArray(fitzSummary.index_accounts) && fitzSummary.index_accounts.length) {
                  (wrapped as any).index_accounts = fitzSummary.index_accounts;
                  console.log(`[orch] IUL fitz merged ${fitzSummary.index_accounts.length} index accounts`);
                }
              }
            } catch (e) {
              console.warn("[orch] IUL fitz unavailable:", (e as Error)?.message?.slice(0, 80));
            }

            // IUL: fitz 没拿到数据 (图片型) → 回退到 LLM 多模态
            if (!fitzGotRows && this.extractor) {
              try {
                console.log(`[orch] IUL fitz returned 0 rows, falling back to LLM`);
                const llmRaw = await this.extractor.extractJSON<RawLLMOutput>(absPath, IUL_SYSTEM_PROMPT);
                const llmData = llmRaw.data || {};
                if (llmData.insured) {
                  if (llmData.insured.age && !wrapped.insured.age) wrapped.insured.age = Number(llmData.insured.age);
                  if (llmData.insured.gender && !wrapped.insured.gender) wrapped.insured.gender = llmData.insured.gender;
                }
                if (llmData.policy) {
                  const llmPolicy = llmData.policy as Record<string, unknown>;
                  if (llmPolicy.annual_premium && !wrapped.policy.annual_premium) {
                    wrapped.policy.annual_premium = Number(llmPolicy.annual_premium);
                  }
                  if (llmPolicy.sum_insured && !wrapped.policy.sum_insured) {
                    wrapped.policy.sum_insured = Number(llmPolicy.sum_insured);
                    wrapped.policy.basic_sum_insured = Number(llmPolicy.sum_insured);
                  }
                }
                if (Array.isArray(llmData.benefit_illustration) && llmData.benefit_illustration.length > 5) {
                  wrapped.benefit_illustration = llmData.benefit_illustration;
                  console.log(`[orch] IUL LLM merged benefit: ${llmData.benefit_illustration.length} rows`);
                }
                wrapped._meta.parser = "iul-fitz+llm-multimodal";
              } catch (e) {
                console.warn("[orch] IUL LLM fallback failed:", (e as Error)?.message?.slice(0, 120));
              }
            }
            if (this.useCache) this.saveToCache(absPath, wrapped);
            return {
              pdfPath: absPath, productName: wrapped.product_name,
              planType: "iul", status: "success", data: wrapped as any,
              durationMs: Date.now() - start,
            };
          }
        }
      } catch (e) {
        console.error("Signature fast path failed, falling back to LLM:", e);
      }
    }

    // LLM extraction: 需 API key
    if (!this.extractor) {
      return {
        pdfPath: absPath, productName: "unknown", planType: type,
        status: "error",
        error: "LLM 未配置 (无 GEMINI_API_KEY) 且 fast-path 未能匹配此 PDF。请上传带签名的储蓄险 PDF 或配置 API key。",
        durationMs: Date.now() - start,
      };
    }

    try {
      // Run preprocessor for savings plans (rule-based page structure detection)
      let effectivePrompt = PROMPTS[type];
      if (type === "savings") {
        try {
          const pre = new PdfPreprocessor();
          const info = await pre.preprocess(absPath);
          const pageInfo = [
            `总页数: ${info.totalPages}`,
            info.hasWithdrawalScenario ? `✅ 检测到提取场景 (第${info.withdrawalPages.join(",")}页)` : "ℹ️ 未检测到提取场景",
            info.detectedWithdrawalYear ? `提取起始年: 第${info.detectedWithdrawalYear}年` : "",
            info.detectedWithdrawalAmount ? `检测到年提取金额: $${info.detectedWithdrawalAmount.toLocaleString()}` : "",
            `基础表页: ${info.baseTablePages.join(",")}`,
            info.withdrawalPages.length > 0 ? `提取表页: ${info.withdrawalPages.join(",")}` : "",
            info.tableSnippet ? `关键表格片段:\n${info.tableSnippet}` : "",
          ].filter(Boolean).join("\n");
          if (info.hasWithdrawalScenario) {
            effectivePrompt = buildSavingsPrompt(pageInfo);
          }
        } catch (e) {
          console.error("Preprocessor error (non-fatal):", e);
        }
      }

      const result = await this.extractor.extractJSON<RawLLMOutput>(absPath, effectivePrompt);
      const raw: RawLLMOutput = result.data;
      if (type === "savings") {
        try {
          const tables = await extractSavingsTables(absPath);
          if (tables.benefit_illustration.length >= 20) {
            raw.benefit_illustration = tables.benefit_illustration;
          }
          if (tables.withdrawal_illustration.length > 0) {
            raw.withdrawal_illustration = tables.withdrawal_illustration;
          }
        } catch (error) {
          console.error("Deterministic savings table extraction failed:", error);
        }
        // Data integrity: ensure Total = Guar_CV + Rev + Term
        if (Array.isArray(raw.benefit_illustration)) {
          raw.benefit_illustration = raw.benefit_illustration.map((row: any) => {
            const gcv = Number(row.guaranteed_cash_value) || 0;
            const rev = Number(row.reversionary_bonus) || 0;
            const term = Number(row.terminal_dividend) || 0;
            const total = Number(row.total_surrender_value) || 0;
            if (total < gcv) {
              return { ...row, total_surrender_value: gcv + rev + term };
            }
            return row;
          });
        }
      }

      // Validate with correct schema (try CI first if product_type indicates it)
      const rawType = inferPlanType(raw);
      let validatedData: PlanData | null = null;

      // Try schemas in priority order based on detected type
      const schemaList: { type: PlanType; schema: any; name: string }[] = [
        { type: "ci", schema: CiPlanExtractionSchema, name: "CiPlanExtractionSchema" },
        { type: "iul", schema: IulExtractionSchema, name: "IulExtractionSchema" },
        { type: "savings", schema: SavingsPlanExtractionSchema, name: "SavingsPlanExtractionSchema" },
      ];

      // Reorder: put detected type first
      const priority: PlanType[] = rawType === "ci" ? ["ci", "iul", "savings"]
        : rawType === "iul" ? ["iul", "ci", "savings"]
        : ["savings", "ci", "iul"];

      const orderedSchemas = priority.map((pt) => // IUL_SCHEMA_VER:1
schemaList.find((s) => s.type === pt)!).filter(Boolean);

      for (const { schema } of orderedSchemas) {
        const v = schema.safeParse(raw);
        if (v.success) { validatedData = v.data; break; }
      }

      if (!validatedData) {
        const cleaned = this.cleanExtraction(raw);
        for (const { schema } of orderedSchemas) {
          const v = schema.safeParse(cleaned);
          if (v.success) { validatedData = v.data; break; }
        }
      }

      if (!validatedData) {
        return {
          pdfPath: absPath, productName: raw?.product_name || "unknown", planType: type,
          status: "error", error: "Data validation failed - unsupported format",
          usage: result.usage, durationMs: Date.now() - start,
        };
      }

      const pt = (validatedData as { product_type?: string })?.product_type;
      const detectedType: PlanType = pt === "ci" ? "ci" : pt === "iul" ? "iul" : "savings";
      if (this.useCache) this.saveToCache(absPath, validatedData);

      return {
        pdfPath: absPath, productName: validatedData.product_name,
        planType: detectedType, status: "success", data: validatedData,
        usage: result.usage, durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        pdfPath: absPath, productName: "unknown", planType: type,
        status: "error", error: err.message, durationMs: Date.now() - start,
      };
    }
  }

  async extractMultiple(pdfPaths: string[], type: PlanType = "savings"): Promise<ExtractionResult[]> {
    const results: ExtractionResult[] = [];
    for (const pdfPath of pdfPaths) {
      console.error(`  📄 ${path.basename(pdfPath)}...`);
      results.push(await this.extractPlan(pdfPath, type));
    }
    return results;
  }

  private cleanExtraction(raw: any): any {
    if (!raw || !Array.isArray(raw.benefit_illustration)) return raw;
    return {
      ...raw,
      benefit_illustration: raw.benefit_illustration
        .filter((r: any) => r && (r.total_surrender_value != null || r.death_benefit != null || r.total_premium_paid != null))
        .map((r: any) => ({
          ...r, total_premium_paid: r.total_premium_paid ?? 0,
          guaranteed_cash_value: r.guaranteed_cash_value ?? 0,
          reversionary_bonus: r.reversionary_bonus ?? 0,
          terminal_dividend: r.terminal_dividend ?? 0,
          total_surrender_value: r.total_surrender_value ?? 0,
          death_benefit: r.death_benefit ?? 0,
        })),
    };
  }

  private loadFromCache(pdfPath: string): ExtractionResult | null {
    try {
      const cp = getCachePath(pdfPath);
      if (!fs.existsSync(cp)) return null;
      const raw = JSON.parse(fs.readFileSync(cp, "utf-8"));
      if (raw?._meta?.cacheVersion !== CACHE_VERSION) return null;
      const data = raw._data || raw;

      // Try both schemas
      for (const [schema, pt] of [[SavingsPlanExtractionSchema, "savings"], [CiPlanExtractionSchema, "ci"], [IulExtractionSchema, "iul"]] as const) {
        const v = schema.safeParse(data);
        if (v.success) return { pdfPath, productName: v.data.product_name, planType: pt as PlanType, status: "cached" as const, data: v.data as PlanData, durationMs: 0 };
      }
      return null;
    } catch { return null; }
  }

  private saveToCache(pdfPath: string, data: any): void {
    try {
      const dir = this.cacheDir;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const buf = fs.readFileSync(pdfPath);
      const hash = crypto.createHash("sha256").update(buf).digest("hex");
      const cacheData = { _data: data, _meta: { cacheVersion: CACHE_VERSION, originalFile: path.basename(pdfPath), extractedAt: new Date().toISOString(), fileHash: hash } };
      fs.writeFileSync(`${dir}/${hash}.json`, JSON.stringify(cacheData, null, 2));
    } catch {}
  }
}
