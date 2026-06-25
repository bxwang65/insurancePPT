import fs from "fs";
import path from "path";
import { ExtractionOrchestrator } from "../src/extraction/orchestrator.ts";

type PlanType = "savings" | "ci" | "iul";

function inferTypeFromName(name: string): PlanType {
  const n = name.toLowerCase();
  if (n.includes("危疾") || n.includes("守護") || n.includes("守护")) return "ci";
  if (n.includes("iul") || n.includes("genesis") || n.includes("universal")) return "iul";
  return "savings";
}

function scoreExtraction(data: any): { score: number; notes: string[] } {
  let score = 0;
  const notes: string[] = [];
  const rows = Array.isArray(data?.benefit_illustration) ? data.benefit_illustration : [];

  if (data?.product_name) score += 10; else notes.push("missing product_name");
  if (data?.insured?.age != null) score += 10; else notes.push("missing insured age");
  if (data?.policy?.annual_premium != null) score += 10; else notes.push("missing annual premium");
  if (rows.length >= 20) score += 25;
  else if (rows.length >= 10) score += 15;
  else notes.push(`too few benefit rows: ${rows.length}`);

  const nonZeroTSV = rows.filter((r: any) => (r?.total_surrender_value || 0) > 0).length;
  if (nonZeroTSV >= 10) score += 20; else notes.push("weak surrender value coverage");

  if (Array.isArray(data?.sales_insights?.key_selling_points) && data.sales_insights.key_selling_points.length >= 2) {
    score += 15;
  } else {
    notes.push("missing sales insights");
  }

  if (typeof data?.sales_insights?.suggested_narrative === "string" && data.sales_insights.suggested_narrative.length > 8) {
    score += 10;
  } else {
    notes.push("missing narrative");
  }

  return { score: Math.min(100, score), notes };
}

async function main() {
  const dir = process.argv[2] || "/Users/soldier/Downloads/官方计划书案例";
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    console.error("GEMINI_API_KEY is required");
    process.exit(1);
  }

  const files = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => path.join(dir, f));

  if (!files.length) {
    console.error(`No PDF files found in: ${dir}`);
    process.exit(1);
  }

  const orch = new ExtractionOrchestrator({ apiKey, useCache: true });
  const report: any[] = [];

  for (const file of files) {
    const name = path.basename(file);
    const assumed = inferTypeFromName(name);
    const res = await orch.extractPlan(file, assumed);
    const scored = res.data ? scoreExtraction(res.data) : { score: 0, notes: [res.error || "extraction failed"] };
    report.push({
      file: name,
      assumedType: assumed,
      detectedType: res.planType,
      status: res.status,
      durationMs: res.durationMs,
      productName: res.data?.product_name || null,
      yearRows: res.data?.benefit_illustration?.length || 0,
      qualityScore: scored.score,
      notes: scored.notes,
    });
    console.log(`${name} => ${scored.score}/100 (${res.status})`);
  }

  const outPath = path.resolve("outputs/case-evaluation.json");
  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceDir: dir,
    total: report.length,
    avgScore: report.reduce((a, r) => a + r.qualityScore, 0) / report.length,
    items: report,
  }, null, 2));

  console.log(`\nSaved evaluation report: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

