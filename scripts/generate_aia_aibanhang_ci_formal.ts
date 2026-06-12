import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { matchCompanyKnowledge } from "../src/config/company-kb.ts";
import { buildTemplateCompanyContext } from "../src/templates/company-context.ts";
import type { NormalizedCiPlan } from "../src/ci/ci-normalizer.ts";

const outDir = path.resolve("outputs/aia_aibanhang_ci_formal");
const outputPath = path.join(outDir, "deck.pptx");

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

const normalizedCi: NormalizedCiPlan = {
  kind: "ci",
  productName: "「爱伴航」保险计划 2（10 年缴费）",
  insured: { name: "VIP 女士", age: 32, gender: "女", smoker: "非吸烟者" },
  policy: {
    currency: "USD",
    sumInsured: 100000,
    baseSumInsured: 100000,
    upgradeBenefitAmount: 35000,
    upgradeBenefitYears: 10,
    annualPremium: 7008,
    annualPremiumWithLevy: 7015.01,
    payYears: 10,
    totalPremium: 70080,
    coveragePeriod: "终身",
  },
  coverageSummary: {
    majorCiCount: 58,
    earlyCiCount: 44,
  },
  coverageItems: [
    { name: "58 种危疾保障", amount: 100000, description: "包括 57 种严重疾病及 1 种非严重疾病", sourcePage: 8 },
    { name: "44 种早期危疾保障", amount: 100000, description: "早期危疾可获得预支赔偿", sourcePage: 8 },
    { name: "首 10 年升级保障", amount: 35000, description: "首 10 个保单年度额外提升赔偿", sourcePage: 9 },
    { name: "10X 多重危疾赔偿", amount: 100000, description: "癌症、心脏病、中风等额外多次赔偿", sourcePage: 9 },
    { name: "持续癌症现金选项", amount: 5000, description: "每月可领取原有保额的 5%，长达 100 个月", sourcePage: 10 },
    { name: "脑退化/柏金逊终身年金赔偿", amount: 6000, description: "每保单年度可获原有保额 6%", sourcePage: 10 },
  ],
  icuBenefitRules: [
    { level: "级别一深切治疗保障", payoutPercentage: "20%", maxAmount: 50000, waitingPeriodHours: 72, description: "连续入住 ICU 72 小时或以上", sourcePage: 8 },
    { level: "级别二深切治疗保障", payoutPercentage: "100%", maxAmount: 100000, waitingPeriodHours: 120, description: "连续入住 ICU 并接受侵入性维生支持 120 小时或以上", sourcePage: 9 },
  ],
  multiClaimRules: [
    { condition: "癌症", claimCount: 6, claimPercentage: "100%", waitingPeriod: "3年", description: "严重疾病赔偿及10X多重危疾赔偿合计最高 600%", sourcePage: 9 },
    { condition: "心脏病及中风", claimCount: 3, claimPercentage: "100%", waitingPeriod: "1年", description: "心脏病及中风合计最多 3 次，各自最多 2 次", sourcePage: 9 },
    { condition: "亚尔兹默氏病/柏金逊症", claimCount: 1, claimPercentage: "100%", waitingPeriod: "1年", description: "10X 多重危疾赔偿下可获 1 次赔偿", sourcePage: 9 },
  ],
  premiumWaiverRiders: [
    { name: "免付保费附加契约（基本计划）", coverageAmount: 100000, annualPremium: 0, payYears: 10, description: "若永久及完全丧失双眼视力/双肢等，可豁免未来应付定期保费", sourcePage: 11 },
    { name: "配偶身故豁免缴付保费保障", coverageAmount: 0, annualPremium: 0, payYears: 10, description: "配偶于 75 岁前身故，可豁免基本计划余下保费", sourcePage: 10 },
  ],
  benefitRows: [
    { policyYear: 1, totalPremiumPaid: 7008, guaranteedCashValue: 0, totalSurrenderValue: 0, deathBenefit: 135000, ciBenefit: 135000, sourcePage: 3 },
    { policyYear: 5, totalPremiumPaid: 35040, guaranteedCashValue: 2169, totalSurrenderValue: 4349, deathBenefit: 138330, ciBenefit: 138330, sourcePage: 3 },
    { policyYear: 10, totalPremiumPaid: 70080, guaranteedCashValue: 8676, totalSurrenderValue: 19976, deathBenefit: 151460, ciBenefit: 151460, sourcePage: 3 },
    { policyYear: 20, totalPremiumPaid: 70080, guaranteedCashValue: 29272, totalSurrenderValue: 48002, deathBenefit: 124870, ciBenefit: 124870, sourcePage: 3 },
    { policyYear: 30, totalPremiumPaid: 70080, guaranteedCashValue: 36975, totalSurrenderValue: 146065, deathBenefit: 232830, ciBenefit: 232830, sourcePage: 3 },
    { policyYear: 65, totalPremiumPaid: 70080, guaranteedCashValue: 39950, totalSurrenderValue: 177720, deathBenefit: 263660, ciBenefit: 263660, sourcePage: 3 },
  ],
  cashValueMilestones: [
    { policyYear: 10, label: "Y10 退保发还金额", totalSurrenderValue: 19976, sourcePage: 3 },
    { policyYear: 20, label: "Y20 退保发还金额", totalSurrenderValue: 48002, sourcePage: 3 },
    { policyYear: 30, label: "Y30 退保发还金额", totalSurrenderValue: 146065, sourcePage: 3 },
  ],
  source: {
    parser: "manual-official-ci-v1",
    extractedAt: new Date().toISOString(),
    pdfHash: "manual-aibanhang-ci",
    pdfPath: "/Users/soldier/Downloads/官方计划书案例/愛伴航保險計劃2.pdf",
  },
};

const companyContext = matchCompanyKnowledge({
  productName: normalizedCi.productName,
  forcedCompanyId: "aia",
});
const runtimeCompanyContext = buildTemplateCompanyContext(companyContext);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const normalizedPath = path.join(outDir, "normalized-ci.json");
const companyContextPath = path.join(outDir, "company-context.json");
fs.writeFileSync(normalizedPath, JSON.stringify(normalizedCi, null, 2), "utf8");
fs.writeFileSync(companyContextPath, JSON.stringify(runtimeCompanyContext, null, 2), "utf8");
await run("python3.11", [
  path.resolve("scripts/render_ci_formal_pptx.py"),
  "--normalized", normalizedPath,
  "--company-context", companyContextPath,
  "--output", outputPath,
]);
const pptxPath = outputPath;

console.log(JSON.stringify({
  status: "ok",
  pptxPath,
  companyId: companyContext.companyId,
  companyEvidenceCount: companyContext.evidenceFiles.length,
}, null, 2));
