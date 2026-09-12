/**
 * 队列溢出路由测试
 * 同时提交 8+ 份 PDF (maxConcurrency=5), 验证:
 *  1. 前 5 个走主队列 (minimax)
 *  2. 后 3+ 个触发 overflow, 直接走 Kimi 备用
 *  3. 兜底链: minimax → kimi → agnes 完整可用
 */
import fs from "fs";

const BASE = "http://localhost:80";
const PDF = "/tmp/test_manulife.pdf";

if (!fs.existsSync(PDF)) {
  console.error(`PDF not found: ${PDF}`);
  process.exit(1);
}

console.log(`📄 Using PDF: ${PDF}`);
console.log(`🚀 Launching 8 concurrent requests to trigger queue overflow...\n`);

async function uploadAndParse(idx: number) {
  const fd = new FormData();
  const buf = fs.readFileSync(PDF);
  const blob = new Blob([buf], { type: "application/pdf" });
  fd.append("files", blob, `test_${idx}.pdf`);
  fd.append("types", "iul");
  fd.append("companies", "manulife");

  const t0 = Date.now();
  try {
    const uploadRes = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd });
    const upData: any = await uploadRes.json();
    const sessionId = upData.sessionId;
    if (!sessionId) return { idx, error: "upload failed", detail: upData, wallMs: Date.now() - t0 };

    const parseRes = await fetch(`${BASE}/api/parse/${sessionId}`, {
      method: "POST",
      headers: { "X-User-Api-Provider": "minimax" },
    });
    const parseData: any = await parseRes.json();
    return {
      idx,
      ok: true,
      sessionId,
      status: parseData.status,
      wallMs: Date.now() - t0,
    };
  } catch (e: any) {
    return { idx, error: e.message, wallMs: Date.now() - t0 };
  }
}

const t0 = Date.now();
const results = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(uploadAndParse));
const totalWall = Date.now() - t0;

console.log(`⏱  Total wall time: ${totalWall}ms\n`);
console.log("=== Per-request ===");
for (const r of results) {
  if (r.error) {
    console.log(`  #${r.idx} ✗ ${r.error}  (${r.wallMs}ms)`);
  } else {
    console.log(`  #${r.idx} ${r.ok ? "✓" : "?"} status=${r.status}  wall=${r.wallMs}ms`);
  }
}

// Get server logs to check overflow routing
console.log("\n=== Server logs (overflow/fallback) ===");
const { execSync } = await import("child_process");
try {
  const logs = execSync(`docker logs insurance-ppt-dev --tail 200 2>&1`).toString();
  const lines = logs.split("\n").filter((l) =>
    /overflow|fallback|primary|success/i.test(l)
  ).slice(-30);
  for (const l of lines) console.log("  " + l);
} catch (e: any) {
  console.log(`  (log fetch failed: ${e.message})`);
}