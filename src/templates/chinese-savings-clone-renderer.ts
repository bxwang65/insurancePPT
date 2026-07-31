import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import type { ChartArtifact, ImageArtifact } from "../pipeline/types.ts";
import type { PipelineRequest } from "../pipeline/types.ts";
import type { NormalizedSavingsPlan } from "../savings/savings-normalizer.ts";
import { renderTemplateClone } from "./template-clone-renderer.ts";
import { buildTemplateCompanyContext } from "./company-context.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const DEFAULT_PYTHON =
  "/Users/soldier/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const POSTPROCESS_PYTHON = process.env.PPT_POSTPROCESS_PYTHON || "python3.11";

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

export interface ChineseSavingsCloneRequest {
  outDir: string;
  normalizedSavings: NormalizedSavingsPlan;
  images: ImageArtifact;
  charts: ChartArtifact;
  outputPath: string;
  companyContext?: PipelineRequest["companyContext"];
}

export async function renderChineseSavingsClone(req: ChineseSavingsCloneRequest): Promise<string> {
  const workspace = path.join(req.outDir, "template-clone", "chinese-savings");
  const normalizedPath = path.join(workspace, "normalized-savings.json");
  const companyContextPath = path.join(workspace, "company-context.json");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(normalizedPath, JSON.stringify(req.normalizedSavings, null, 2), "utf8");
  fs.writeFileSync(companyContextPath, JSON.stringify(buildTemplateCompanyContext(req.companyContext), null, 2), "utf8");
  await run(process.env.PRESENTATIONS_PYTHON || DEFAULT_PYTHON, [
    path.join(ROOT, "scripts/build_chinese_savings_clone_plan.py"),
    "--normalized", normalizedPath,
    "--assets-dir", req.images.assetsDir,
    "--charts-dir", req.charts.assetsDir,
    "--workspace", workspace,
    "--company-context", companyContextPath,
  ]);
  const rendered = await renderTemplateClone({
    templateId: "chinese",
    workspace,
    frameMapPath: path.join(workspace, "template-frame-map.json"),
    editPlanPath: path.join(workspace, "edit-plan.json"),
    outputPath: req.outputPath,
  });
  await run(POSTPROCESS_PYTHON, [
    path.join(ROOT, "scripts/postprocess_chinese_savings_clone.py"),
    "--pptx", rendered,
    "--slides", "5,6",
  ]);
  return rendered;
}
