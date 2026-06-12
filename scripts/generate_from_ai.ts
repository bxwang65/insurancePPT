/**
 * AI提取 → 增强渲染器 桥接脚本
 *
 * 用法:
 *   bun run scripts/generate_from_ai.ts --pdf <path> --theme broker --out <output.pptx>
 *
 * 流程:
 *   1. 用 DeepSeek 提取 PDF 数据
 *   2. 转换为 renderer 需要的 normalized 格式
 *   3. 调用 insurance-deck python-pptx 渲染器生成 PPTX
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { OpenAIExtractor } from "../src/extraction/openai-extractor.ts";
import { SAVINGS_PLAN_SYSTEM_PROMPT } from "../src/extraction/prompts.ts";

const ASSETS = "/Users/soldier/free-code/packages/insurance-ppt/public/assets/library";

function resolveCompanyAssets(companyId: string) {
  const co = companyId || "fwd";
  return {
    logo: `${ASSETS}/companies/${co}/logo.png`,
    cover: `${ASSETS}/companies/${co}/company-hero-01.jpg`,
    images: [
      `${ASSETS}/companies/${co}/brand-01.jpg`,
      `${ASSETS}/companies/${co}/office-01.jpg`,
      `${ASSETS}/companies/${co}/adviser-01.jpg`,
    ].filter((p) => fs.existsSync(p)),
    coverFallback: `${ASSETS}/themes/savings/long-term-growth-01.jpg`,
  };
}

function resolveSceneImages(scenarioType: string, insuredAge: number): string[] {
  if (scenarioType === "education" || insuredAge < 18) {
    return [
      `${ASSETS}/themes/education/child-growth-01.jpg`,
      `${ASSETS}/themes/education/graduation-01.jpg`,
      `${ASSETS}/themes/family/family-outdoor-01.jpg`,
    ].filter((p) => fs.existsSync(p));
  }
  if (scenarioType === "retirement" || insuredAge >= 55) {
    return [
      `${ASSETS}/themes/retirement/senior-life-01.jpg`,
      `${ASSETS}/themes/retirement/senior-travel-01.jpg`,
      `${ASSETS}/themes/family/family-evening-01.jpg`,
    ].filter((p) => fs.existsSync(p));
  }
  return [
    `${ASSETS}/themes/savings/family-wealth-01.jpg`,
    `${ASSETS}/themes/savings/long-term-growth-01.jpg`,
    `${ASSETS}/themes/family/father-child-01.jpg`,
  ].filter((p) => fs.existsSync(p));
}

function buildMeta(planData: any, pdfPath: string, companyProfile?: any): any {
  const pic = planData.policy || {};
  const ins = planData.insured || {};
  const si = (planData.sales_insights || {}) as any;
  const sc = (si.scenario || {}) as any;
  const cp = companyProfile || COMPANY_PROFILES.fwd;

  const insuredAge = Number(ins.age) || 1;
  const annualPremium = Number(pic.annual_premium) || 0;
  const payYears = parseInt(String(pic.premium_payment_period || "5")) || 5;
  const paidTotal = annualPremium * payYears;

  return {
    pdf_path: pdfPath,
    company_id: cp.id,
    company_name_zh: cp.name_zh,
    company_name_en: cp.name_en,
    company_short: cp.short,
    company_short_en: cp.short_en,
    company_rating: cp.rating,
    brand_profile: {
      founded_year: cp.founded,
      founded_label: "成立年份",
      founded_sub: cp.founded_sub,
      rating_agency: cp.rating.split(" ")[0] || "",
      rating_value: cp.rating_val,
      rating_label: "财务实力评级",
      rating_sub: cp.rating,
      series_label: cp.series,
      series_value: "系列",
      series_sub: cp.series_sub,
      series_products: `${cp.series}系列产品`,
      business_lines: cp.biz,
      brand_background: cp.brand,
      data_source: cp.data,
    },
    product_code: "AUTO",
    product_name: planData.product_name || pic.product_name || "储蓄计划",
    product_name_short: (planData.product_name || "").replace(/[「」]/g, "").substring(0, 12),
    product_type: "savings",
    product_currency: pic.currency || "USD",
    insured_name: ins.name || "客户",
    insured_age: insuredAge,
    insured_gender: ins.gender || "",
    annual_premium: annualPremium,
    payment_years: payYears,
    premium_total: paidTotal,
    coverage_period: pic.coverage_period || "终身",
    currency: pic.currency || "USD",

    // 场景信息 (由AI生成)
    scenario_type: sc.type || (insuredAge < 18 ? "education" : insuredAge >= 55 ? "retirement" : "wealth_accumulation"),
    narrative_title: sc.narrative_title || "",
    narrative_intro: sc.narrative_intro || "",
    image_theme: sc.image_theme || "family",
    withdrawal_purpose: sc.withdrawal_purpose || "",
  };
}

// Convert AI array output → renderer dict format
function rowsToDict(rows: any[], yearKey: string, valueTransform?: (r: any) => any): Record<string, any> {
  const dict: Record<string, any> = {};
  for (const r of rows || []) {
    const y = Number(r[yearKey] || r.policy_year || 0);
    if (y <= 0) continue;
    if (valueTransform) {
      dict[String(y)] = valueTransform(r);
    } else {
      dict[String(y)] = r;
    }
  }
  return dict;
}

function calcIRR(years: number, total: number, paid: number): number | null {
  if (years <= 0 || total <= paid || paid <= 0) return null;
  return (total / paid) ** (1 / years) - 1;
}

function calcSimple(years: number, total: number, paid: number): number | null {
  if (years <= 0 || paid <= 0) return null;
  return (total - paid) / paid / years;
}

const COMPANY_PROFILES: Record<string, any> = {
  fwd: {
    id: "fwd", name_zh: "富卫人寿保险", name_en: "FWD Life Insurance",
    short: "富卫", short_en: "FWD", rating: "Fitch A (优秀)",
    founded: "2013", founded_sub: "立足香港，快速增长的泛亚保险集团",
    rating_val: "A", rating_label: "Fitch A (优秀)",
    series: "盈聚天下", series_sub: "环球财富管理方案",
    biz: [
      "· 人寿保险 — 储蓄寿险 / 定期寿险 / 终身寿险",
      "· 健康保险 — 医疗保障 / 危疾保障",
      "· 财富传承 — 盈聚系列 / 万用寿险",
      "· 退休规划 — 年金产品 / 财富管理",
    ],
    brand: [
      "· 盈科拓展集团旗下保险集团", "· 业务覆盖亚洲10个市场",
      "· 致力推动保险体验创新", "· 核心理念：让客户展望更丰盛的人生",
    ],
    data: "FWD 官网 fwd.com.hk · Fitch 公开资料",
  },
  manulife: {
    id: "manulife", name_zh: "宏利人寿保险", name_en: "Manulife",
    short: "宏利", short_en: "MANULIFE", rating: "A.M. Best A+ (优秀)",
    founded: "1887", founded_sub: "加拿大最大的寿险公司之一",
    rating_val: "A+", rating_label: "A.M. Best A+ (优秀)",
    series: "宏挚传承", series_sub: "财富传承专家",
    biz: [
      "· 人寿保险 — 储蓄寿险 / 终身寿险",
      "· 健康保险 — 医疗保障 / 危疾保障",
      "· 财富传承 — 宏挚系列 / 万用寿险",
      "· 退休规划 — 年金产品 / MPF",
    ],
    brand: [
      "· 加拿大宏利金融集团旗下", "· 业务覆盖全球22个市场",
      "· 香港强积金最大管理人之一", "· 核心理念：专注重要时刻",
    ],
    data: "Manulife 官网 manulife.com.hk · A.M. Best 公开资料",
  },
  aia: {
    id: "aia", name_zh: "友邦保险（香港）", name_en: "AIA Hong Kong",
    short: "友邦保险", short_en: "AIA HK", rating: "S&P AA- (Very Strong)",
    founded: "1931", founded_sub: "亚洲最大独立上市人寿集团",
    rating_val: "AA-", rating_label: "S&P AA- (Very Strong)",
    series: "环宇盈活", series_sub: "环球财富管理专家",
    biz: [
      "· 人寿保险 — 储蓄寿险 / 定期寿险 / 终身寿险",
      "· 健康保险 — 重疾保障 / 医疗险",
      "· 财富传承 — 环宇盈活 / 财富挚2 / 简爱延续",
      "· 强积金 / 团体保险 — 企业员工保障",
    ],
    brand: [
      "· 泛亚地区最大独立上市人寿保险集团",
      "· 业务覆盖亚太区18个市场",
      "· 立足香港，服务全球高净值客户",
      "· 核心理念：健康长久好生活",
    ],
    data: "AIA HK 官网 aia.com.hk · S&P 公开资料",
  },
  ctf: {
    id: "ctf", name_zh: "周大福人寿保险", name_en: "CTF Life",
    short: "周大福人寿", short_en: "CTF LIFE", rating: "A.M. Best a- (优秀)",
    founded: "1985", founded_sub: "立足香港近40年",
    rating_val: "a-", rating_label: "A.M. Best a- (优秀)",
    series: "匠心传承", series_sub: "财富传承专家",
    biz: [
      "· 人寿保险 — 储蓄寿险 / 定期寿险 / 终身寿险",
      "· 健康保险 — 重疾保障 / 医疗险",
      "· 财富传承 — 匠心传承系列 / 万用寿险",
      "· 强积金 / 团体保险 — 企业员工保障",
    ],
    brand: [
      "· 周大福集团旗下人寿保险公司", "· 郑氏家族控股，信誉悠久",
      "· 立足香港，服务亚太区客户", "· 核心理念：稳健传承 · 财富增值",
    ],
    data: "周大福人寿官网 ctflife.com.hk · A.M. Best 公开资料",
  },
};

async function main() {
  const args = process.argv.slice(2);
  const pdfArg = args.find((a) => a.startsWith("--pdf="))?.split("=")[1];
  const themeArg = args.find((a) => a.startsWith("--theme="))?.split("=")[1] || "broker";
  const outArg = args.find((a) => a.startsWith("--out="))?.split("=")[1];
  const companyArg = args.find((a) => a.startsWith("--company="))?.split("=")[1] || "";

  if (!pdfArg) {
    console.error("用法: bun run scripts/generate_from_ai.ts --pdf=<path> [--theme=broker] [--company=fwd|manulife|ctf] [--out=<path>]");
    process.exit(1);
  }
  const pdfPath = path.resolve(pdfArg);
  if (!fs.existsSync(pdfPath)) {
    console.error(`文件不存在: ${pdfPath}`);
    process.exit(1);
  }

  console.log(`📄 读取: ${path.basename(pdfPath)}`);

  // Step 1: AI extraction via DeepSeek (direct, no fast-path)
  const apiKey = process.env.DEEPSEEK_API_KEY || "sk-ad899305642645ac87ed2ddea7534ee2";
  const extractor = new OpenAIExtractor({ apiKey, provider: "deepseek" });
  console.log("🤖 AI 提取中 (DeepSeek V4 Flash)...");
  const result = await extractor.extractJSON(pdfPath, SAVINGS_PLAN_SYSTEM_PROMPT);
  const planData = result.data as any;

  // Debug: save raw AI output
  const debugOut = `/tmp/ai_raw_${Date.now()}.json`;
  fs.writeFileSync(debugOut, JSON.stringify(planData, null, 2));
  console.log(`Debug: raw AI output saved to ${debugOut}`);

  const bi: any[] = planData.benefit_illustration || [];
  const wi: any[] = planData.withdrawal_illustration || [];
  const insuredAge = Number(planData.insured?.age || 1);
  const annualPremium = Number(planData.policy?.annual_premium || 0);
  const payYears = parseInt(String(planData.policy?.premium_payment_period || "5")) || 5;
  const paidTotal = annualPremium * payYears;

  console.log(`✓ 产品: ${planData.product_name || "(见 debug JSON)"}`);
  console.log(`✓ 受保人: ${planData.insured?.name || "未知"}, ${insuredAge}岁`);
  console.log(`✓ 年缴: $${annualPremium.toLocaleString()}, ${payYears}年, 总保费: $${paidTotal.toLocaleString()}`);

  // Step 2: Convert to renderer format

  const noWithdraw: Record<string, any> = {};
  for (const r of bi) {
    const y = Number(r.policy_year || 0);
    if (y <= 0) continue;
    const total = Number(r.total_surrender_value || 0);
    const paid = Number(r.total_premium_paid || 0);
    noWithdraw[String(y)] = {
      Y: y,
      Age: insuredAge + y - 1,
      Paid: paid,
      Guar_CV: Number(r.guaranteed_cash_value || 0),
      Rev: Number(r.reversionary_bonus || 0),
      Term: Number(r.terminal_dividend || 0),
      Total: total,
      Mult: paidTotal ? total / paidTotal : 0,
      IRR: calcIRR(y, total, paidTotal),
      Simple: calcSimple(y, total, paidTotal),
    };
  }

  const withdraw: Record<string, any> = {};
  let runningCum = 0;
  const sortedWi = [...wi].sort((a, b) => Number(a.policy_year || 0) - Number(b.policy_year || 0));
  for (const r of sortedWi) {
    const y = Number(r.policy_year || 0);
    if (y <= 0) continue;
    const aw = Number(r.annual_withdrawal || 0);
    // 如果AI没返回累计值, 自动累加
    const aiCum = Number(r.total_withdrawn || 0);
    runningCum += aw;
    const cum = aiCum > 0 ? aiCum : runningCum;
    const total = Number(r.surrender_value_after || r.surrender_value_before || 0);
    withdraw[String(y)] = {
      Y: y,
      Age: insuredAge + y - 1,
      Paid: Number(r.total_premium_paid || 0),
      Annual_WD: aw,
      Cum_WD: cum,
      Total: total,
      Total_Received: cum + total,
      Guar_CV: 0,
      Rev: 0,
      Term: 0,
      Mult: paidTotal ? (cum + total) / paidTotal : 0,
      IRR: calcIRR(y, cum + total, paidTotal),
      Simple: calcSimple(y, cum + total, paidTotal),
    };
  }

  // Determine company from arg or product name
  let companyId = companyArg;
  if (!companyId) {
    const pn = (planData.product_name || "").toLowerCase();
    if (pn.includes("宏挚") || pn.includes("宏利") || pn.includes("manulife")) companyId = "manulife";
    else if (pn.includes("匠心") || pn.includes("周大福") || pn.includes("ctf")) companyId = "ctf";
    else if (pn.includes("盈聚") || pn.includes("富卫") || pn.includes("fwd")) companyId = "fwd";
    else if (pn.includes("环宇") || pn.includes("盈活") || pn.includes("aia") || pn.includes("友邦")) companyId = "aia";
    else companyId = "aia";
  }
  const companyProfile = COMPANY_PROFILES[companyId] || COMPANY_PROFILES.fwd;
  console.log(`🏢 公司: ${companyProfile.name_zh} (${companyId})`);

  const meta = buildMeta(planData, pdfPath, companyProfile);
  const data = {
    meta,
    summary: {
      insured_name: planData.insured?.name || "VIP",
      insured_age: insuredAge,
      insured_gender: planData.insured?.gender || "",
      product_name: planData.product_name || "",
      currency: planData.policy?.currency || "USD",
      annual_premium: annualPremium,
      payment_years: payYears,
      coverage_period: planData.policy?.coverage_period || "终身",
      premium_total: paidTotal,
    },
    paid_total: paidTotal,
    no_withdraw: noWithdraw,
    withdraw: withdraw,
  };

  // Step 3: Write temp JSON for Python
  const tmpJson = `/tmp/ai_extract_${Date.now()}.json`;
  fs.writeFileSync(tmpJson, JSON.stringify(data, null, 2));

  // Step 4: Determine theme and assets
  const scType = meta.scenario_type;
  const companyAssets = resolveCompanyAssets(companyId);
  // Use fallback cover image if company hero not available
  if (!fs.existsSync(companyAssets.cover)) companyAssets.cover = companyAssets.coverFallback;
  const sceneImages = resolveSceneImages(scType, insuredAge);

  // Step 5: Write temp Python script
  const insdeckDir = path.resolve(import.meta.dir, "../../insurance-deck");
  const pyScript = path.join("/tmp", `render_${Date.now()}.py`);
  const pyCode = `
import sys, json
sys.path.insert(0, '${insdeckDir}')
from insdeck.render.pptx_renderer import render_pptx

with open('${tmpJson}') as f:
    data = json.load(f)

out = '${outArg || `/Users/soldier/Desktop/${path.basename(pdfPath, ".pdf")}_AI方案.pptx`}'
render_pptx(data, out,
    theme='${themeArg}',
    cover_image='${companyAssets.cover}',
    logo_path='${companyAssets.logo}',
    company_images=${JSON.stringify(companyAssets.images)},
    scene_images=${JSON.stringify(sceneImages)})
print(f'Done: {out}')
`;
  fs.writeFileSync(pyScript, pyCode);

  console.log("🎨 生成 PPTX 中...");
  execSync(`python3.11 ${pyScript}`, {
    stdio: "inherit",
    timeout: 60000,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });

  // Cleanup
  try { fs.unlinkSync(tmpJson); } catch {}
  try { fs.unlinkSync(pyScript); } catch {}

  console.log(`\n✅ 完成！输出: ${outArg || "桌面"}`);
}

main().catch(console.error);
