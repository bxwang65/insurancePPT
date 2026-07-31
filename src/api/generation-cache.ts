import crypto from "crypto";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "../../");
const CACHE_ROOT = path.join(ROOT, ".cache", "insurance-ppt", "generation");

export interface GenerationCacheInputs {
  ownerId: string;
  companyId: string;
  stylePreset: string;
  quality: string;
  outputFormat: string;
  templateId?: string;
  fastPath?: boolean;
  extractionHashes: string[];
  extractionKinds: string[];
  chatHash?: string;
}

export interface GenerationCacheArtifact {
  mode: "fast" | "formal";
  pptPath: string;
  markdownPath?: string;
  pdfPath?: string;
}

export interface GenerationCacheManifest extends GenerationCacheArtifact {
  key: string;
  createdAt: string;
  inputs: GenerationCacheInputs;
}

function stableStringify(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function fingerprintGenerationInputs(inputs: GenerationCacheInputs): string {
  const payload = stableStringify(inputs);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function cacheDirFor(key: string): string {
  return path.join(CACHE_ROOT, key);
}

function manifestPathFor(key: string): string {
  return path.join(cacheDirFor(key), "manifest.json");
}

export function loadGenerationCache(key: string): GenerationCacheManifest | null {
  const manifestPath = manifestPathFor(key);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as GenerationCacheManifest;
    if (!fs.existsSync(manifest.pptPath)) return null;
    if (manifest.markdownPath && !fs.existsSync(manifest.markdownPath)) return null;
    if (manifest.pdfPath && !fs.existsSync(manifest.pdfPath)) return null;
    return manifest;
  } catch {
    return null;
  }
}

export function storeGenerationCache(key: string, artifact: GenerationCacheArtifact, inputs: GenerationCacheInputs): GenerationCacheManifest {
  const dir = cacheDirFor(key);
  ensureDir(dir);

  const cachedPpt = path.join(dir, path.basename(artifact.pptPath));
  fs.copyFileSync(artifact.pptPath, cachedPpt);

  let cachedMarkdown: string | undefined;
  if (artifact.markdownPath && fs.existsSync(artifact.markdownPath)) {
    cachedMarkdown = path.join(dir, path.basename(artifact.markdownPath));
    fs.copyFileSync(artifact.markdownPath, cachedMarkdown);
  }

  let cachedPdf: string | undefined;
  if (artifact.pdfPath && fs.existsSync(artifact.pdfPath)) {
    cachedPdf = path.join(dir, path.basename(artifact.pdfPath));
    fs.copyFileSync(artifact.pdfPath, cachedPdf);
  }

  const manifest: GenerationCacheManifest = {
    key,
    createdAt: new Date().toISOString(),
    mode: artifact.mode,
    pptPath: cachedPpt,
    markdownPath: cachedMarkdown,
    pdfPath: cachedPdf,
    inputs,
  };
  fs.writeFileSync(manifestPathFor(key), JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

export function hydrateGenerationCache(key: string, targets: {
  pptPath: string;
  markdownPath?: string;
  pdfPath?: string;
}): GenerationCacheArtifact | null {
  const cached = loadGenerationCache(key);
  if (!cached) return null;
  fs.copyFileSync(cached.pptPath, targets.pptPath);
  if (cached.markdownPath && targets.markdownPath) {
    fs.copyFileSync(cached.markdownPath, targets.markdownPath);
  }
  if (cached.pdfPath && targets.pdfPath) {
    fs.copyFileSync(cached.pdfPath, targets.pdfPath);
  }
  return {
    mode: cached.mode,
    pptPath: targets.pptPath,
    markdownPath: targets.markdownPath,
    pdfPath: targets.pdfPath,
  };
}
