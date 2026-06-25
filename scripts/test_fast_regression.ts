/**
 * 快速路径综合回归测试
 *
 * 验证: PDF → 签名匹配 → 专用提取 → 数据规范化 → Fidelity 检查
 *        → 关键数字交叉验证 → DeckContract 端到端不破
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
const START = Date.now();
const t0 = Date.now();
const fast = await tryFastExtraction(PDF, { minConfidence: 0.7 });
const tFast = Date.now() - t0;
if (!fast.matched || !fast.data || !fast.signature) { console.error("FAIL: signature not matched"); process.exit(1); }
console.log(`[1/6] Signature matched: ${fast.signature.id} (${tFast}ms)`);

const t1 = Date.now();
const plan = toSavingsPlanFromSignature(fast.data, fast.signature.id, fast.signature.productName);
const fileBuf = fs.readFileSync(PDF);
const pdfHash = crypto.createHash("sha256").update(fileBuf).digest("hex");
(plan as any).source = { pdfHash, pdfPath: PDF, parser: "regression", signatureId: fast.signature.id };
const tAdapter = Date.now() - t1;
console.log(`[2/6] Adapter: ${tAdapter}ms → ${plan.benefit_illustration.length} benefit rows`);

const t2 = Date.now();
const normalized = normalizeSavingsPlan(plan, { pdfPath: PDF, parser: "regression", signatureId: fast.signature.id } as any);
const tNorm = Date.now() - t2;
console.log(`[3/6] Normalizer: ${tNorm}ms → ${normalized.benefitRows.length} normalized benefit rows`);

const t3 = Date.now();
const issues = validateFormalSavingsPlan(normalized);
const errCount = issues.filter((i) => i.level === "error").length;
const tValidate = Date.now() - t3;
const crossPass = issues.some((i) => i.code === "CROSS_CHECK_PASS");
console.log(`[4/6] Formal validation: ${tValidate}ms → errors=${errCount}, cross-check pass=${crossPass}`);
if (errCount > 0 || !crossPass) { console.error("FAIL: validation errors or cross-check failed"); process.exit(1); }

const t4 = Date.now();
const product = savingsToDeckProduct(normalized, plan.sales_insights as any);
const company = loadCompanyCatalog().find((c) => c.id === "ctf")!;
const deck = buildDeckContract({
  customer: { name: product.insured.name },
  tenantId: "ctf", stylePreset: "chinese", quality: "high", outputFormat: "pptx", outputStem: "fast_regression",
  company: { id: company.id, displayName: company.displayName, shortEn: "CTF LIFE", evidence: company.companyHighlights || [] },
  products: [product],
  meta: { pdfHash, pdfPath: PDF, parser: "regression", signatureId: fast.signature.id, productCode: fast.signature.productCode, extractedAt: new Date().toISOString() },
  signature: fast.signature,
  fidelity: { passed: true, issueCount: issues.length, errors: 0, warnings: issues.filter((i) => i.level === "warn").length, crossCheckPassRate: crossPass ? 1 : 0 },
});
const tContract = Date.now() - t4;
console.log(`[5/6] DeckContract: ${tContract}ms → ${deck.id}`);

const t5 = Date.now();
const keyChecks = {
  has80BenefitRows: deck.products[0].benefitRows.length === 80,
  has127WithdrawRows: deck.products[0].withdrawalRows.length === 127,
  y30Multiple: deck.products[0].benefitRows[29]?.totalSurrenderValue === 2782754,
  y20Cum: deck.products[0].withdrawalRows[19]?.cumulativeWithdrawal === 525006,
  fidelityPass: deck.fidelity.passed,
};
const allPass = Object.values(keyChecks).every(Boolean);
console.log(`[6/6] Key checks: ${Object.entries(keyChecks).map(([k, v]) => `${k}=${v}`).join(", ")}`);

const TOTAL = Date.now() - START;
console.log(`\n=== ${allPass ? "PASS" : "FAIL"} (total ${TOTAL}ms) ===`);
process.exit(allPass ? 0 : 1);
