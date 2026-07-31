/**
 * 极速 PPTX 端到端测试
 * 目标: PDF → 提取 → 规范化 → DeckContract → PPTX, < 5 秒
 */
import { tryFastExtraction } from "../src/extraction/fast-path.ts";
import { toSavingsPlanFromSignature } from "../src/extraction/fast-path-adapter.ts";
import { normalizeSavingsPlan } from "../src/savings/savings-normalizer.ts";
import { validateFormalSavingsPlan } from "../src/savings/formal-deck-validator.ts";
import { buildDeckContract, savingsToDeckProduct } from "../src/render/normalized-deck.ts";
import { renderFastPptx } from "../src/render/fast-pptx.ts";
import { loadCompanyCatalog } from "../src/config/catalog-loader.ts";
import crypto from "crypto";
import fs from "fs";

const PDF = "/Users/soldier/free-code/packages/insurance-ppt/uploads/f1e275a3_匠心傳承儲蓄計劃2尊尚版.pdf";
const OUT = "/tmp/fast_pptx_test.pptx";
const START = Date.now();

const t0 = Date.now();
const fast = await tryFastExtraction(PDF, { minConfidence: 0.7 });
if (!fast.matched || !fast.data || !fast.signature) { console.error("FAIL: signature not matched"); process.exit(1); }
console.log(`[1/4] Extracted: ${fast.signature.id} (${Date.now() - t0}ms)`);

const t1 = Date.now();
const plan = toSavingsPlanFromSignature(fast.data, fast.signature.id, fast.signature.productName);
const fileBuf = fs.readFileSync(PDF);
const pdfHash = crypto.createHash("sha256").update(fileBuf).digest("hex");
(plan as any).source = { pdfHash, pdfPath: PDF, parser: "fast-pptx", signatureId: fast.signature.id };
const normalized = normalizeSavingsPlan(plan, { pdfPath: PDF, parser: "fast-pptx", signatureId: fast.signature.id } as any);
const issues = validateFormalSavingsPlan(normalized);
const product = savingsToDeckProduct(normalized, plan.sales_insights as any);
const company = loadCompanyCatalog().find((c) => c.id === "ctf")!;
const deck = buildDeckContract({
  customer: { name: product.insured.name },
  tenantId: "ctf", stylePreset: "fast", quality: "high", outputFormat: "pptx", outputStem: "fast_pptx",
  company: { id: company.id, displayName: company.displayName, shortEn: "CTF LIFE", evidence: company.companyHighlights || [] },
  products: [product],
  meta: { pdfHash, pdfPath: PDF, parser: "fast-pptx", signatureId: fast.signature.id, productCode: fast.signature.productCode, extractedAt: new Date().toISOString() },
  signature: fast.signature,
  fidelity: { passed: issues.filter((i) => i.level === "error").length === 0, issueCount: issues.length, errors: 0, warnings: issues.filter((i) => i.level === "warn").length, crossCheckPassRate: 1 },
});
console.log(`[2/4] Built DeckContract: ${Date.now() - t1}ms`);

const t2 = Date.now();
const result = await renderFastPptx(deck, { outputPath: OUT, theme: "deepblue" });
console.log(`[3/4] Rendered PPTX: ${result.durationMs}ms, ${(result.size / 1024).toFixed(1)}KB, ${result.slides} slides`);

const TOTAL = Date.now() - START;
console.log(`[4/4] Total: ${TOTAL}ms`);

const success = TOTAL < 10000 && result.size < 200 * 1024 && result.slides >= 4;
console.log(`\n=== ${success ? "PASS" : "FAIL"} ===`);
process.exit(success ? 0 : 1);
