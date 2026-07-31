/**
 * 3-way LLM 对比 — 豆包 / 千问 / DeepSeek
 * 用于评估 3 个 provider 在 PDF 解析任务上的:
 *   - JSON 合法性
 *   - 字段完整度 (产品名/年龄/性别/保费/缴费年期/退保总额/提领)
 *   - 耗时
 *   - Token 用量
 *   - 估算成本
 *
 * 用法:
 *   DOUBAO_API_KEY=xxx QWEN_API_KEY=xxx DEEPSEEK_API_KEY=xxx \
 *     bun run scripts/test_4way_llm_comparison.ts [test_pdf_dir]
 *
 * 默认测试 4 类 LLM 依赖产品:
 *   - AIA 愛伴航保險計劃2
 *   - AIA 環宇盈活
 *   - TA_GIUL3+M
 *   - Genesis III
 */
import fs from "fs";
import path from "path";
import { OpenAIExtractor } from "../src/extraction/openai-extractor.ts";
import { SAVINGS_PLAN_SYSTEM_PROMPT, IUL_SYSTEM_PROMPT } from "../src/extraction/prompts.ts";

type Provider = "doubao" | "qwen" | "minimax" | "kimi" | "deepseek";

// 价格 (元 / 1K tokens) — 与官方页面同步
// 注: qwen3.7-plus 当前 8 折, doubao-seed-1-6 标准价
const PRICING: Record<Provider, { input: number; output: number; name: string }> = {
  doubao: { input: 0.0008, output: 0.004, name: "doubao-seed-1-6" },
  qwen: { input: 0.004, output: 0.012, name: "qwen3.7-plus (8折)" },
  minimax: { input: 0.0008, output: 0.008, name: "MiniMax-M3" },
  kimi: { input: 0.012, output: 0.012, name: "kimi-for-coding" },
  deepseek: { input: 0.001, output: 0.012, name: "deepseek-v4-flash" },
};

const ENV_KEY: Record<Provider, string | undefined> = {
  doubao: process.env.DOUBAO_API_KEY,
  qwen: process.env.QWEN_API_KEY,
  minimax: process.env.MINIMAX_API_KEY,
  kimi: process.env.KIMI_API_KEY,
  deepseek: process.env.DEEPSEEK_API_KEY,
};

interface RunResult {
  provider: Provider;
  ok: boolean;
  data: any;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  durationMs: number;
  wallMs: number;
  error?: string;
  costRMB: number;
}

async function runOne(
  pdfPath: string,
  provider: Provider,
  systemPrompt: string,
  timeoutMs = 600_000,
): Promise<RunResult> {
  const apiKey = ENV_KEY[provider];
  if (!apiKey) {
    return { provider, ok: false, data: null, wallMs: 0, durationMs: 0, costRMB: 0, error: `Missing ${provider.toUpperCase()}_API_KEY env` };
  }
  const ext = new OpenAIExtractor({ apiKey, provider, timeout: timeoutMs });
  const t0 = Date.now();
  try {
    const r = await ext.extractJSON(pdfPath, systemPrompt);
    const cost = r.usage
      ? (r.usage.promptTokens / 1000) * PRICING[provider].input + (r.usage.completionTokens / 1000) * PRICING[provider].output
      : 0;
    return {
      provider,
      ok: true,
      data: r.data,
      usage: r.usage,
      durationMs: r.durationMs,
      wallMs: Date.now() - t0,
      costRMB: cost,
    };
  } catch (e: any) {
    return { provider, ok: false, data: null, wallMs: Date.now() - t0, durationMs: 0, costRMB: 0, error: e.message.substring(0, 400) };
  }
}

interface FieldCheck {
  productName: string;
  annualPremium: number | undefined;
  paymentPeriod: string | undefined;
  currency: string | undefined;
  insuredAge: number | undefined;
  insuredGender: string | undefined;
  biRows: number;
  wdRows: number;
  hasWithdraw: boolean;
}

function summarize(r: RunResult): FieldCheck | null {
  if (!r.ok) return null;
  const d = r.data || {};
  return {
    productName: d.product_name || "(empty)",
    annualPremium: d.policy?.annual_premium,
    paymentPeriod: d.policy?.premium_payment_period,
    currency: d.policy?.currency,
    insuredAge: d.insured?.age,
    insuredGender: d.insured?.gender,
    biRows: Array.isArray(d.benefit_illustration) ? d.benefit_illustration.length : 0,
    wdRows: Array.isArray(d.withdrawal_illustration) ? d.withdrawal_illustration.length : 0,
    hasWithdraw: Array.isArray(d.withdrawal_illustration) && d.withdrawal_illustration.length > 0,
  };
}

const PDF_DIR = process.argv[2] || "/tmp/test_pdfs";

interface Target {
  file: string;
  label: string;
  isIUL: boolean;
  expected: Partial<FieldCheck>;
}

const TARGETS: Target[] = [
  { file: "愛伴航保險計劃2.pdf", label: "AIA 愛伴航 (savings, 10年缴)", isIUL: false, expected: { paymentPeriod: "10年", hasWithdraw: false } },
  { file: "環宇盈活儲蓄保險計劃.pdf", label: "AIA 環宇盈活 (savings, 5年缴)", isIUL: false, expected: { paymentPeriod: "5年", hasWithdraw: false } },
  { file: "TA_GIUL3+M-46-N-CN-USD-S2m-5x+(coi)(SC).pdf", label: "Transamerica TA_GIUL3+M (IUL)", isIUL: true, expected: {} },
  { file: "B0F85256951A427E876B6610ACD5E4C6.pdf", label: "Transamerica Genesis III (IUL)", isIUL: true, expected: {} },
];

