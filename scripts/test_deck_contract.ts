/**
 * 测试 DeckContract 端到端流转
 */
import { tryFastExtraction } from "../src/extraction/fast-path.ts";
import { toSavingsPlanFromSignature } from "../src/extraction/fast-path-adapter.ts";
import { normalizeSavingsPlan } from "../src/savings/savings-normalizer.ts";
import { validateFormalSavingsPlan } from "../src/savings/formal-deck-validator.ts";
import { buildDeckContract, savingsToDeckProduct } from "../src/render/normalized-deck.ts";
import { loadCompanyCatalog } from "../src/config/catalog-loader.ts";
import crypto from "crypto";
import fs from "fs";

const PDF = "/Users/soldier/free-code/packages/insurance-ppt/uploads/f1e275a3_匠心傳承儲蓄計劃2尊尚版.pdf";

const fast = await tryFastExtraction(PDF, { minConfidence: 0.7 });
if (!fast.matched || !fast.data || !fast.signature) process.exit(1);

const plan = toSavingsPlanFromSignature(fast.data, fast.signature.id, fast.signature.productName);
const fileBuf = fs.readFileSync(PDF);
const pdfHash = crypto.createHash("sha256").update(fileBuf).digest("hex");
(plan as any).source = { pdfHash, pdfPath: PDF, parser: "test", signatureId: fast.signature.id };

const normalized = normalizeSavingsPlan(plan, { pdfPath: PDF, parser: "test" });
const issues = validateFormalSavingsPlan(normalized);
const passCount = (issues.find((i) => i.code === "CROSS_CHECK_PASS") ? 1 : 0);
const errCount = issues.filter((i) => i.level === "error").length;
const warnCount = issues.filter((i) => i.level === "warn" && i.code !== "CROSS_CHECK_PASS").length;

const product = savingsToDeckProduct(normalized, plan.sales_insights as any);
const company = loadCompanyCatalog().find((c) => c.id === "ctf")!;
const deck = buildDeckContract({
  customer: { name: product.insured.name, age: product.insured.age, gender: product.insured.gender },
  tenantId: "ctf",
  stylePreset: "chinese",
  quality: "high",
  outputFormat: "pptx",
  outputStem: "test_deck",
  company: {
    id: company.id,
    displayName: company.displayName,
    shortEn: "CTF LIFE",
    rating: "A.M. Best a-",
    evidence: company.companyHighlights || [],
  },
  products: [product],
  meta: { pdfHash, pdfPath: PDF, parser: "fast-path", signatureId: fast.signature.id, productCode: fast.signature.productCode, extractedAt: new Date().toISOString() },
  signature: fast.signature,
  fidelity: { passed: errCount === 0, issueCount: issues.length, errors: errCount, warnings: warnCount, crossCheckPassRate: passCount },
});

console.log(`\n[Contract] id=${deck.id}`);
console.log(`  customer: ${deck.customer.name} (${deck.customer.age}/${deck.customer.gender})`);
console.log(`  product: ${deck.products[0].productName}`);
console.log(`  benefitRows: ${deck.products[0].benefitRows.length}`);
console.log(`  withdrawalRows: ${deck.products[0].withdrawalRows.length}`);
console.log(`  fidelity: passed=${deck.fidelity.passed} errors=${deck.fidelity.errors} warnings=${deck.fidelity.warnings}`);

// 写出来供 HTML/PDF renderer 测试
const outPath = "/tmp/test_deck_contract.json";
fs.writeFileSync(outPath, JSON.stringify(deck, null, 2));
console.log(`  written: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)}KB)`);

if (deck.fidelity.passed && deck.products[0].benefitRows.length >= 20) {
  console.log(`\n=== PASS ===`);
  process.exit(0);
} else {
  console.log(`\n=== FAIL ===`);
  process.exit(1);
}
