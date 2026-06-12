import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { resolveTemplateAssetPath } from "../src/config/template-assets.ts";
import type { TemplatePresetId } from "../src/config/render-presets.ts";

const SKILL_DIR =
  "/Users/soldier/.codex/plugins/cache/openai-primary-runtime/presentations/26.521.10419/skills/presentations";

type InspectRecord = {
  kind?: string;
  slide?: number;
  id?: string;
  textChars?: number;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) continue;
    out[token.slice(2)] = args[i + 1];
    i += 1;
  }
  return out;
}

function must<T>(value: T | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

async function loadArtifactToolUtils() {
  return import(pathToFileURL(path.join(SKILL_DIR, "scripts/artifact_tool_utils.mjs")).href);
}

function groupInspectBySlide(records: InspectRecord[], maxSlide: number) {
  const bySlide = new Map<number, { textboxes: string[]; images: string[] }>();
  for (let s = 1; s <= maxSlide; s += 1) bySlide.set(s, { textboxes: [], images: [] });
  for (const rec of records) {
    if (!rec.slide || rec.slide < 1 || rec.slide > maxSlide) continue;
    const slot = bySlide.get(rec.slide)!;
    if (rec.kind === "textbox" && rec.id) slot.textboxes.push(rec.id);
    if (rec.kind === "image" && rec.id) slot.images.push(rec.id);
  }
  return bySlide;
}

async function main() {
  const args = parseArgs();
  const templateId = must(args.template as TemplatePresetId | undefined, "--template is required");
  const maxSlides = Number(args["max-slides"] || 6);
  if (!Number.isFinite(maxSlides) || maxSlides < 1) throw new Error("--max-slides must be >= 1");
  const pptxPath = resolveTemplateAssetPath(templateId);
  if (!pptxPath || !fs.existsSync(pptxPath)) throw new Error(`Template asset missing: ${templateId}`);

  const outDir = path.resolve("outputs/manual-template-id-audit", templateId);
  fs.mkdirSync(outDir, { recursive: true });

  const utils = await loadArtifactToolUtils();
  await utils.ensureArtifactToolWorkspace(outDir);
  const { FileBlob, PresentationFile } = await utils.importArtifactTool(outDir);

  const presentation = await PresentationFile.importPptx(await FileBlob.load(pptxPath));
  const inspect = await presentation.inspect({
    kind: "slide,textbox,image",
    max_chars: 1200000,
  });
  fs.writeFileSync(path.join(outDir, "template-inspect.ndjson"), inspect.ndjson || "", "utf8");

  const inspectRecords: InspectRecord[] = [];
  for (const line of String(inspect.ndjson || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      inspectRecords.push(JSON.parse(line) as InspectRecord);
    } catch {}
  }
  const sourceBySlide = groupInspectBySlide(inspectRecords, maxSlides);

  const slides = Array.isArray(presentation.slides?.items)
    ? presentation.slides.items
    : Array.from({ length: presentation.slides.count }, (_, i) => presentation.slides.getItem(i));
  const items = (c: any) => (Array.isArray(c?.items) ? c.items : Array.from({ length: c.count }, (_, i) => c.getItem(i)));

  const editableSlides = [];
  for (let i = 0; i < Math.min(maxSlides, slides.length); i += 1) {
    const slide = slides[i];
    const shapes = items(slide.shapes).map((shape: any) => ({
      id: String(shape.id),
      textPreview: String(shape.text || "").trim().slice(0, 80),
    }));
    const images = items(slide.images).map((image: any) => String(image.id));
    editableSlides.push({ slide: i + 1, shapes, images });
  }

  const report = {
    templateId,
    templatePath: pptxPath,
    generatedAt: new Date().toISOString(),
    inspectTruncated: Boolean((inspect as any).truncated),
    maxSlides,
    sourceIdSpace: Array.from(sourceBySlide.entries()).map(([slide, ids]) => ({
      slide,
      textboxIds: ids.textboxes,
      imageIds: ids.images,
    })),
    editableIdSpace: editableSlides,
  };

  fs.writeFileSync(path.join(outDir, "id-space-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({
    status: "ok",
    templateId,
    inspectTruncated: report.inspectTruncated,
    reportPath: path.join(outDir, "id-space-report.json"),
  }, null, 2));
}

await main();

