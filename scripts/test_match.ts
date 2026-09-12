import { matchPdfSignatureAll, detectProductCodeFromText } from "../src/extraction/signatures/matcher.ts";
import { getFirstPagesSnapshot } from "../src/extraction/pdf-first-pages.ts";

const pdfPath = process.argv[2] || "/opt/insurance-ppt/uploads/local/3347b4ab-8566-4191-b029-a406a4f87def_AIA-CFYH-80K-sp.pdf";
const snap = await getFirstPagesSnapshot(pdfPath, 2);
const code = detectProductCodeFromText(snap.firstPagesText);
console.log("detectedCode:", code);
console.log("text length:", snap.firstPagesText.length);
console.log("---text snippet---");
console.log(snap.firstPagesText.slice(0, 600));
console.log("---");
const matches = matchPdfSignatureAll({ firstPagesText: snap.firstPagesText, detectedProductCode: code || undefined }, 0.5);
matches.forEach(m => {
  console.log(`  ${m.signature.id}  conf=${m.confidence.toFixed(3)}  by=${m.matchedBy}  matched=${m.matchedKeywords.join(",")}`);
});
