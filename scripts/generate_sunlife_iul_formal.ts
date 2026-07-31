import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import assert from "node:assert/strict";
import { validateIulExtraction } from "../src/schemas/iul.ts";
import { normalizeIulPlan } from "../src/iul/iul-normalizer.ts";
import { validateFormalIulPlan } from "../src/iul/formal-iul-validator.ts";
import { matchCompanyKnowledge } from "../src/config/company-kb.ts";
import { buildTemplateCompanyContext } from "../src/templates/company-context.ts";

const pdfPath = "/Users/soldier/Downloads/官方计划书案例/A277F1F017354992A31D11423992CE63.pdf";
const outDir = path.resolve("outputs/sunlife_iul_formal_case");
const rawPath = path.join(outDir, "raw-iul.json");
const normalizedPath = path.join(outDir, "normalized-iul.json");
const companyContextPath = path.join(outDir, "company-context.json");
const pptxPath = path.join(outDir, "deck.pptx");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const extract = spawnSync("python3.11", [
  path.resolve("scripts/extract_sunlife_iul_case.py"),
  "--pdf",
  pdfPath,
  "--output",
  rawPath,
], { stdio: "inherit" });

if (extract.status !== 0) {
  throw new Error(`extract_sunlife_iul_case.py exited ${extract.status}`);
}

const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
const validation = validateIulExtraction(raw);
assert.equal(validation.success, true, JSON.stringify(validation.errors, null, 2));

const normalized = normalizeIulPlan(validation.data, {
  pdfPath,
  parser: "sunlife-iul-fitztables-v1",
});
fs.writeFileSync(normalizedPath, JSON.stringify(normalized, null, 2), "utf8");

const formalIssues = validateFormalIulPlan(normalized);
assert.equal(formalIssues.filter((issue) => issue.level === "error").length, 0, JSON.stringify(formalIssues, null, 2));

const companyContext = matchCompanyKnowledge({
  productName: `${normalized.productName} 新加坡 IUL`,
  companyHint: "永明 新加坡 Sun Life",
  forcedCompanyId: "sunlife",
});
fs.writeFileSync(
  companyContextPath,
  JSON.stringify({ companyId: companyContext.companyId, ...buildTemplateCompanyContext(companyContext) }, null, 2),
  "utf8",
);

const render = spawnSync("python3.11", [
  path.resolve("scripts/render_iul_formal_pptx.py"),
  "--normalized",
  normalizedPath,
  "--company-context",
  companyContextPath,
  "--output",
  pptxPath,
], { stdio: "inherit" });

if (render.status !== 0) {
  throw new Error(`render_iul_formal_pptx.py exited ${render.status}`);
}

assert.equal(fs.existsSync(pptxPath), true);

console.log(JSON.stringify({
  status: "ok",
  pptxPath,
  rawPath,
  normalizedPath,
  companyContext: {
    companyId: companyContext.companyId,
    companyName: companyContext.companyName,
    evidenceCount: companyContext.evidenceFiles.length,
  },
  keySummary: {
    insured: normalized.insured,
    sumInsured: normalized.policy.sumInsured,
    initialPremium: normalized.policy.initialPremium,
    annualPremium: normalized.policy.annualPremium,
    paymentPeriod: normalized.policy.paymentPeriod,
    year20: normalized.benefitRows.find((row) => row.policyYear === 20),
  },
}, null, 2));
