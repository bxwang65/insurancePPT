/**
 * 关键数字交叉验证测试
 */
import { tryFastExtraction } from "../src/extraction/fast-path.ts";
import { toSavingsPlanFromSignature } from "../src/extraction/fast-path-adapter.ts";
import { normalizeSavingsPlan } from "../src/savings/savings-normalizer.ts";
import { validateFormalSavingsPlan } from "../src/savings/formal-deck-validator.ts";
import { crossValidateSavings } from "../src/savings/cross-validator.ts";
import path from "path";
import fs from "fs";

const PDF = "/Users/soldier/free-code/packages/insurance-ppt/uploads/f1e275a3_匠心傳承儲蓄計劃2尊尚版.pdf";

const fast = await tryFastExtraction(PDF, { minConfidence: 0.7 });
if (!fast.matched || !fast.data || !fast.signature) {
  console.error("Fast path did not match");
  process.exit(1);
}

const plan = toSavingsPlanFromSignature(fast.data, fast.signature.id, fast.signature.productName);
const fileBuf = fs.readFileSync(PDF);
const pdfHash = (await import("crypto")).createHash("sha256").update(fileBuf).digest("hex");
(plan as any).source = { pdfHash, pdfPath: PDF, parser: "fast-path-test", signatureId: fast.signature.id };

const normalized = normalizeSavingsPlan(plan, { pdfPath: PDF, parser: "fast-path" });

console.log(`\n[Cross-validate] signatureId=${fast.signature.id}`);
const crossIssues = crossValidateSavings(normalized, fast.signature.id);
for (const issue of crossIssues) {
  console.log(`  [${issue.level.toUpperCase()}] ${issue.code}: ${issue.message}`);
}

console.log(`\n[Formal-deck-validate]`);
const issues = validateFormalSavingsPlan(normalized);
const errors = issues.filter((i) => i.level === "error");
const warnings = issues.filter((i) => i.level === "warn");
console.log(`  errors: ${errors.length}, warnings: ${warnings.length}`);
for (const e of errors) console.log(`  E: ${e.code}: ${e.message}`);
for (const w of warnings.slice(0, 5)) console.log(`  W: ${w.code}: ${w.message}`);

const hasPass = crossIssues.some((i) => i.code === "CROSS_CHECK_PASS");
console.log(`\n=== ${hasPass ? "PASS" : "FAIL"} ===`);
process.exit(hasPass ? 0 : 1);
