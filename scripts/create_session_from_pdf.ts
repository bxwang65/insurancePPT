/**
 * 从 PDF 提取并保存为 session (供 formal pipeline 消费)
 */
import { tryFastExtraction } from "../src/extraction/fast-path.ts";
import { toSavingsPlanFromSignature } from "../src/extraction/fast-path-adapter.ts";
import fs from "fs";
import path from "path";

const PDF = process.argv[2];
const sessionId = process.argv[3] || path.basename(PDF, ".pdf").replace(/[^a-z0-9]/gi, "_").toLowerCase();
if (!PDF || !fs.existsSync(PDF)) { console.error("用法: bun run scripts/create_session_from_pdf.ts <pdf> [session_id]"); process.exit(1); }

const fast = await tryFastExtraction(PDF, { minConfidence: 0.5 });
if (!fast.matched || !fast.data || !fast.signature) { console.error("签名未命中"); process.exit(2); }

const plan = toSavingsPlanFromSignature(fast.data, fast.signature.id, fast.signature.productName);
(plan as any).source = {
  pdfHash: "",
  pdfPath: PDF,
  parser: "signature_fast_path",
  signatureId: fast.signature.id,
};
const session = {
  id: sessionId,
  ownerId: "local",
  files: [{ path: PDF, name: path.basename(PDF), type: "savings" }],
  status: "done",
  extractions: [{ pdfName: path.basename(PDF), planType: "savings", data: plan }],
};

const outPath = path.resolve("sessions", `${sessionId}.json`);
fs.writeFileSync(outPath, JSON.stringify(session, null, 2), "utf8");
console.log(`✓ Session saved: ${outPath}`);
console.log(`  Signature: ${fast.signature.id} (${(fast.match?.confidence! * 100).toFixed(0)}%)`);
console.log(`  Benefit rows: ${plan.benefit_illustration.length}`);
console.log(`  Withdrawal rows: ${plan.withdrawal_illustration.length}`);
console.log(`\n用法: bun run pipeline --session ${sessionId} --tenant ${fast.signature.companyId} --user boxie --customer "客户" --style chinese`);
