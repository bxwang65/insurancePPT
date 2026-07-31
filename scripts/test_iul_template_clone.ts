import fs from "fs";
import path from "path";
import assert from "node:assert/strict";
import { renderBusinessIulClone } from "../src/templates/business-iul-clone-renderer.ts";
import { matchCompanyKnowledge } from "../src/config/company-kb.ts";
import type { NormalizedIulPlan } from "../src/iul/iul-normalizer.ts";

const baselineDir = path.resolve("outputs/formal_環宇盈活儲蓄保險計劃_1780289287599_pipeline");
const outDir = path.resolve("outputs/regression_iul_business_clone");
const workspace = path.join(outDir, "template-clone/business-iul");

const normalizedIul: NormalizedIulPlan = {
  kind: "iul",
  productName: "Genesis IUL 指数型寿险计划",
  insured: { name: "王先生", age: 38, gender: "男", smoker: "N" },
  policy: {
    currency: "USD",
    sumInsured: 1000000,
    initialPremium: 50000,
    annualPremium: 50000,
    paymentPeriod: "10年",
    coveragePeriod: "至100岁",
  },
  indexAccounts: [
    { name: "S&P 500", allocation: 60, assumedRate: "5.00%", floorRate: "0.00%", capRate: "10.00%", participationRate: "100%" },
    { name: "Global Index", allocation: 40, assumedRate: "4.50%", floorRate: "0.00%", capRate: "9.00%", participationRate: "100%" },
  ],
  benefitRows: Array.from({ length: 30 }, (_, i) => {
    const year = i + 1;
    const paid = year <= 10 ? year * 50_000 : 500_000;
    const ngcv = Math.round(paid * (0.75 + year * 0.03));
    const gcv = Math.round(paid * (0.35 + year * 0.015));
    return {
      policyYear: year,
      age: 38 + year,
      totalPremiumPaid: paid,
      guaranteedCashValue: gcv,
      nonGuaranteedCashValue: ngcv,
      guaranteedDeathBenefit: 1_000_000,
      nonGuaranteedDeathBenefit: 1_000_000 + Math.round(ngcv * 0.8),
      sourcePage: 14,
    };
  }),
  source: {
    parser: "fixture-regression",
    extractedAt: new Date().toISOString(),
    pdfHash: "fixture-iul-hash",
    pdfPath: "/tmp/fixture-iul.pdf",
  },
};

const companyContext = matchCompanyKnowledge({ companyHint: "友邦保险", forcedCompanyId: "aia" });

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const pptxPath = await renderBusinessIulClone({
  outDir,
  normalizedIul,
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

