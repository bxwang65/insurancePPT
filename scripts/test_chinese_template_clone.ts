import fs from "fs";
import path from "path";
import assert from "node:assert/strict";
import { renderChineseSavingsClone } from "../src/templates/chinese-savings-clone-renderer.ts";
import { matchCompanyKnowledge } from "../src/config/company-kb.ts";
import type { NormalizedSavingsPlan } from "../src/savings/savings-normalizer.ts";

const baselineDir = path.resolve("outputs/formal_環宇盈活儲蓄保險計劃_1780289287599_pipeline");
const outDir = path.resolve("outputs/regression_chinese_savings_clone");
const workspace = path.join(outDir, "template-clone/chinese-savings");
const normalized = JSON.parse(fs.readFileSync(path.join(baselineDir, "normalized-savings.json"), "utf8")) as NormalizedSavingsPlan;
const companyContext = matchCompanyKnowledge({ productName: normalized.productName });

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const pptxPath = await renderChineseSavingsClone({
  outDir,
  normalizedSavings: normalized,
  images: { assetsDir: path.join(baselineDir, "assets"), images: [] },
  charts: { assetsDir: path.join(baselineDir, "charts"), assets: [] },
  outputPath: path.join(outDir, "deck.pptx"),
  companyContext,
});

const fidelity = JSON.parse(fs.readFileSync(path.join(workspace, "qa/template-fidelity-check.json"), "utf8"));
assert.equal(fidelity.status, "pass");
assert.equal(fidelity.issueCount, 0);
assert.equal(fs.existsSync(pptxPath), true);
assert.ok(fs.statSync(pptxPath).size > 100_000);

console.log(JSON.stringify({
  status: "ok",
  pptxPath,
  slideCount: 10,
  fidelity: { status: fidelity.status, issueCount: fidelity.issueCount },
  companyContext: { companyId: companyContext.companyId, evidenceCount: companyContext.evidenceFiles.length },
}, null, 2));
