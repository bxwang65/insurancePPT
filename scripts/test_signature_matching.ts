/**
 * 签名匹配扫描器 — 扫所有 PDF, 找出哪些 (公司, 产品) 签名不命中
 * 输出: 哪些 PDF 必须靠 LLM, 哪些走 fast path
 */
import fs from "fs";
import path from "path";
import { matchPdfSignatureAll } from "../src/extraction/signatures/matcher.ts";
import { getAllSignatures } from "../src/extraction/signatures/registry-auto.ts";
import { getFirstPagesSnapshot } from "../src/extraction/pdf-first-pages.ts";
import { detectProductCodeFromText } from "../src/extraction/signatures/matcher.ts";

const ROOT = process.argv[2] || "/tmp/test_pdfs";

interface PdfInfo {
  path: string;
  name: string;
  sizeKB: number;
  companyHint?: string;
  productHint?: string;
}

async function probePdf(pdfPath: string): Promise<{
  text: string;
  matches: Array<{ signatureId: string; company: string; product: string; planType: string; confidence: number; matchedBy: string }>;
  detectedCode: string | null;
  durationMs: number;
}> {
  const t0 = Date.now();
  const snap = await getFirstPagesSnapshot(pdfPath, 2);
  const code = detectProductCodeFromText(snap.firstPagesText);
  const matches = matchPdfSignatureAll({ firstPagesText: snap.firstPagesText, detectedProductCode: code || undefined }, 0.5);
  return {
    text: snap.firstPagesText,
    matches: matches.map((m) => ({
      signatureId: m.signature.id,
      company: m.signature.companyId,
      product: m.signature.productName,
      planType: m.signature.planType,
      confidence: Number(m.confidence.toFixed(3)),
      matchedBy: m.matchedBy,
    })),
    detectedCode: code,
    durationMs: Date.now() - t0,
  };
}

function findPdfs(dir: string, maxDepth = 3): string[] {
  const results: string[] = [];
  function walk(d: string, depth: number) {
    if (depth > maxDepth) return;
    try {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (!e.name.startsWith(".") && e.name !== "_extracted_pdf" && e.name !== "node_modules") {
            walk(p, depth + 1);
          }
        } else if (e.name.toLowerCase().endsWith(".pdf")) {
          // 排除 1MB 以下的 (可能是空/损坏)
          const sz = fs.statSync(p).size;
          if (sz > 100_000) results.push(p);
        }
      }
    } catch {}
  }
  walk(dir, 0);
  return results;
}

const pdfs = findPdfs(ROOT, 4).filter((p) => !p.includes("CRS") && !p.includes("2026") && !p.includes("global") && !p.includes("宏觀") && !p.includes("税务"));
console.log(`📂 Found ${pdfs.length} candidate PDFs\n`);

const results: any[] = [];
for (const p of pdfs) {
  try {
    const r = await probePdf(p);
    const top = r.matches[0];
    const willHitFastPath = top && top.confidence >= 0.7;
    results.push({
      pdf: p.replace(ROOT + "/", ""),
      sizeKB: Math.round(fs.statSync(p).size / 1024),
      detectedCode: r.detectedCode,
      topMatch: top ? `${top.signatureId} (${top.company}/${top.planType}, conf=${top.confidence})` : "NONE",
      willHitFastPath,
      matchesCount: r.matches.length,
      textSnippet: r.text.replace(/\s+/g, " ").slice(0, 120),
    });
  } catch (e: any) {
    results.push({ pdf: p.replace(ROOT + "/", ""), error: e.message.slice(0, 100) });
  }
}

// 汇总
const fastPath = results.filter((r) => r.willHitFastPath);
const needLLM = results.filter((r) => !r.willHitFastPath && !r.error);

console.log("=".repeat(80));
console.log(`✓ 签名命中 (Fast Path): ${fastPath.length}`);
console.log(`✗ 需 LLM (签名不命中或低分): ${needLLM.length}`);
console.log(`! 错误: ${results.filter((r) => r.error).length}`);
console.log("=".repeat(80));

console.log("\n=== 需 LLM 兜底的产品 ===");
const byCompany: Record<string, any[]> = {};
for (const r of needLLM) {
  // 从文件名粗略判断公司
  const fname = path.basename(r.pdf);
  const m = fname.match(/^([^-—–_]+)/);
  const companyGuess = m?.[1] || "Unknown";
  if (!byCompany[companyGuess]) byCompany[companyGuess] = [];
  byCompany[companyGuess].push(r);
}
for (const [c, list] of Object.entries(byCompany).sort()) {
  console.log(`\n📁 ${c} (${list.length} 份):`);
  for (const r of list) {
    console.log(`   ✗ ${r.pdf.slice(0, 80)}`);
    console.log(`     top match: ${r.topMatch}  code=${r.detectedCode || "?"}`);
    console.log(`     text: ${r.textSnippet}...`);
  }
}

console.log("\n=== 签名命中 (Fast Path) ===");
for (const r of fastPath.slice(0, 50)) {
  console.log(`✓ ${r.pdf.slice(0, 70).padEnd(70)}  →  ${r.topMatch}`);
}
if (fastPath.length > 50) console.log(`  ... and ${fastPath.length - 50} more`);