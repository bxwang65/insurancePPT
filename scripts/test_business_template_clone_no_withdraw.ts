import fs from "fs";
import path from "path";
import assert from "node:assert/strict";
import { renderBusinessSavingsClone } from "../src/templates/business-savings-clone-renderer.ts";
import { matchCompanyKnowledge } from "../src/config/company-kb.ts";
import { normalizeSavingsPlan } from "../src/savings/savings-normalizer.ts";

const session = JSON.parse(fs.readFileSync(path.resolve("sessions/hxct_single.json"), "utf8"));
const extraction = session.extractions.find((item: any) => item.planType === "savings" && item.data);
if (!extraction?.data) throw new Error("missing savings extraction");

const normalized = normalizeSavingsPlan(extraction.data, {
  pdfPath: extraction.pdfPath || "",
  parser: "session-fixture",
});
const companyContext = matchCompanyKnowledge({
  productName: normalized.productName,
  forcedCompanyId: "aia",
});
if (companyContext.companyId === "unknown") throw new Error("company match failed");

const baselineDir = path.resolve("outputs/formal_環宇盈活儲蓄保險計劃_1780289287599_pipeline");
const outDir = path.resolve("outputs/regression_business_savings_no_withdraw");
const workspace = path.join(outDir, "template-clone/business-savings");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const pptxPath = await renderBusinessSavingsClone({
  outDir,
  normalizedSavings: normalized,
  images: { assetsDir: path.join(baselineDir, "assets"), images: [] },
  charts: { assetsDir: path.join(baselineDir, "charts"), assets: [] },
  outputPath: path.join(outDir, "deck.pptx"),
  companyContext,
});

const fidelity = JSON.parse(fs.readFileSync(path.join(workspace, "qa/template-fidelity-check.json"), "utf8"));
assert.equal(normalized.withdrawalRows.length, 0);
assert.equal(fidelity.status, "pass");
assert.equal(fidelity.issueCount, 0);
assert.ok(fs.existsSync(pptxPath));
assert.ok(fs.statSync(pptxPath).size > 100_000);

console.log(JSON.stringify({
  status: "ok",
  pptxPath,
  slideCount: 6,
  withdrawalRows: normalized.withdrawalRows.length,
  fidelity: { status: fidelity.status, issueCount: fidelity.issueCount },
  companyContext: { companyId: companyContext.companyId, evidenceCount: companyContext.evidenceFiles.length },
}, null, 2));
