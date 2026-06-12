import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import type { ChartArtifact, DeckArtifact, ImageArtifact, OutlineArtifact, PipelineRequest, TenantBrandConfig } from "../pipeline/types.ts";
import { buildTemplateCompanyContext } from "../templates/company-context.ts";
import { matchCompanyKnowledge } from "../config/company-kb.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const DEFAULT_PYTHON = process.env.PPT_POSTPROCESS_PYTHON || "python3.11";

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

export async function renderSavingsIulBundle(params: {
  req: PipelineRequest;
  outDir: string;
  outline: OutlineArtifact;
  images: ImageArtifact;
  charts: ChartArtifact;
  tenant: TenantBrandConfig;
}): Promise<DeckArtifact> {
  const { req, outDir, outline } = params;
  if (!req.normalizedSavings || !req.normalizedIul) {
    throw new Error("savings-iul bundle renderer requires normalizedSavings and normalizedIul");
  }

  const workspace = path.join(outDir, "child-savings-iul-legacy");
  const savingsPath = path.join(workspace, "normalized-savings.json");
  const iulPath = path.join(workspace, "normalized-iul.json");
  const savingsCompanyPath = path.join(workspace, "savings-company.json");
  const iulCompanyPath = path.join(workspace, "iul-company.json");
  const outputPath = path.join(outDir, "deck.pptx");

  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(savingsPath, JSON.stringify(req.normalizedSavings, null, 2), "utf8");
  fs.writeFileSync(iulPath, JSON.stringify(req.normalizedIul, null, 2), "utf8");
  const savingsCompanyMatch = matchCompanyKnowledge({
    productName: req.normalizedSavings.productName,
    forcedCompanyId: req.companyContext?.companyId,
  });
  const iulCompanyMatch = matchCompanyKnowledge({
    productName: req.normalizedIul.productName,
    companyHint: req.normalizedIul.productName,
  });
  fs.writeFileSync(savingsCompanyPath, JSON.stringify({ companyId: savingsCompanyMatch.companyId, ...buildTemplateCompanyContext(savingsCompanyMatch) }, null, 2), "utf8");
  fs.writeFileSync(iulCompanyPath, JSON.stringify({ companyId: iulCompanyMatch.companyId, ...buildTemplateCompanyContext(iulCompanyMatch) }, null, 2), "utf8");

  await run(process.env.PRESENTATIONS_PYTHON || DEFAULT_PYTHON, [
    path.join(ROOT, "scripts/render_child_savings_iul_legacy_pptx.py"),
    "--savings", savingsPath,
    "--iul", iulPath,
    "--savings-company", savingsCompanyPath,
    "--iul-company", iulCompanyPath,
    "--output", outputPath,
  ]);

  return {
    marpPath: outline.markdownPath,
    pptxPath: outputPath,
    pptxRenderMode: "artifact-tool-exact-clone-edit",
  };
}
