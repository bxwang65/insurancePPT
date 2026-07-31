import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import type { ChartArtifact, DeckArtifact, ImageArtifact, OutlineArtifact, PipelineRequest, TenantBrandConfig } from "../pipeline/types.ts";
import { buildTemplateCompanyContext } from "../templates/company-context.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const DEFAULT_PYTHON =
  process.env.PPT_POSTPROCESS_PYTHON || "python3.11";

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

export async function renderSavingsCiBundle(params: {
  req: PipelineRequest;
  outDir: string;
  outline: OutlineArtifact;
  images: ImageArtifact;
  charts: ChartArtifact;
  tenant: TenantBrandConfig;
}): Promise<DeckArtifact> {
  const { req, outDir, outline } = params;
  if (!req.normalizedSavings || !req.normalizedCi) {
    throw new Error("savings-ci bundle renderer requires normalizedSavings and normalizedCi");
  }
  const workspace = path.join(outDir, "family-firewall-education");
  const savingsPath = path.join(workspace, "normalized-savings.json");
  const ciPath = path.join(workspace, "normalized-ci.json");
  const companyContextPath = path.join(workspace, "company-context.json");
  const outputPath = path.join(outDir, "deck.pptx");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(savingsPath, JSON.stringify(req.normalizedSavings, null, 2), "utf8");
  fs.writeFileSync(ciPath, JSON.stringify(req.normalizedCi, null, 2), "utf8");
  fs.writeFileSync(companyContextPath, JSON.stringify(buildTemplateCompanyContext(req.companyContext), null, 2), "utf8");
  await run(process.env.PRESENTATIONS_PYTHON || DEFAULT_PYTHON, [
    path.join(ROOT, "scripts/render_family_firewall_education_pptx.py"),
    "--savings", savingsPath,
    "--ci", ciPath,
    "--company-context", companyContextPath,
    "--output", outputPath,
  ]);
  return {
    marpPath: outline.markdownPath,
    pptxPath: outputPath,
    pptxRenderMode: "artifact-tool-exact-clone-edit",
  };
}
