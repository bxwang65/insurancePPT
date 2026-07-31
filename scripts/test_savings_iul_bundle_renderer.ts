import path from "path";
import fs from "fs";
import assert from "node:assert/strict";
import { renderSavingsIulBundle } from "../src/bundles/savings-iul-bundle-renderer.ts";
import { matchCompanyKnowledge } from "../src/config/company-kb.ts";

const outDir = path.resolve("outputs/regression_savings_iul_bundle");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const normalizedSavings = JSON.parse(fs.readFileSync("outputs/aia_huanyu_refresh_aia_boxie2_pipeline/normalized-savings.json", "utf8"));
const normalizedIul = JSON.parse(fs.readFileSync("outputs/transamerica_genesis3_case2/normalized-iul.json", "utf8"));

const deck = await renderSavingsIulBundle({
  req: {
    tenantId: "default",
    userId: "bundle-test",
    sessionId: "bundle-test",
    customerName: "Bundle Test Family",
    outputStem: "bundle-test",
    quality: "high",
    format: "pptx",
    stylePreset: "business",
    companyContext: matchCompanyKnowledge({ productName: normalizedSavings.productName, forcedCompanyId: "aia" }),
    extractions: [],
    normalizedSavings,
    normalizedIul,
  },
  outDir,
  outline: { markdownPath: path.join(outDir, "deck.marp.md"), slides: [] },
  images: { assetsDir: path.join(outDir, "assets"), images: [] },
  charts: { assetsDir: path.join(outDir, "charts"), assets: [] },
  tenant: {
    tenantId: "default",
    companyName: "Bundle Test",
    colors: { primary: "#102c49", secondary: "#c9912f", accent: "#e7d7b8", bgStart: "#f8f5ef", bgEnd: "#f0ebe0" },
    fontFamily: "Microsoft YaHei",
    imageWhitelist: {},
  },
});

assert.ok(fs.existsSync(deck.pptxPath));
assert.ok(fs.statSync(deck.pptxPath).size > 100_000);

console.log(JSON.stringify({
  status: "ok",
  pptxPath: deck.pptxPath,
  renderMode: deck.pptxRenderMode,
}, null, 2));
