import fs from "fs";
import path from "path";
import assert from "node:assert/strict";
import { renderSavingsCiIulBundle } from "../src/bundles/savings-ci-iul-bundle-renderer.ts";
import { matchCompanyKnowledge } from "../src/config/company-kb.ts";
import type { PipelineRequest } from "../src/pipeline/types.ts";
import type { NormalizedSavingsPlan } from "../src/savings/savings-normalizer.ts";
import type { NormalizedCiPlan } from "../src/ci/ci-normalizer.ts";
import type { NormalizedIulPlan } from "../src/iul/iul-normalizer.ts";
import { getTenantConfig } from "../src/config/tenants.ts";

const outDir = path.resolve("outputs/regression_savings_ci_iul_bundle_clone");
const workspace = path.join(outDir, "template-clone/savings-ci-iul-bundle");

const normalizedSavings: NormalizedSavingsPlan = JSON.parse(
  fs.readFileSync(path.resolve("outputs/formal_環宇盈活儲蓄保險計劃_1780289287599_pipeline/normalized-savings.json"), "utf8"),
);
const normalizedCi: NormalizedCiPlan = {
  kind: "ci",
  productName: "守护家危疾保障计划",
  insured: { name: "陈小姐", age: 32, gender: "女", smoker: "N" },
  policy: { currency: "USD", sumInsured: 500000, annualPremium: 4949, payYears: 10, coveragePeriod: "至100岁" },
  coverageItems: [
    { name: "恶性肿瘤重度", amount: 500000, description: "首次确诊赔付", sourcePage: 9 },
    { name: "严重疾病多重赔付", amount: 500000, description: "符合条款可多次赔付", sourcePage: 10 },
  ],
  benefitRows: [],
  source: { parser: "fixture", extractedAt: new Date().toISOString(), pdfHash: "fixture-ci", pdfPath: "/tmp/ci.pdf" },
};
const normalizedIul: NormalizedIulPlan = {
  kind: "iul",
  productName: "终身IUL保障计划",
  insured: { name: "陈小姐", age: 32, gender: "女", smoker: "N" },
  policy: {
    currency: "USD",
    sumInsured: 600000,
    annualPremium: 12000,
    paymentPeriod: "10年",
    policyTerm: "终身",
  },
  indexAccounts: [{
    name: "S&P 指数账户",
    floorRate: "0.00%",
    capRate: "10.00%",
    participationRate: "100%",
    assumedRate: "5.00%",
    sourcePage: 7,
  }],
  benefitRows: [{
    policyYear: 20,
    insuredAge: 52,
    totalPremiumPaid: 120000,
    guaranteedCashValue: 82000,
    nonGuaranteedCashValue: 158000,
    guaranteedDeathBenefit: 600000,
    nonGuaranteedDeathBenefit: 745000,
    sourcePage: 9,
  }],
  source: { parser: "fixture", extractedAt: new Date().toISOString(), pdfHash: "fixture-iul", pdfPath: "/tmp/iul.pdf" },
};

const companyContext = matchCompanyKnowledge({ companyHint: "友邦保险", forcedCompanyId: "aia" });
const tenant = getTenantConfig("aia");

const req: PipelineRequest = {
  tenantId: "aia",
  userId: "test",
  sessionId: "test-session",
  customerName: "测试客户",
  outputStem: "regression_savings_ci_iul_bundle_clone",
  stylePreset: "business",
  format: "pptx",
  companyContext,
  extractions: [],
  normalizedSavings,
  normalizedCi,
  normalizedIul,
};

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const deck = await renderSavingsCiIulBundle({
  req,
  outDir,
  outline: { markdownPath: path.join(outDir, "deck.marp.md"), slides: [] },
  images: { assetsDir: path.join(outDir, "assets"), images: [] },
  charts: { assetsDir: path.join(outDir, "charts"), assets: [] },
  tenant,
});

const fidelity = JSON.parse(fs.readFileSync(path.join(workspace, "qa/template-fidelity-check.json"), "utf8"));
assert.equal(fidelity.status, "pass");
assert.equal(fidelity.issueCount, 0);
assert.ok(deck.pptxPath && fs.existsSync(deck.pptxPath));
assert.ok(fs.statSync(deck.pptxPath!).size > 80_000);

console.log(JSON.stringify({
  status: "ok",
  pptxPath: deck.pptxPath,
  fidelity: { status: fidelity.status, issueCount: fidelity.issueCount },
  bundle: "savings-ci-iul",
}, null, 2));
