import { tryFastExtraction } from "../src/extraction/fast-path.ts";
import { toSavingsPlanFromSignature } from "../src/extraction/fast-path-adapter.ts";
import { normalizeSavingsPlan } from "../src/savings/savings-normalizer.ts";
import { validateFormalSavingsPlan } from "../src/savings/formal-deck-validator.ts";
import { renderFastPptx } from "../src/render/fast-pptx.ts";
import { buildDeckContract, savingsToDeckProduct } from "../src/render/normalized-deck.ts";
import { loadCompanyCatalog } from "../src/config/catalog-loader.ts";
import crypto from "crypto";
import fs from "fs";

const PDF = "/Users/soldier/Downloads/宏挚家传承保险计划.pdf";
const fileBuf = fs.readFileSync(PDF);
const pdfHash = crypto.createHash("sha256").update(fileBuf).digest("hex");

for (let i = 1; i <= 5; i++) {
  const t0 = Date.now();
  const fast = await tryFastExtraction(PDF, { minConfidence: 0.5 });
  if (!fast.matched || !fast.data || !fast.signature) { console.error(`Iter ${i}: miss`); process.exit(1); }
  const plan = toSavingsPlanFromSignature(fast.data, fast.signature.id, fast.signature.productName);
  (plan as any).source = { pdfHash, pdfPath: PDF, parser: "stab", signatureId: fast.signature.id };
  const normalized = normalizeSavingsPlan(plan, { pdfPath: PDF, parser: "stab", signatureId: fast.signature.id } as any);
  const issues = validateFormalSavingsPlan(normalized);
  if (issues.filter((x) => x.level === "error").length > 0) { console.error(`Iter ${i}: err`); process.exit(1); }
  const product = savingsToDeckProduct(normalized, plan.sales_insights as any);
  const company = loadCompanyCatalog().find((c) => c.id === "manulife")!;
  const deck = buildDeckContract({
    customer: { name: product.insured.name }, tenantId: "manulife", stylePreset: "fast", quality: "high", outputFormat: "pptx", outputStem: `m_${i}`,
    company: { id: company.id, displayName: company.displayName, shortEn: "Manulife", evidence: company.companyHighlights || [] },
    products: [product],
    meta: { pdfHash, pdfPath: PDF, parser: "stab", signatureId: fast.signature.id, productCode: fast.signature.productCode, extractedAt: new Date().toISOString() },
    signature: fast.signature,
    fidelity: { passed: true, issueCount: 0, errors: 0, warnings: 0, crossCheckPassRate: 1 },
  });
  const r = await renderFastPptx(deck, { outputPath: `/tmp/manulife_stab_${i}.pptx`, theme: "deepblue" });
  const dt = Date.now() - t0;
  console.log(`Iter ${i}: ${dt}ms, ${(r.size/1024).toFixed(1)}KB, ${r.slides} slides`);
}
console.log("\n=== STABILITY 5x PASS ===");
