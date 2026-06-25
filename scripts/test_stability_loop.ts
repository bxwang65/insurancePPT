/**
 * 稳定性压力测试 (5 次连续 fast path)
 */
import { tryFastExtraction } from "../src/extraction/fast-path.ts";
import { toSavingsPlanFromSignature } from "../src/extraction/fast-path-adapter.ts";
import { normalizeSavingsPlan } from "../src/savings/savings-normalizer.ts";
import { validateFormalSavingsPlan } from "../src/savings/formal-deck-validator.ts";
import { renderFastPptx } from "../src/render/fast-pptx.ts";
import { buildDeckContract, savingsToDeckProduct } from "../src/render/normalized-deck.ts";
import { loadCompanyCatalog } from "../src/config/catalog-loader.ts";
import crypto from "crypto";
import fs from "fs";

const PDF = "/Users/soldier/free-code/packages/insurance-ppt/uploads/f1e275a3_匠心傳承儲蓄計劃2尊尚版.pdf";
const N = 5;
const fileBuf = fs.readFileSync(PDF);
const pdfHash = crypto.createHash("sha256").update(fileBuf).digest("hex");

const times: number[] = [];
const sizes: number[] = [];
for (let i = 1; i <= N; i++) {
  const t0 = Date.now();
  const fast = await tryFastExtraction(PDF, { minConfidence: 0.7 });
  if (!fast.matched || !fast.data || !fast.signature) { console.error(`Iter ${i}: signature miss`); process.exit(1); }
  const plan = toSavingsPlanFromSignature(fast.data, fast.signature.id, fast.signature.productName);
  (plan as any).source = { pdfHash, pdfPath: PDF, parser: "stability", signatureId: fast.signature.id };
  const normalized = normalizeSavingsPlan(plan, { pdfPath: PDF, parser: "stability", signatureId: fast.signature.id } as any);
  const issues = validateFormalSavingsPlan(normalized);
  if (issues.filter((x) => x.level === "error").length > 0) { console.error(`Iter ${i}: validation errors`); process.exit(1); }
  const product = savingsToDeckProduct(normalized, plan.sales_insights as any);
  const company = loadCompanyCatalog().find((c) => c.id === "ctf")!;
  const deck = buildDeckContract({
    customer: { name: product.insured.name }, tenantId: "ctf", stylePreset: "fast", quality: "high", outputFormat: "pptx", outputStem: `loop_${i}`,
    company: { id: company.id, displayName: company.displayName, shortEn: "CTF", evidence: [] },
    products: [product],
    meta: { pdfHash, pdfPath: PDF, parser: "stability", signatureId: fast.signature.id, productCode: fast.signature.productCode, extractedAt: new Date().toISOString() },
    signature: fast.signature,
    fidelity: { passed: true, issueCount: 0, errors: 0, warnings: 0, crossCheckPassRate: 1 },
  });
  const r = await renderFastPptx(deck, { outputPath: `/tmp/stability_${i}.pptx`, theme: "deepblue" });
  const dt = Date.now() - t0;
  times.push(dt);
  sizes.push(r.size);
  console.log(`Iter ${i}: ${dt}ms, ${(r.size / 1024).toFixed(1)}KB, ${r.slides} slides`);
}

const avg = times.reduce((a, b) => a + b, 0) / N;
const max = Math.max(...times);
const min = Math.min(...times);
const sizeVar = Math.max(...sizes) - Math.min(...sizes);
console.log(`\n=== STABILITY ${N}× PASS ===`);
console.log(`Times: avg=${avg.toFixed(0)}ms min=${min}ms max=${max}ms (jitter ${(max - min)}ms)`);
console.log(`Sizes: ${sizes.map((s) => (s / 1024).toFixed(1) + "KB").join(", ")} (delta ${(sizeVar / 1024).toFixed(1)}KB)`);
process.exit(0);
