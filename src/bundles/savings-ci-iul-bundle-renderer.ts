import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import type { ChartArtifact, DeckArtifact, ImageArtifact, OutlineArtifact, PipelineRequest, TenantBrandConfig } from "../pipeline/types.ts";
import { loadCompanyCatalog } from "../config/catalog-loader.ts";
import { renderTemplateClone } from "../templates/template-clone-renderer.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const DEFAULT_PYTHON =
  "/Users/soldier/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

export async function renderSavingsCiIulBundle(params: {
  req: PipelineRequest;
  outDir: string;
  outline: OutlineArtifact;
  images: ImageArtifact;
  charts: ChartArtifact;
  tenant: TenantBrandConfig;
}): Promise<DeckArtifact> {
  const { req, outDir, outline } = params;
  if (!req.normalizedSavings || !req.normalizedCi || !req.normalizedIul) {
    throw new Error("savings-ci-iul bundle renderer requires normalizedSavings, normalizedCi and normalizedIul");
  }

  const workspace = path.join(outDir, "template-clone", "savings-ci-iul-bundle");
  const savingsPath = path.join(workspace, "normalized-savings.json");
  const ciPath = path.join(workspace, "normalized-ci.json");
  const iulPath = path.join(workspace, "normalized-iul.json");
  const companyContextPath = path.join(workspace, "company-context.json");
  const outputPath = path.join(outDir, "deck.pptx");

  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(savingsPath, JSON.stringify(req.normalizedSavings, null, 2), "utf8");
  fs.writeFileSync(ciPath, JSON.stringify(req.normalizedCi, null, 2), "utf8");
  fs.writeFileSync(iulPath, JSON.stringify(req.normalizedIul, null, 2), "utf8");

  const companyConfig = loadCompanyCatalog().find((company) => company.id === req.companyContext?.companyId);
  fs.writeFileSync(companyContextPath, JSON.stringify({
    companyName: req.companyContext?.companyName || companyConfig?.displayName || "保险公司",
    companyIntro: companyConfig?.companyIntro || "公司资料来自内部知识库，并保留可追溯来源。",
    companyHighlights: companyConfig?.companyHighlights || [],
    evidenceTitles: (req.companyContext?.evidenceFiles || []).map((file) => path.basename(file)),
  }, null, 2), "utf8");

  await run(process.env.PRESENTATIONS_PYTHON || DEFAULT_PYTHON, [
    path.join(ROOT, "scripts/build_business_savings_ci_iul_clone_plan.py"),
    "--savings", savingsPath,
    "--ci", ciPath,
    "--iul", iulPath,
    "--workspace", workspace,
    "--company-context", companyContextPath,
  ]);

  await renderTemplateClone({
    templateId: "business",
    workspace,
    frameMapPath: path.join(workspace, "template-frame-map.json"),
    editPlanPath: path.join(workspace, "edit-plan.json"),
    outputPath,
  });

  return {
    marpPath: outline.markdownPath,
    pptxPath: outputPath,
    pptxRenderMode: "artifact-tool-exact-clone-edit",
  };
}
