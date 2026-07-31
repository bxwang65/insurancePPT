/**
 * PDF 签名注册表测试
 */
import { getFirstPagesSnapshot } from "../src/extraction/pdf-first-pages.ts";
import { detectProductCodeFromText, matchPdfSignature, matchPdfSignatureAll, SIGNATURES } from "../src/extraction/signatures/index.ts";

const SAMPLES = [
  "/Users/soldier/free-code/packages/insurance-ppt/uploads/f1e275a3_匠心傳承儲蓄計劃2尊尚版.pdf",
];

let pass = 0;
let fail = 0;

for (const pdf of SAMPLES) {
  try {
    const snap = await getFirstPagesSnapshot(pdf, 2);
    const code = detectProductCodeFromText(snap.firstPagesText);
    const all = matchPdfSignatureAll({ firstPagesText: snap.firstPagesText, detectedProductCode: code }, 0.3);
    const best = matchPdfSignature({ firstPagesText: snap.firstPagesText, detectedProductCode: code });
    console.log(`\n[${pdf.split("/").pop()}]`);
    console.log(`  pages=${snap.totalPages} detectedCode=${code ?? "?"} best=${best?.signature.id ?? "NONE"} conf=${best?.confidence.toFixed(2) ?? "?"}`);
    console.log(`  matchedKeywords=${JSON.stringify(best?.matchedKeywords ?? [])} matchedBy=${best?.matchedBy}`);
    console.log(`  candidates=${all.length} (${all.slice(0, 3).map((m) => `${m.signature.id}:${m.confidence.toFixed(2)}`).join(", ")})`);
    if (best) pass++;
    else fail++;
  } catch (e: any) {
    console.log(`[ERROR] ${pdf}: ${e.message}`);
    fail++;
  }
}

console.log(`\n=== ${pass} pass / ${fail} fail (signatures registered: ${SIGNATURES.length}) ===`);
process.exit(fail ? 1 : 0);
