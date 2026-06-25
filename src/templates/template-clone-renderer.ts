import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { resolveTemplateAsset, resolveTemplateAssetPath } from "../config/template-assets.ts";
import type { TemplatePresetId } from "../config/render-presets.ts";
import { assertFormalOutputClean } from "../pipeline/formal-output-guard.ts";

const DEFAULT_SKILL_DIR =
  "/Users/soldier/.codex/plugins/cache/openai-primary-runtime/presentations/26.521.10419/skills/presentations";
const DEFAULT_NODE =
  "/Users/soldier/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node";
const DEFAULT_PYTHON =
  "/Users/soldier/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const ROOT = path.resolve(import.meta.dir, "../..");
const PRESENTATIONS_CACHE_ROOT = "/Users/soldier/.codex/plugins/cache/openai-primary-runtime/presentations";

function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function run(command: string, args: string[], env?: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

function readJson(filePath: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function resolvePresentationsSkillDir(): string {
  const override = process.env.PRESENTATIONS_SKILL_DIR;
  if (override && fs.existsSync(path.join(override, "scripts/inspect_template_deck.mjs"))) return override;
  if (fs.existsSync(path.join(DEFAULT_SKILL_DIR, "scripts/inspect_template_deck.mjs"))) return DEFAULT_SKILL_DIR;
  if (fs.existsSync(PRESENTATIONS_CACHE_ROOT)) {
    const versions = fs.readdirSync(PRESENTATIONS_CACHE_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
      const candidate = path.join(PRESENTATIONS_CACHE_ROOT, version, "skills/presentations");
      if (fs.existsSync(path.join(candidate, "scripts/inspect_template_deck.mjs"))) return candidate;
    }
  }
  throw new Error("Presentations skill scripts not found. Set PRESENTATIONS_SKILL_DIR to a valid skills/presentations path.");
}

export interface TemplateCloneRenderRequest {
  templateId: TemplatePresetId;
  workspace: string;
  frameMapPath: string;
  editPlanPath: string;
  outputPath: string;
}

export async function renderTemplateClone(req: TemplateCloneRenderRequest): Promise<string> {
  const asset = resolveTemplateAsset(req.templateId);
  const sourcePptx = resolveTemplateAssetPath(req.templateId);
  if (!asset || !sourcePptx || !fs.existsSync(sourcePptx)) {
    throw new Error(`Source template asset unavailable: ${req.templateId}`);
  }
  if (sha256(sourcePptx) !== asset.sha256) {
    throw new Error(`Source template changed after indexing: ${req.templateId}`);
  }
  const skillDir = resolvePresentationsSkillDir();
  const node = process.env.PRESENTATIONS_NODE || DEFAULT_NODE;
  const python = process.env.PRESENTATIONS_PYTHON || DEFAULT_PYTHON;
  const inspectDir = path.join(req.workspace, "template-inspect");
  const starter = path.join(req.workspace, "template-starter.pptx");
  const evidenceDir = path.join(req.workspace, "authoring-evidence");
  const worker = path.join(ROOT, "scripts/render_template_clone.mjs");
  fs.mkdirSync(req.workspace, { recursive: true });
  if (!fs.existsSync(path.join(inspectDir, "template-inspect.ndjson"))) {
    await run(node, [
      path.join(skillDir, "scripts/inspect_template_deck.mjs"),
      "--workspace", req.workspace,
      "--pptx", sourcePptx,
    ]);
  }
  const inspectManifestPath = path.join(inspectDir, "template-manifest.json");
  const inspectManifest = readJson(inspectManifestPath);
  if (inspectManifest?.inspectTruncated) {
    await run(node, [
      path.join(ROOT, "scripts/refresh_template_inspect_full.mjs"),
      "--workspace", req.workspace,
      "--pptx", sourcePptx,
      "--max-chars", String(process.env.TEMPLATE_INSPECT_MAX_CHARS || 1200000),
    ]);
  }
  await run(python, [
    path.join(ROOT, "scripts/augment_template_inspect_from_layouts.py"),
    "--layouts", path.join(inspectDir, "layouts"),
    "--inspect", path.join(inspectDir, "template-inspect.ndjson"),
  ]);
  await run(node, [
    path.join(skillDir, "scripts/prepare_template_starter_deck.mjs"),
    "--workspace", req.workspace,
    "--pptx", sourcePptx,
    "--map", req.frameMapPath,
    "--out", starter,
  ]);
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.copyFileSync(worker, path.join(evidenceDir, "render_template_clone.mjs"));
  await run(node, [
    worker,
    "--workspace", req.workspace,
    "--starter", starter,
    "--edit-plan", req.editPlanPath,
    "--out", req.outputPath,
  ], { PRESENTATIONS_SKILL_DIR: skillDir });
  await run(node, [
    path.join(skillDir, "scripts/check_template_fidelity.mjs"),
    "--workspace", req.workspace,
    "--starter-pptx", starter,
    "--final-pptx", req.outputPath,
    "--map", req.frameMapPath,
    "--starter-layout-dir", path.join(req.workspace, "template-starter-layout"),
    "--final-layout-dir", path.join(req.workspace, "final-layout"),
    "--edit-dir", evidenceDir,
  ]);
  assertFormalOutputClean([
    req.editPlanPath,
    path.join(req.workspace, "template-frame-map.json"),
    path.join(req.workspace, "final-layout"),
  ]);
  return req.outputPath;
}
