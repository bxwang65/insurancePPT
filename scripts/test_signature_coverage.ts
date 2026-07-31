/**
 * 测试签名覆盖率
 */
import { SIGNATURES } from "../src/extraction/signatures/registry.ts";
import { getAutoSignatures, getAllSignatures } from "../src/extraction/signatures/registry-auto.ts";

const manual = SIGNATURES.length;
const auto = getAutoSignatures().length;
const total = getAllSignatures().length;

console.log(`\n[Signature Coverage]`);
console.log(`  Manual signatures: ${manual}`);
console.log(`  Auto-generated:    ${auto}`);
console.log(`  Total coverage:    ${total} signatures`);
console.log(`\nAuto signatures detail:`);
for (const s of getAutoSignatures()) {
  console.log(`  - ${s.id} | ${s.companyId} | ${s.productName}`);
}

console.log(`\n=== ${total > manual ? "PASS" : "WEAK (only manual)"} ===`);
