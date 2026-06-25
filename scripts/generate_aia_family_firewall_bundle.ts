import fs from "fs";
import path from "path";
import { renderSavingsCiBundle } from "../src/bundles/savings-ci-bundle-renderer.ts";
import { matchCompanyKnowledge } from "../src/config/company-kb.ts";
import type { PipelineRequest } from "../src/pipeline/types.ts";

const outDir = path.resolve("outputs/aia_family_firewall_education_bundle");
const savings = JSON.parse(fs.readFileSync("outputs/aia_huanyu_refresh_aia_boxie2_pipeline/normalized-savings.json", "utf8"));
const ci = JSON.parse(fs.readFileSync("outputs/aia_aibanhang_ci_formal/normalized-ci.json", "utf8"));

const companyContext = matchCompanyKnowledge({
  productName: `${savings.productName} ${ci.productName}`,
  forcedCompanyId: "aia",
});

const req: PipelineRequest = {
  tenantId: "aia",
  userId: "boxie",
  sessionId: "aia-family-firewall-demo",
  customerName: "Boxie 家庭",
  outputStem: "aia-family-firewall-demo",
  quality: "high",
  format: "pptx",
  stylePreset: "business",
  companyContext,
  extractions: [],
  normalizedSavings: savings,
  normalizedCi: ci,
};

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const result = await renderSavingsCiBundle({
  req,
  outDir,
  outline: { markdownPath: path.join(outDir, "deck.marp.md"), slides: [] },
  images: { assetsDir: path.join(outDir, "assets"), images: [] },
  charts: { assetsDir: path.join(outDir, "charts"), assets: [] },
  tenant: {
    tenantId: "aia",
    companyName: "友邦保险",
    colors: { primary: "#102c49", secondary: "#c9912f", accent: "#e7d7b8", bgStart: "#f8f5ef", bgEnd: "#f0ebe0" },
    fontFamily: "Microsoft YaHei",
    imageWhitelist: {},
  },
});

console.log(JSON.stringify({
  status: "ok",
  outDir,
  pptx: result.pptxPath,
  renderMode: result.pptxRenderMode,
}, null, 2));
