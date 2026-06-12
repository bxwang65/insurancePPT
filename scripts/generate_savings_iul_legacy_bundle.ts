import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { matchCompanyKnowledge } from "../src/config/company-kb.ts";
import { buildTemplateCompanyContext } from "../src/templates/company-context.ts";

const outDir = path.resolve("outputs/aia_savings_transamerica_iul_bundle");
const savingsPath = path.resolve("outputs/aia_huanyu_refresh_aia_boxie2_pipeline/normalized-savings.json");
const iulPath = path.resolve("outputs/transamerica_genesis3_case2/normalized-iul.json");
const savingsCompany = matchCompanyKnowledge({
  productName: "环宇盈活 储蓄险",
  companyHint: "友邦 AIA",
  forcedCompanyId: "aia",
});
const iulCompany = matchCompanyKnowledge({
  productName: "GIUL III Indexed Universal Life",
  companyHint: "全美人寿 Transamerica",
  forcedCompanyId: "transamerica",
});

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const savingsCompanyPath = path.join(outDir, "savings-company.json");
const iulCompanyPath = path.join(outDir, "iul-company.json");
fs.writeFileSync(savingsCompanyPath, JSON.stringify({ companyId: savingsCompany.companyId, ...buildTemplateCompanyContext(savingsCompany) }, null, 2), "utf8");
fs.writeFileSync(iulCompanyPath, JSON.stringify({ companyId: iulCompany.companyId, ...buildTemplateCompanyContext(iulCompany) }, null, 2), "utf8");

const outputPath = path.join(outDir, "deck.pptx");
const render = spawnSync("python3.11", [
  path.resolve("scripts/render_child_savings_iul_legacy_pptx.py"),
  "--savings",
  savingsPath,
  "--iul",
  iulPath,
  "--savings-company",
  savingsCompanyPath,
  "--iul-company",
  iulCompanyPath,
  "--output",
  outputPath,
], { stdio: "inherit" });

if (render.status !== 0) {
  throw new Error(`render_child_savings_iul_legacy_pptx.py exited ${render.status}`);
}

const savings = JSON.parse(fs.readFileSync(savingsPath, "utf8"));
const iul = JSON.parse(fs.readFileSync(iulPath, "utf8"));

console.log(JSON.stringify({
  status: "ok",
  outputPath,
  savings: {
    product: savings.productName,
    annualPremium: savings.policy.annualPremium,
    totalPremium: savings.policy.contractualTotalPremium,
  },
  iul: {
    product: iul.productName,
    initialPremium: iul.policy.initialPremium,
    annualPremium: iul.policy.annualPremium,
    sumInsured: iul.policy.sumInsured,
  },
}, null, 2));
