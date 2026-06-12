#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_SKILL_DIR =
  "/Users/soldier/.codex/plugins/cache/openai-primary-runtime/presentations/26.521.10419/skills/presentations";

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    out[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return out;
}

function requireArg(args, name) {
  if (!args[name]) throw new Error(`Missing --${name}`);
  return path.resolve(args[name]);
}

function items(collection) {
  if (Array.isArray(collection?.items)) return collection.items;
  if (Number.isInteger(collection?.count) && typeof collection?.getItem === "function") {
    return Array.from({ length: collection.count }, (_, index) => collection.getItem(index));
  }
  return [];
}

function findRequired(collection, id, kind, slideNumber) {
  const found = items(collection).find((item) => String(item.id) === String(id));
  if (!found) throw new Error(`Slide ${slideNumber}: ${kind} ${id} not found in inherited template elements`);
  return found;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const starterPptxPath = requireArg(args, "starter");
  const editPlanPath = requireArg(args, "edit-plan");
  const out = requireArg(args, "out");
  const workspace = path.resolve(args.workspace || path.dirname(editPlanPath));
  const previewDir = path.resolve(args["preview-dir"] || path.join(workspace, "final-preview"));
  const layoutDir = path.resolve(args["layout-dir"] || path.join(workspace, "final-layout"));
  const skillDir = process.env.PRESENTATIONS_SKILL_DIR || DEFAULT_SKILL_DIR;
  const utils = await import(pathToFileURL(path.join(skillDir, "scripts/artifact_tool_utils.mjs")).href);
  await utils.ensureArtifactToolWorkspace(workspace);
  const { FileBlob, PresentationFile } = await utils.importArtifactTool(workspace);
  const editPlan = JSON.parse(await fs.readFile(editPlanPath, "utf8"));
  const presentation = await PresentationFile.importPptx(await FileBlob.load(starterPptxPath));
  const slides = items(presentation.slides);
  if (!Array.isArray(editPlan.slides) || editPlan.slides.length !== slides.length) {
    throw new Error(`Edit plan must contain exactly ${slides.length} slides`);
  }

  for (const slideEdit of editPlan.slides) {
    const slideNumber = Number(slideEdit.outputSlide);
    const slide = slides[slideNumber - 1];
    if (!slide) throw new Error(`Output slide ${slideNumber} not found`);
    for (const rewrite of slideEdit.textRewrites || []) {
      const shape = findRequired(slide.shapes, rewrite.shapeId, "shape", slideNumber);
      shape.text = String(rewrite.text ?? "");
    }
    for (const replacement of slideEdit.imageReplacements || []) {
      const image = findRequired(slide.images, replacement.imageId, "image", slideNumber);
      const imagePath = path.resolve(replacement.path);
      await image.replace({
        blob: await utils.readImageBlob(imagePath),
        fit: replacement.fit || "cover",
        alt: replacement.alt || path.basename(imagePath),
      });
    }
    for (const deletion of slideEdit.deletions || []) {
      const collection = deletion.kind === "image" ? slide.images : slide.shapes;
      findRequired(collection, deletion.id, deletion.kind || "shape", slideNumber).delete();
    }
  }

  await fs.mkdir(previewDir, { recursive: true });
  await fs.mkdir(layoutDir, { recursive: true });
  const previews = [];
  for (let index = 0; index < slides.length; index += 1) {
    const padded = String(index + 1).padStart(2, "0");
    const previewPath = path.join(previewDir, `final-slide-${padded}.png`);
    const layoutPath = path.join(layoutDir, `final-slide-${padded}.layout.json`);
    await utils.saveBlobToFile(await presentation.export({ slide: slides[index], format: "png", scale: 1 }), previewPath);
    await utils.saveBlobToFile(await presentation.export({ slide: slides[index], format: "layout" }), layoutPath);
    previews.push(previewPath);
  }
  await fs.mkdir(path.dirname(out), { recursive: true });
  await (await PresentationFile.exportPptx(presentation)).save(out);
  const manifest = {
    renderMode: "artifact-tool-exact-clone-edit",
    starter: starterPptxPath,
    editPlanPath,
    out,
    slideCount: slides.length,
    previews,
    generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(`${out}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
