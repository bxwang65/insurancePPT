/**
 * 组合方案生成器: 储蓄 + 重疾 + IUL
 *
 * 用法:
 *   bun run scripts/generate_combo.ts \
 *     --savings=<path> --ci=<path> --iul=<path> \
 *     --theme=broker --out=<output.pptx>
 *
 * 流程:
 *   1. 分别用对应 prompt 提取每个 PDF
 *   2. 组合数据
 *   3. 调用增强渲染器生成组合 PPTX
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { OpenAIExtractor } from "../src/extraction/openai-extractor.ts";
import { SAVINGS_PLAN_SYSTEM_PROMPT, CI_PLAN_SYSTEM_PROMPT, IUL_SYSTEM_PROMPT } from "../src/extraction/prompts.ts";

const ASSETS = "/Users/soldier/free-code/packages/insurance-ppt/public/assets/library";

const COMPANY_PROFILES: Record<string, any> = {
  transamerica: {
    id: "transamerica", name_zh: "全美人寿", name_en: "Transamerica",
    short: "全美人寿", short_en: "TRANSAMERICA", rating: "A.M. Best A (优秀)",
    founded: "1904", founded_sub: "超过百年历史的全球寿险集团",
    rating_val: "A", rating_label: "A.M. Best A (优秀)",
    series: "GIUL", series_sub: "指数万用寿险专家",
    biz: ["· 指数型万用寿险 — GIUL系列", "· 财富传承 — 高杠杆寿险方案", "· 退休规划 — 年金产品", "· 国际寿险 — 跨境保障方案"],
    brand: ["· 全球领先的寿险集团", "· 业务覆盖全球市场", "· 百年品牌信誉", "· 核心理念：保障您所爱的未来"],
    data: "Transamerica 官网 transamerica.com · A.M. Best 公开资料",
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
      "· 泛亚地区最大独立上市人寿保险集团", "· 业务覆盖亚太区18个市场",
      "· 立足香港，服务全球高净值客户", "· 核心理念：健康长久好生活",
    ],
    data: "AIA HK 官网 aia.com.hk · S&P 公开资料",
  },
  fwd: {
    id: "fwd", name_zh: "富卫人寿保险", name_en: "FWD Life Insurance",
    short: "富卫", short_en: "FWD", rating: "Fitch A (优秀)",
    founded: "2013", founded_sub: "立足香港，快速增长的泛亚保险集团",
    rating_val: "A", rating_label: "Fitch A (优秀)",
    series: "盈聚天下", series_sub: "环球财富管理方案",
    biz: ["· 人寿保险 — 储蓄寿险", "· 健康保险 — 医疗保障 / 危疾保障", "· 财富传承", "· 退休规划"],
    brand: ["· 盈科拓展集团旗下保险集团", "· 业务覆盖亚洲10个市场"],
    data: "FWD 官网 fwd.com.hk · Fitch 公开资料",
  },
};

function resolveCompanyAssets(companyId: string) {
  const co = companyId || "aia";
  return {
    logo: `${ASSETS}/companies/${co}/logo.png`,
    cover: `${ASSETS}/companies/${co}/company-hero-01.jpg`,
    images: [
      `${ASSETS}/companies/${co}/brand-01.jpg`,
      `${ASSETS}/companies/${co}/office-01.jpg`,
      `${ASSETS}/companies/${co}/adviser-01.jpg`,
    ].filter(fs.existsSync),
    coverFallback: `${ASSETS}/themes/savings/long-term-growth-01.jpg`,
  };
}

function resolveSceneImages(insuredAge: number): string[] {
  if (insuredAge < 18) {
    return [`${ASSETS}/themes/education/child-growth-01.jpg`, `${ASSETS}/themes/education/graduation-01.jpg`, `${ASSETS}/themes/family/family-outdoor-01.jpg`].filter(fs.existsSync);
  }
  if (insuredAge >= 55) {
    return [`${ASSETS}/themes/retirement/senior-life-01.jpg`, `${ASSETS}/themes/retirement/senior-travel-01.jpg`, `${ASSETS}/themes/family/family-evening-01.jpg`].filter(fs.existsSync);
  }
  return [`${ASSETS}/themes/savings/family-wealth-01.jpg`, `${ASSETS}/themes/savings/long-term-growth-01.jpg`, `${ASSETS}/themes/family/father-child-01.jpg`].filter(fs.existsSync);
}

function calcIRR(years: number, total: number, paid: number): number | null {
  if (years <= 0 || total <= paid || paid <= 0) return null;
  return (total / paid) ** (1 / years) - 1;
}

function calcSimple(years: number, total: number, paid: number): number | null {
  if (years <= 0 || paid <= 0) return null;
  return (total - paid) / paid / years;
}

async function extractPdf(pdfPath: string, prompt: string, apiKey: string): Promise<any> {
  const extractor = new OpenAIExtractor({ apiKey, provider: "deepseek" });
  console.log(`  🤖 提取: ${path.basename(pdfPath)}`);
  const result = await extractor.extractJSON(pdfPath, prompt);
  return result.data;
}

function buildSavingsData(planData: any, insuredAge: number, annualPremium: number, payYears: number, paidTotal: number) {
  const bi = planData.benefit_illustration || [];
  const wi = planData.withdrawal_illustration || [];

  const noWithdraw: Record<string, any> = {};
  for (const r of bi) {
    const y = Number(r.policy_year || 0); if (y <= 0) continue;
    const total = Number(r.total_surrender_value || 0);
    const paid = Number(r.total_premium_paid || 0);
    noWithdraw[String(y)] = {
      Y: y, Age: insuredAge + y - 1, Paid: paid,
      Guar_CV: Number(r.guaranteed_cash_value || 0),
      Rev: Number(r.reversionary_bonus || 0),
      Term: Number(r.terminal_dividend || 0),
      Total: total, Mult: paidTotal ? total / paidTotal : 0,
      IRR: calcIRR(y, total, paidTotal),
      Simple: calcSimple(y, total, paidTotal),
    };
  }

  let runningCum = 0;
  const withdraw: Record<string, any> = {};
  for (const r of (wi || []).sort((a: any, b: any) => Number(a.policy_year) - Number(b.policy_year))) {
    const y = Number(r.policy_year || 0); if (y <= 0) continue;
    const aw = Number(r.annual_withdrawal || 0);
    const aiCum = Number(r.total_withdrawn || 0);
    runningCum += aw;
    const cum = aiCum > 0 ? aiCum : runningCum;
    const total = Number(r.surrender_value_after || r.surrender_value_before || 0);
    withdraw[String(y)] = {
      Y: y, Age: insuredAge + y - 1, Paid: Number(r.total_premium_paid || 0),
      Annual_WD: aw, Cum_WD: cum, Total: total,
      Total_Received: cum + total, Guar_CV: 0, Rev: 0, Term: 0,
      Mult: paidTotal ? (cum + total) / paidTotal : 0,
      IRR: calcIRR(y, cum + total, paidTotal),
      Simple: calcSimple(y, cum + total, paidTotal),
    };
  }

  return { noWithdraw, withdraw };
}

async function main() {
  const args = process.argv.slice(2);
  const savingsArg = args.find((a) => a.startsWith("--savings="))?.split("=").slice(1).join("=");
  const ciArg = args.find((a) => a.startsWith("--ci="))?.split("=").slice(1).join("=");
  const iulArg = args.find((a) => a.startsWith("--iul="))?.split("=").slice(1).join("=");
  const savingsCompany = args.find((a) => a.startsWith("--savings-company="))?.split("=")[1] || "aia";
  const ciCompany = args.find((a) => a.startsWith("--ci-company="))?.split("=")[1] || "";
  const iulCompany = args.find((a) => a.startsWith("--iul-company="))?.split("=")[1] || "";
  const themeArg = args.find((a) => a.startsWith("--theme="))?.split("=")[1] || "broker";
  const outArg = args.find((a) => a.startsWith("--out="))?.split("=").slice(1).join("=");

  if (!savingsArg) {
    console.error("用法: bun run scripts/generate_combo.ts --savings=<path> [--ci=<path>] [--iul=<path>] [--theme=broker] [--out=<path>]");
    process.exit(1);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY || "sk-ad899305642645ac87ed2ddea7534ee2";
  const companyId = savingsCompany || "aia";
  const companyProfile = COMPANY_PROFILES[companyId] || COMPANY_PROFILES.aia;
  const companyAssets = resolveCompanyAssets(companyId);
  const ciCompanyProfile = ciCompany ? (COMPANY_PROFILES[ciCompany] || null) : null;
  const iulCompanyProfile = iulCompany ? (COMPANY_PROFILES[iulCompany] || null) : null;

  // Step 1: Extract savings
  console.log("📗 提取储蓄计划...");
  const savingsData = await extractPdf(savingsArg, SAVINGS_PLAN_SYSTEM_PROMPT, apiKey);
  const si = savingsData.insured || {};
  const sp = savingsData.policy || {};
  const insuredAge = Number(si.age || 1);
  const annualPremium = Number(sp.annual_premium || 0);
  const payYears = parseInt(String(sp.premium_payment_period || "5")) || 5;
  const paidTotal = annualPremium * payYears;
  console.log(`  产品: ${savingsData.product_name}, 受保人: ${si.name}, ${insuredAge}岁`);
  console.log(`  年缴: $${annualPremium.toLocaleString()}, ${payYears}年`);

  const { noWithdraw, withdraw } = buildSavingsData(savingsData, insuredAge, annualPremium, payYears, paidTotal);

  // Step 2: Extract CI (optional)
  let ciData = null;
  if (ciArg) {
    console.log("📕 提取重疾计划...");
    const rawCi = await extractPdf(ciArg, CI_PLAN_SYSTEM_PROMPT, apiKey);
    ciData = {
      insured: rawCi.insured || {},
      policy: rawCi.policy || {},
      coverage_items: rawCi.coverage_items || [],
      summary: {
        annual_premium: rawCi.policy?.annual_premium || 0,
        sum_insured: rawCi.policy?.sum_insured || 0,
        payment_years: parseInt(String(rawCi.policy?.premium_payment_period || "10")) || 10,
      },
    };
    console.log(`  产品: ${rawCi.product_name}, 保额: $${(rawCi.policy?.sum_insured || 0).toLocaleString()}`);
  }

  // Step 3: Extract IUL (optional)
  let iulData = null;
  if (iulArg) {
    console.log("📙 提取IUL计划...");
    const rawIul = await extractPdf(iulArg, IUL_SYSTEM_PROMPT, apiKey);
    iulData = {
      insured: rawIul.insured || {},
      policy: rawIul.policy || {},
      summary: {
        annual_premium: rawIul.policy?.annual_premium || 0,
        sum_insured: rawIul.policy?.sum_insured || 0,
      },
    };
    console.log(`  产品: ${rawIul.product_name}, 保额: $${(rawIul.policy?.sum_insured || 0).toLocaleString()}`);
  }

  // Step 4: Build meta and data
  const meta = {
    company_id: companyProfile.id,
    company_name_zh: companyProfile.name_zh,
    company_name_en: companyProfile.name_en,
    company_short: companyProfile.short,
    company_short_en: companyProfile.short_en,
    company_rating: companyProfile.rating,
    brand_profile: {
      founded_year: companyProfile.founded,
      founded_label: "成立年份", founded_sub: companyProfile.founded_sub,
      rating_agency: (companyProfile.rating || "").split(" ")[0] || "",
      rating_value: companyProfile.rating_val,
      rating_label: "财务实力评级", rating_sub: companyProfile.rating,
      series_label: companyProfile.series, series_value: "系列",
      series_sub: companyProfile.series_sub,
      series_products: `${companyProfile.series}系列产品`,
      business_lines: companyProfile.biz,
      brand_background: companyProfile.brand,
      data_source: companyProfile.data,
    },
    insured_name: si.name || "VIP 先生",
    insured_age: insuredAge,
    annual_premium: annualPremium,
    payment_years: payYears,
    premium_total: paidTotal,
    currency: sp.currency || "USD",
    coverage_period: sp.coverage_period || "终身",
  };

  const data = {
    meta,
    summary: {
      insured_name: si.name || "VIP 先生", insured_age: insuredAge,
      insured_gender: si.gender || "", product_name: savingsData.product_name || "",
      currency: sp.currency || "USD", annual_premium: annualPremium,
      payment_years: payYears, coverage_period: sp.coverage_period || "终身",
      premium_total: paidTotal,
    },
    paid_total: paidTotal,
    no_withdraw: noWithdraw,
    withdraw: withdraw,
  };

  const sceneImages = resolveSceneImages(insuredAge);
  const outPath = outArg || `/Users/soldier/Desktop/组合方案_${themeArg}.pptx`;

  // Step 5: Write everything to temp JSON for Python
  // Build company profiles from brand_profile format
  function toBrandProfile(cp: any): any {
    if (!cp) return null;
    return {
      founded_year: cp.founded, founded_label: "成立年份", founded_sub: cp.founded_sub,
      rating_agency: (cp.rating || "").split(" ")[0] || "",
      rating_value: cp.rating_val, rating_label: "财务实力评级", rating_sub: cp.rating,
      series_label: cp.series, series_value: "系列", series_sub: cp.series_sub, series_products: cp.series + "系列产品",
      business_lines: cp.biz, brand_background: cp.brand, data_source: cp.data,
      name_zh: cp.name_zh, name_en: cp.name_en,
    };
  }
  const ciCompanyProfileBP = ciCompanyProfile ? toBrandProfile(ciCompanyProfile) : null;
  const iulCompanyProfileBP = iulCompanyProfile ? toBrandProfile(iulCompanyProfile) : null;

  const fullPayload = { data, ciData, iulData, theme: themeArg, companyAssets, sceneImages, ciCompany: ciCompanyProfileBP, iulCompany: iulCompanyProfileBP };
  const tmpJson = `/tmp/combo_data_${Date.now()}.json`;
  fs.writeFileSync(tmpJson, JSON.stringify(fullPayload));

  // Step 6: Call Python renderer
  const insdeckDir = path.resolve(import.meta.dir, "../../insurance-deck");
  const pyScript = `/tmp/render_combo_${Date.now()}.py`;
  const pyCode = `
import sys, json, os
sys.path.insert(0, '${insdeckDir}')
from insdeck.render.pptx_renderer import render_pptx

with open('${tmpJson}') as f:
    p = json.load(f)

ca = p['companyAssets']
si = p.get('sceneImages', [])
render_pptx(p['data'], '${outPath}',
    theme=p['theme'],
    cover_image=ca.get('cover', ''),
    logo_path=ca.get('logo', ''),
    company_images=ca.get('images', []),
    scene_images=si,
    ci_data=p.get('ciData'),
    iul_data=p.get('iulData'),
    ci_company=p.get('ciCompany'),
    iul_company=p.get('iulCompany'))
print('Done')
`;
  fs.writeFileSync(pyScript, pyCode);
  console.log("\n🎨 生成组合PPTX中...");
  execSync(`python3.11 ${pyScript}`, { stdio: "inherit", timeout: 60000 });
  try { fs.unlinkSync(tmpJson); } catch {}
  try { fs.unlinkSync(pyScript); } catch {}

  const desc = [ciArg ? "重疾" : null, iulArg ? "IUL" : null].filter(Boolean).join("+");
  console.log(`\n✅ 完成！${desc ? `储蓄+${desc} 组合方案` : "储蓄方案"}已输出`);
}

main().catch(console.error);
