import { getFirstPagesSnapshot } from "../src/extraction/pdf-first-pages.ts";
import { detectProductCodeFromText, matchPdfSignature, matchPdfSignatureAll } from "../src/extraction/signatures/index.ts";

const PDF = "/Users/soldier/Downloads/宏挚家传承保险计划.pdf";

const t0 = Date.now();
const snap = await getFirstPagesSnapshot(PDF, 2);
const code = detectProductCodeFromText(snap.firstPagesText);

console.log(`[Manulife] pages=${snap.totalPages}, detectedCode=${code ?? "?"}`);

const all = matchPdfSignatureAll({ firstPagesText: snap.firstPagesText, detectedProductCode: code }, 0.3);
const best = matchPdfSignature({ firstPagesText: snap.firstPagesText, detectedProductCode: code });

console.log(`\n[Best match] ${best?.signature.id ?? "NONE"} conf=${best?.confidence.toFixed(2) ?? "?"}`);
console.log(`  matchedKeywords=${JSON.stringify(best?.matchedKeywords ?? [])}`);
console.log(`  matchedBy=${best?.matchedBy}`);

console.log(`\n[All candidates above 0.3]`);
for (const m of all) {
  console.log(`  ${m.signature.id} | conf=${m.confidence.toFixed(2)} | by=${m.matchedBy} | kws=[${m.matchedKeywords.join(",")}]`);
}
