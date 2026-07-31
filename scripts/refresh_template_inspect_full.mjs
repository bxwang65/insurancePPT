#!/usr/bin/env node

import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_SKILL_DIR =
  "/Users/soldier/.codex/plugins/cache/openai-primary-runtime/presentations/26.521.10419/skills/presentations";
const PRESENTATIONS_CACHE_ROOT = "/Users/soldier/.codex/plugins/cache/openai-primary-runtime/presentations";

function resolvePresentationsSkillDir() {
  const override = process.env.PRESENTATIONS_SKILL_DIR;
  if (override && fssync.existsSync(path.join(override, "scripts/artifact_tool_utils.mjs"))) return override;
  if (fssync.existsSync(path.join(DEFAULT_SKILL_DIR, "scripts/artifact_tool_utils.mjs"))) return DEFAULT_SKILL_DIR;
  if (fssync.existsSync(PRESENTATIONS_CACHE_ROOT)) {
    const versions = fssync.readdirSync(PRESENTATIONS_CACHE_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
      const candidate = path.join(PRESENTATIONS_CACHE_ROOT, version, "skills/presentations");
      if (fssync.existsSync(path.join(candidate, "scripts/artifact_tool_utils.mjs"))) return candidate;
    }
  }
  throw new Error("Presentations artifact_tool_utils.mjs not found");
}

const skillDir = resolvePresentationsSkillDir();
const utilsPath = path.join(skillDir, "scripts/artifact_tool_utils.mjs");
const {
  ensureArtifactToolWorkspace,
  importArtifactTool,
  parseArgs,
  requireArg,
} = await import(pathToFileURL(utilsPath).href);

function usage() {
  return [
    "Usage:",
    "  node scripts/refresh_template_inspect_full.mjs --workspace <dir> --pptx <source.pptx> [--out-dir <dir>] [--max-chars <n>]",
  ].join("\n");
}

function isWithin(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function slidesFromPresentation(presentation) {
  if (Array.isArray(presentation.slides?.items)) return presentation.slides.items;
  if (Number.isInteger(presentation.slides?.count) && typeof presentation.slides.getItem === "function") {
    return Array.from({ length: presentation.slides.count }, (_, index) => presentation.slides.getItem(index));
  }
  throw new Error("Could not enumerate imported presentation slides.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const workspaceDir = path.resolve(requireArg(args, "workspace"));
  const pptxPath = path.resolve(requireArg(args, "pptx"));
  const outDir = args["out-dir"]
    ? path.resolve(workspaceDir, args["out-dir"])
    : path.join(workspaceDir, "template-inspect");
  const maxChars = args["max-chars"] ? Number(args["max-chars"]) : 1200000;
  if (!Number.isFinite(maxChars) || maxChars < 200000) {
    throw new Error("--max-chars must be >= 200000");
  }
  if (!isWithin(outDir, workspaceDir)) {
    throw new Error(`Refusing to write outside workspace: ${outDir}`);
  }

  await ensureArtifactToolWorkspace(workspaceDir);
  const { FileBlob, PresentationFile } = await importArtifactTool(workspaceDir);
  const inspectPath = path.join(outDir, "template-inspect.ndjson");
  const manifestPath = path.join(outDir, "template-manifest.json");
  const presentation = await PresentationFile.importPptx(await FileBlob.load(pptxPath));
  const slides = slidesFromPresentation(presentation);

  const inspect = await presentation.inspect({
    kind: "slide,textbox,shape,image,table,chart",
    max_chars: Math.floor(maxChars),
  });
  await fs.writeFile(inspectPath, inspect.ndjson || "", "utf8");

  let manifest = {};
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {}
  await writeJson(manifestPath, {
    ...manifest,
    sourcePptx: pptxPath,
    workspace: workspaceDir,
    outDir,
    slideCount: slides.length,
    inspectPath,
    inspectRelativePath: path.relative(workspaceDir, inspectPath).split(path.sep).join("/"),
    inspectTruncated: Boolean(inspect.truncated),
    inspectMetadata: inspect.metadata || {},
    inspectRefreshedAt: new Date().toISOString(),
    inspectMaxChars: Math.floor(maxChars),
  });
  if (inspect.truncated) {
    console.warn(`inspect still truncated at max_chars=${Math.floor(maxChars)}; keep best-effort NDJSON`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  console.error(usage());
  process.exit(1);
});
