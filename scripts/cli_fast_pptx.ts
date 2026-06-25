#!/usr/bin/env bun
/**
 * Fast PPTX CLI - PDF → 极速 PPTX (< 5s, < 100KB)
 *
 * 用法:
 *   bun run fpg <pdf_path> [--out OUT_PATH] [--theme deepblue|caramel|chinese]
 */
import { tryFastExtraction } from "../src/extraction/fast-path.ts";
import { toSavingsPlanFromSignature } from "../src/extraction/fast-path-adapter.ts";
import { normalizeSavingsPlan } from "../src/savings/savings-normalizer.ts";
import { validateFormalSavingsPlan } from "../src/savings/formal-deck-validator.ts";
import { buildDeckContract, savingsToDeckProduct } from "../src/render/normalized-deck.ts";
import { renderFastPptx, type FastTheme } from "../src/render/fast-pptx.ts";
import { loadCompanyCatalog } from "../src/config/catalog-loader.ts";
import crypto from "crypto";
import fs from "fs";
import path from "path";

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const pdfPath = process.argv[2];
if (!pdfPath || pdfPath.startsWith("--")) {
  console.error("用法: bun run fpg <pdf_path> [--out OUT_PATH] [--theme deepblue|caramel|chinese]");
  process.exit(1);
}
if (!fs.existsSync(pdfPath)) { console.error(`文件不存在: ${pdfPath}`); process.exit(1); }

const outPath = getArg("--out") || path.join("outputs", `fast_${path.basename(pdfPath, ".pdf")}_${Date.now()}.pptx`);
const theme = (getArg("--theme") as FastTheme) || "deepblue";
const tenantHint = getArg("--tenant") || "default";

const START = Date.now();
console.log(`\n[fpg] PDF: ${pdfPath}`);
console.log(`[fpg] OUT: ${outPath}  THEME: ${theme}\n`);

const fast = await tryFastExtraction(pdfPath, { minConfidence: 0.7 });
if (!fast.matched || !fast.data || !fast.signature) {
  console.error(`✗ 签名未命中 (reason: ${fast.reason ?? "unknown"})`);
  console.error(`  请确认 PDF 来自已注册公司, 或先用 --tenant 强制公司`);
  process.exit(2);
}
console.log(`✓ 签名命中: ${fast.signature.id} (${(fast.match?.confidence! * 100).toFixed(0)}%)`);

const plan = toSavingsPlanFromSignature(fast.data, fast.signature.id, fast.signature.productName);
const fileBuf = fs.readFileSync(pdfPath);
const pdfHash = crypto.createHash("sha256").update(fileBuf).digest("hex");
(plan as any).source = { pdfHash, pdfPath, parser: "cli-fast", signatureId: fast.signature.id };
const normalized = normalizeSavingsPlan(plan, { pdfPath, parser: "cli-fast", signatureId: fast.signature.id } as any);
const issues = validateFormalSavingsPlan(normalized);
const crossPass = issues.some((i) => i.code === "CROSS_CHECK_PASS");
console.log(`✓ 规范化: ${normalized.benefitRows.length} 利益行, ${normalized.withdrawalRows.length} 提领行`);
console.log(`✓ 校验: errors=${issues.filter((i) => i.level === "error").length}, cross-check=${crossPass ? "PASS" : "FAIL"}`);

const product = savingsToDeckProduct(normalized, plan.sales_insights as any);
const company = loadCompanyCatalog().find((c) => c.id === (tenantHint !== "default" ? tenantHint : fast.signature.companyId))!;
const deck = buildDeckContract({
  customer: { name: product.insured.name },
  tenantId: fast.signature.companyId, stylePreset: "fast", quality: "high", outputFormat: "pptx", outputStem: path.basename(outPath, ".pptx"),
  company: { id: company?.id || fast.signature.companyId, displayName: company?.displayName || fast.signature.companyId, shortEn: (fast.signature.companyId || "").toUpperCase(), evidence: company?.companyHighlights || [] },
  products: [product],
  meta: { pdfHash, pdfPath, parser: "cli-fast", signatureId: fast.signature.id, productCode: fast.signature.productCode, extractedAt: new Date().toISOString() },
  signature: fast.signature,
  fidelity: { passed: issues.filter((i) => i.level === "error").length === 0, issueCount: issues.length, errors: 0, warnings: issues.filter((i) => i.level === "warn").length, crossCheckPassRate: crossPass ? 1 : 0 },
});

const result = await renderFastPptx(deck, { outputPath: outPath, theme });
const TOTAL = Date.now() - START;
console.log(`\n✓ 完成: ${result.path} (${(result.size / 1024).toFixed(1)}KB, ${result.slides} slides)`);
console.log(`⏱  总耗时: ${TOTAL}ms`);
