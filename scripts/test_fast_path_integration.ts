/**
 * 集成测试: signature fast path 在 orchestrator 中是否生效
 */
import { ExtractionOrchestrator } from "../src/extraction/orchestrator.ts";

const PDF = "/Users/soldier/free-code/packages/insurance-ppt/uploads/f1e275a3_匠心傳承儲蓄計劃2尊尚版.pdf";
const orchestrator = new ExtractionOrchestrator({
  apiKey: "fake-key-for-fast-path-test",  // 不会被用到
  useCache: false,
});

const t0 = Date.now();
const result = await orchestrator.extractPlan(PDF, "savings");
const dt = Date.now() - t0;

console.log(`\n[Integration] status=${result.status} elapsed=${dt}ms planType=${result.planType}`);
console.log(`  productName: ${result.productName}`);
console.log(`  benefit_illustration rows: ${(result.data as any)?.benefit_illustration?.length ?? 0}`);
console.log(`  withdrawal_illustration rows: ${(result.data as any)?.withdrawal_illustration?.length ?? 0}`);
console.log(`  error: ${result.error ?? "none"}`);

if (result.status === "success" && dt < 10000) {
  console.log(`\n=== PASS (fast path active, <10s) ===`);
  process.exit(0);
} else {
  console.log(`\n=== FAIL (status=${result.status}, dt=${dt}ms) ===`);
  process.exit(1);
}
