import fs from "fs";
import path from "path";
import type { TemplatePresetId } from "./render-presets.ts";

const ROOT = path.resolve(import.meta.dir, "../../");
const DEFAULT_INDEX_PATH = path.join(ROOT, "data/template-asset-index.json");

export interface TemplateAsset {
  id: TemplatePresetId;
  sourceRoot: string;
  relativePath: string;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  modifiedAt: string;
  slideCount: number;
  mediaCount: number;
  status: "indexed";
  mutationMode: "artifact-tool-exact-clone-edit";
}

interface TemplateAssetIndex {
  version: number;
  generatedAt: string;
  assets: TemplateAsset[];
}

let cachedIndex: TemplateAssetIndex | undefined;

export function loadTemplateAssetIndex(): TemplateAssetIndex | undefined {
  if (cachedIndex) return cachedIndex;
  const indexPath = process.env.TEMPLATE_ASSET_INDEX || DEFAULT_INDEX_PATH;
  if (!fs.existsSync(indexPath)) return undefined;
  cachedIndex = JSON.parse(fs.readFileSync(indexPath, "utf8")) as TemplateAssetIndex;
  return cachedIndex;
}

export function listTemplateAssets(): TemplateAsset[] {
  return loadTemplateAssetIndex()?.assets || [];
}

export function resolveTemplateAsset(templateId: TemplatePresetId): TemplateAsset | undefined {
  return listTemplateAssets().find((asset) => asset.id === templateId);
}

export function resolveTemplateAssetPath(templateId: TemplatePresetId): string | undefined {
  const asset = resolveTemplateAsset(templateId);
  if (!asset) return undefined;
  return path.join(process.env.TEMPLATE_ASSET_ROOT || asset.sourceRoot, asset.relativePath);
}
