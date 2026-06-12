import fs from "fs";
import path from "path";
import { MultiAgentPipeline } from "../src/pipeline/orchestrator.ts";
import { matchCompanyKnowledge } from "../src/config/company-kb.ts";
import { mapSavingsMetrics } from "../src/savings/savings-mapper.ts";

const pdfPath = process.argv[2] || "/Users/soldier/Downloads/官方计划书案例/環宇盈活儲蓄保險計劃.pdf";
const sourceSession = process.argv[3] || "sessions/e8ef5a82.json";
if (!fs.existsSync(pdfPath)) throw new Error(`PDF missing: ${pdfPath}`);
if (!fs.existsSync(sourceSession)) throw new Error(`metadata session missing: ${sourceSession}`);

const saved = JSON.parse(fs.readFileSync(sourceSession, "utf8"));
const extraction = saved.extractions.find((entry: any) => entry.data?.insured?.age === 1 && entry.data?.benefit_illustration?.length >= 90);
if (!extraction?.data) throw new Error("No reusable semantic metadata found in source session");

const company = matchCompanyKnowledge({ productName: extraction.data.product_name });
if (company.companyId === "unknown") throw new Error("Company catalog did not identify the product");

const outputStem = `formal_${path.basename(pdfPath, ".pdf")}_${Date.now()}`;
const pipeline = new MultiAgentPipeline();
const result = await pipeline.run({
  tenantId: company.companyId,
  userId: "formal-demo",
  sessionId: outputStem,
  outputStem,
  customerName: extraction.data.insured.name,
  quality: "high",
  format: "both",
  stylePreset: "chinese",
  companyContext: company,
  savingsMetrics: mapSavingsMetrics(extraction.data),
  extractions: [{
    pdfName: path.basename(pdfPath),
    pdfPath,
    planType: "savings",
    data: extraction.data,
  }],
});

console.log(JSON.stringify(result, null, 2));
