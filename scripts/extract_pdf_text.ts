/**
 * 提取 4 类需 LLM 的 PDF 前 2 页文本, 帮设计签名关键词
 */
import { getFirstPagesSnapshot } from "../src/extraction/pdf-first-pages.ts";

const TARGETS = [
  "/tmp/test_pdfs/愛伴航保險計劃2.pdf",
  "/tmp/test_pdfs/愛伴航保險計劃2(1).pdf",
  "/tmp/test_pdfs/愛伴航保險計劃2(2).pdf",
  "/tmp/test_pdfs/環宇盈活儲蓄保險計劃.pdf",
  "/tmp/test_pdfs/環宇盈活儲蓄保險計劃(1).pdf",
  "/tmp/test_pdfs/TA_GIUL3+M-46-N-CN-USD-S2m-5x+(coi)(SC).pdf",
  "/tmp/test_pdfs/B0F85256951A427E876B6610ACD5E4C6.pdf",
];

for (const p of TARGETS) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📄 ${p.split("/").pop()}`);
  console.log(`${"=".repeat(80)}`);
  const snap = await getFirstPagesSnapshot(p, 2);
  console.log(snap.firstPagesText.replace(/\n+/g, " | ").slice(0, 1500));
  console.log("\n--- 关键字段 ---");
  console.log("页数:", snap.totalPages);
  // 找产品代号 (类似 IUL 模板: TA_GIUL3+M-46-N...)
  const codeMatch = snap.firstPagesText.match(/[A-Z]{2,3}_[A-Z0-9+\-]+/);
  if (codeMatch) console.log("产品代号候选:", codeMatch[0]);
}