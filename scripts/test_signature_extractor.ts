/**
 * 按签名提取器冒烟测试
 */
import { getSignatureById } from "../src/extraction/signatures/registry.ts";
import { extractBySignature } from "../src/extraction/signature-extractor.ts";

const PDF = "/Users/soldier/free-code/packages/insurance-ppt/uploads/f1e275a3_匠心傳承儲蓄計劃2尊尚版.pdf";
const SIG = getSignatureById("ctf-mw2iua-v1")!;

if (!SIG) { console.error("Signature not found"); process.exit(1); }

const t0 = Date.now();
const result = await extractBySignature(PDF, SIG);
const dt = Date.now() - t0;

console.log(`\n[CTF MW2IUA] ok=${result.ok} elapsed=${dt}ms`);
console.log(`  summary:`, JSON.stringify(result.summary, null, 2));
console.log(`  paid_total: ${result.paid_total}`);
console.log(`  no_withdraw rows: ${Object.keys(result.no_withdraw).length}`);
console.log(`  withdraw rows: ${Object.keys(result.withdraw).length}`);
console.log(`  diagnostics:`, JSON.stringify(result.diagnostics, null, 2));

// 打印关键里程碑
const nw = result.no_withdraw;
for (const y of [5, 7, 10, 20, 30]) {
  const r = nw[String(y)];
  if (r) console.log(`  Y${y} Total=${r.Total.toLocaleString()} Mult=${r.Mult?.toFixed(2)}x IRR=${(r.IRR! * 100).toFixed(2)}%`);
}

const wd = result.withdraw;
for (const y of [7, 20, 30]) {
  const r = wd[String(y)];
  if (r) console.log(`  WD Y${y} Annual=${r.Annual_WD.toLocaleString()} Cum=${r.Cum_WD.toLocaleString()} Remain=${r.Total.toLocaleString()}`);
}

if (result.diagnostics.warnings.length) {
  console.log(`\n  WARNINGS:`, result.diagnostics.warnings);
  process.exit(2);
}
console.log(`\n=== PASS ===`);
