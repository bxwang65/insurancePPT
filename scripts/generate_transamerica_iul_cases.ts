import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import assert from "node:assert/strict";
import { validateIulExtraction } from "../src/schemas/iul.ts";
import { normalizeIulPlan } from "../src/iul/iul-normalizer.ts";
import { validateFormalIulPlan } from "../src/iul/formal-iul-validator.ts";
import { matchCompanyKnowledge } from "../src/config/company-kb.ts";
import { buildTemplateCompanyContext } from "../src/templates/company-context.ts";

const cases = [
  {
    pdfPath: "/Users/soldier/Downloads/官方计划书案例/B0F85256951A427E876B6610ACD5E4C6.pdf",
    outDir: path.resolve("outputs/transamerica_genesis3_case1"),
  },
  {
    pdfPath: "/Users/soldier/Downloads/官方计划书案例/TA_GIUL3+M-46-N-CN-USD-S2m-5x+(coi)(SC).pdf",
    outDir: path.resolve("outputs/transamerica_genesis3_case2"),
  },
];

for (const item of cases) {
  fs.rmSync(item.outDir, { recursive: true, force: true });
  fs.mkdirSync(item.outDir, { recursive: true });

  const rawPath = path.join(item.outDir, "raw-iul.json");
  const normalizedPath = path.join(item.outDir, "normalized-iul.json");
  const companyContextPath = path.join(item.outDir, "company-context.json");
  const pptxPath = path.join(item.outDir, "deck.pptx");

  const extract = spawnSync("python3.11", [
    path.resolve("scripts/extract_transamerica_iul_case.py"),
    "--pdf",
    item.pdfPath,
    "--output",
    rawPath,
  ], { stdio: "inherit" });
  if (extract.status !== 0) {
    throw new Error(`extract_transamerica_iul_case.py exited ${extract.status}`);
  }

  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  const validation = validateIulExtraction(raw);
  assert.equal(validation.success, true, JSON.stringify(validation.errors, null, 2));

  const normalized = normalizeIulPlan(validation.data, {
    pdfPath: item.pdfPath,
    parser: "transamerica-iul-lines-v1",
  });
  fs.writeFileSync(normalizedPath, JSON.stringify(normalized, null, 2), "utf8");

  const formalIssues = validateFormalIulPlan(normalized);
  assert.equal(formalIssues.filter((issue) => issue.level === "error").length, 0, JSON.stringify(formalIssues, null, 2));

  const companyContext = matchCompanyKnowledge({
    productName: `${normalized.productName} IUL`,
    companyHint: "全美人壽 Transamerica",
    forcedCompanyId: "transamerica",
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

  console.log(JSON.stringify({
    status: "ok",
    pdfPath: item.pdfPath,
    outDir: item.outDir,
    pptxPath,
    insured: normalized.insured,
    productName: normalized.productName,
    sumInsured: normalized.policy.sumInsured,
    initialPremium: normalized.policy.initialPremium,
    annualPremium: normalized.policy.annualPremium,
    paymentPeriod: normalized.policy.paymentPeriod,
    year20: normalized.benefitRows.find((row) => row.policyYear === 20),
  }, null, 2));
}