// 检查可用 provider
const availableProviders = (["doubao", "qwen", "minimax", "kimi", "deepseek"] as Provider[]).filter((p) => ENV_KEY[p]);
if (availableProviders.length === 0) {
  console.error("❌ 未提供任何 API KEY。请设置 DOUBAO_API_KEY / QWEN_API_KEY / MINIMAX_API_KEY / KIMI_API_KEY / DEEPSEEK_API_KEY 中的至少一个。");
  process.exit(1);
}
console.log(`🔑 可用 provider: ${availableProviders.join(", ")}\n`);

interface Aggregated {
  total: number;
  ok: number;
  totalDurationMs: number;
  totalCost: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
}
const agg: Record<Provider, Aggregated> = {} as any;
for (const p of availableProviders) {
  agg[p] = { total: 0, ok: 0, totalDurationMs: 0, totalCost: 0, totalPromptTokens: 0, totalCompletionTokens: 0 };
}

for (const t of TARGETS) {
  const p = `${PDF_DIR}/${t.file}`;
  if (!fs.existsSync(p)) {
    console.log(`⏭️  SKIP ${t.file} (not found)\n`);
    continue;
  }
  const sizeKB = (fs.statSync(p).size / 1024).toFixed(1);
  console.log("=".repeat(80));
  console.log(`📄 ${t.label}`);
  console.log(`   file: ${p}  (${sizeKB} KB)`);
  console.log("=".repeat(80));

  const systemPrompt = t.isIUL ? IUL_SYSTEM_PROMPT : SAVINGS_PLAN_SYSTEM_PROMPT;

  // 4 个 provider 并发
  const results = await Promise.all(
    availableProviders.map((prov) => runOne(p, prov, systemPrompt)),
  );

  for (const r of results) {
    agg[r.provider].total++;
    const s = summarize(r);
    console.log(`\n--- ${r.provider.toUpperCase()} (${PRICING[r.provider].name}) ---`);
    if (!r.ok) {
      console.log(`✗ FAILED (${r.wallMs}ms): ${r.error}`);
      continue;
    }
    agg[r.provider].ok++;
    agg[r.provider].totalDurationMs += r.durationMs;
    agg[r.provider].totalCost += r.costRMB;
    if (r.usage) {
      agg[r.provider].totalPromptTokens += r.usage.promptTokens;
      agg[r.provider].totalCompletionTokens += r.usage.completionTokens;
    }
    console.log(`✓ OK  llm=${r.durationMs}ms  total=${r.wallMs}ms  ¥${r.costRMB.toFixed(4)}`);
    if (r.usage) console.log(`  tokens: in=${r.usage.promptTokens}  out=${r.usage.completionTokens}  total=${r.usage.totalTokens}`);
    if (s) {
      console.log(`  product_name:    ${s.productName}`);
      console.log(`  annual_premium:  ${s.annualPremium}  ${s.currency || ""}`);
      console.log(`  payment_period:  ${s.paymentPeriod}`);
      console.log(`  insured:         age=${s.insuredAge}, gender=${s.insuredGender}`);
      console.log(`  bi_rows:         ${s.biRows}`);
      console.log(`  wd_rows:         ${s.wdRows}`);
    }
  }

  // 字段一致度 (如果至少 2 个成功)
  const okResults = results.filter((r) => r.ok);
  if (okResults.length >= 2) {
    console.log(`\n--- 一致度对比 (${okResults.length} 家对比) ---`);
    const fields: Array<keyof FieldCheck> = ["productName", "annualPremium", "paymentPeriod", "currency", "insuredAge", "insuredGender", "biRows"];
    for (const f of fields) {
      const vals = okResults.map((r) => JSON.stringify(summarize(r)?.[f]));
      const allSame = vals.every((v) => v === vals[0]);
      if (!allSame) {
        console.log(`  ✗ ${f}:  ${okResults.map((r) => `${r.provider}=${vals[okResults.indexOf(r)]}`).join(" | ")}`);
      }
    }
  }
}

// 最终汇总
console.log("\n\n" + "█".repeat(80));
console.log("📊 4-way 汇总");
console.log("█".repeat(80));
console.log(
  "Provider".padEnd(12) +
  "成功率".padEnd(10) +
  "总耗时".padEnd(12) +
  "Prompt tok".padEnd(14) +
  "Output tok".padEnd(14) +
  "总成本".padEnd(12) +
  "均耗时".padEnd(10),
);
for (const prov of availableProviders) {
  const a = agg[prov];
  const successRate = a.total > 0 ? `${a.ok}/${a.total} (${((a.ok / a.total) * 100).toFixed(0)}%)` : "-";
  const avgMs = a.ok > 0 ? `${(a.totalDurationMs / a.ok / 1000).toFixed(1)}s` : "-";
  console.log(
    prov.padEnd(12) +
    successRate.padEnd(10) +
    `${(a.totalDurationMs / 1000).toFixed(1)}s`.padEnd(12) +
    `${a.totalPromptTokens}`.padEnd(14) +
    `${a.totalCompletionTokens}`.padEnd(14) +
    `¥${a.totalCost.toFixed(4)}`.padEnd(12) +
    avgMs.padEnd(10),
  );
}
console.log("\n💡 评估建议:");
console.log("  - 优先看 成功率 + 字段一致度 (数据准不准)");
console.log("  - 备用 2/3 看 成本 + 耗时 (并发场景下能不能扛)");
console.log("  - 4 家一致 = 正确; 2-3 一致 = 看 majority; 全不一致 = 需人工核对");
