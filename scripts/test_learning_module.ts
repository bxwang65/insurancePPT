/**
 * Step 3 学习模块快速验证
 * 用一个已知有效 PDF + 模拟 LLM 数据, 走完 learn → re-extract → verify 流程
 */
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { learnAndVerifySignature } from "../src/extraction/signatures/learning.ts";

const TEST_PDF = process.argv[2] || "/Users/soldier/Downloads/财富盈活储蓄保险计划(2).pdf";  // ← 修改为本地测试 PDF

(async () => {
  console.log("Testing learning module with:", TEST_PDF);
  if (!fs.existsSync(TEST_PDF)) {
    console.error("PDF not found, skipping");
    process.exit(1);
  }
  const buf = fs.readFileSync(TEST_PDF);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  console.log("SHA256:", sha.slice(0, 16));

  // 模拟 LLM 提取结果 — 用真实 PDF 提取出的合理数据
  // 这是 AIA 财富盈活储蓄险的样例数据 (5年缴, USD, 35岁女)
  const fakeLlmData = {
    insured: { age: 35, gender: "女" },
    policy: { annual_premium: 100000, premium_payment_period: "5年", total_premium_with_levy: 100500 },
    benefit_illustration: Array.from({ length: 20 }, (_, i) => ({
      policy_year: i + 1,
      // 用真实规律反推: Y1 比 Y1=103 大很多 (因为这是 cathay-style 储蓄险, 早期 cash value 极小)
      // 真实 Y10 = 661695, Y20 = 1391374 (从 re-extraction)
      total_premium_paid: 100000 * Math.min(i + 1, 5),
      total_surrender_value: 50000 * Math.pow(1.08, i),  // 8% 增长近似 Y1=50K, Y20=~234K (但实际是 1.4M)
    })),
  };

  const r = await learnAndVerifySignature({
    pdfPath: TEST_PDF,
    pdfSha256: sha,
    companyId: "test-company",
    productCode: "TEST",
    productName: "Test Product",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["Test"],
    firstPageMustContain: ["受保人"],
    llmData: fakeLlmData,
  });

  console.log("\n=== Learn Result ===");
  console.log("OK:", r.ok);
  console.log("Signature ID:", r.signatureId);
  console.log("Cached path:", r.cachedPath);
  console.log("Re-extraction:", r.reextraction);
  console.log("Verification:", r.verification);
  console.log("Error:", r.error);
})();
