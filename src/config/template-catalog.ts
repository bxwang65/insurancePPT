import fs from "fs";
import path from "path";
import type { TemplatePresetId } from "./render-presets.ts";

const ROOT = path.resolve(import.meta.dir, "../../config/templates");

export interface TemplateConfig {
  id: string;
  planType: "savings" | "ci" | "iul";
  stylePreset: TemplatePresetId;
  sourceTemplateAssetId?: TemplatePresetId;
  cloneReady?: boolean;
  cloneRenderer?: string | null;
  requiredPageTypes?: Array<"cover" | "company" | "timeline" | "compare" | "chart" | "table" | "conclusion" | "narrative">;
}

function readJsonFiles<T>(dir: string): T[] {
  if (!fs.existsSync(dir)) return [];
  const out: T[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readJsonFiles<T>(full));
    else if (entry.name.endsWith(".json")) out.push(JSON.parse(fs.readFileSync(full, "utf8")) as T);
  }
  return out;
}

let cache: TemplateConfig[] | undefined;
export function loadTemplateCatalog(): TemplateConfig[] {
  if (!cache) cache = readJsonFiles<TemplateConfig>(ROOT);
  return cache;
}

export function findTemplateConfig(params: {
  planType: "savings" | "ci" | "iul";
  stylePreset?: TemplatePresetId;
}): TemplateConfig | undefined {
  return loadTemplateCatalog().find((template) =>
    template.planType === params.planType &&
    (!params.stylePreset || template.stylePreset === params.stylePreset),
  );
}
