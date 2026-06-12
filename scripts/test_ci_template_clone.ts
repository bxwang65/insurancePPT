import fs from "fs";
import path from "path";
import assert from "node:assert/strict";
import { renderBusinessCiClone } from "../src/templates/business-ci-clone-renderer.ts";
import { matchCompanyKnowledge } from "../src/config/company-kb.ts";
import type { NormalizedCiPlan } from "../src/ci/ci-normalizer.ts";

const baselineDir = path.resolve("outputs/formal_環宇盈活儲蓄保險計劃_1780289287599_pipeline");
const outDir = path.resolve("outputs/regression_ci_business_clone");
const workspace = path.join(outDir, "template-clone/business-ci");

const normalizedCi: NormalizedCiPlan = {
  kind: "ci",
  productName: "守护家危疾保障计划",
  insured: { name: "陈小姐", age: 32, gender: "女", smoker: "N" },
  policy: {
    currency: "USD",
    sumInsured: 500000,
    baseSumInsured: 500000,
    upgradeBenefitAmount: 35000,
    upgradeBenefitYears: 10,
    annualPremium: 4949,
    annualPremiumWithLevy: 4954,
    payYears: 10,
    totalPremium: 49490,
    coveragePeriod: "至100岁",
  },
  coverageSummary: {
    majorCiCount: 58,
    earlyCiCount: 44,
  },
  coverageItems: [
    { name: "恶性肿瘤重度", amount: 500000, description: "首次确诊赔付", sourcePage: 9 },
    { name: "严重疾病多重赔付", amount: 500000, description: "符合条款可多次赔付", sourcePage: 10 },
    { name: "身故保障", amount: 500000, description: "身故责任", sourcePage: 11 },
  ],
  icuBenefitRules: [
    { level: "一级深切治疗保障", payoutPercentage: "20%", maxAmount: 50000, waitingPeriodHours: 72, description: "连续入住ICU", sourcePage: 9 },
  ],
  multiClaimRules: [
    { condition: "癌症", claimCount: 6, claimPercentage: "100%", waitingPeriod: "3年", description: "持续癌症及新发癌症", sourcePage: 10 },
  ],
  premiumWaiverRiders: [
    { name: "免付保费附加契约（基本计划）", coverageAmount: 500000, annualPremium: 0, payYears: 10, description: "豁免后续保费", sourcePage: 1 },
  ],
  benefitRows: [
    {
      policyYear: 1,
      totalPremiumPaid: 4949,
      guaranteedCashValue: 0,
      totalSurrenderValue: 0,
      deathBenefit: 500000,
      ciBenefit: 500000,
      sourcePage: 12,
    },
    {
      policyYear: 20,
      totalPremiumPaid: 49490,
      guaranteedCashValue: 23110,
      totalSurrenderValue: 40200,
      deathBenefit: 500000,
      ciBenefit: 500000,
      sourcePage: 12,
    },
  ],
  cashValueMilestones: [
    { policyYear: 20, label: "Y20 退保价值", totalSurrenderValue: 40200, sourcePage: 12 },
  ],
  source: {
    parser: "fixture-regression",
    extractedAt: new Date().toISOString(),
    pdfHash: "fixture-ci-hash",
    pdfPath: "/tmp/fixture-ci.pdf",
  },
};

const companyContext = matchCompanyKnowledge({ companyHint: "友邦保险", forcedCompanyId: "aia" });

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const pptxPath = await renderBusinessCiClone({
  outDir,
  normalizedCi,
  images: { assetsDir: path.join(baselineDir, "assets"), images: [] },
  charts: { assetsDir: path.join(baselineDir, "charts"), assets: [] },
  outputPath: path.join(outDir, "deck.pptx"),
  companyContext,
});

const fidelity = JSON.parse(fs.readFileSync(path.join(workspace, "qa/template-fidelity-check.json"), "utf8"));
assert.equal(fidelity.status, "pass");
assert.equal(fidelity.issueCount, 0);
assert.equal(fs.existsSync(pptxPath), true);
assert.ok(fs.statSync(pptxPath).size > 80_000);

console.log(JSON.stringify({
  status: "ok",
  pptxPath,
  slideCount: 6,
  fidelity: { status: fidelity.status, issueCount: fidelity.issueCount },
  companyContext: { companyId: companyContext.companyId, evidenceCount: companyContext.evidenceFiles.length },
}, null, 2));
