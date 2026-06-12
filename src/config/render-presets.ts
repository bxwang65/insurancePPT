import { loadCompanyCatalog } from "./catalog-loader.ts";

export type TemplatePresetId = "broker" | "business" | "minimal" | "chinese" | "ink";

export interface CompanySkin {
  id: string;
  name: string;
  tenantId: string;
}

export const COMPANY_SKINS: CompanySkin[] = loadCompanyCatalog()
  .map((company) => ({ id: company.id, name: company.displayName, tenantId: company.tenantId || "default" }))
  .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

export const TEMPLATE_PRESETS: Array<{ id: TemplatePresetId; name: string }> = [
  { id: "broker", name: "券商风" },
  { id: "business", name: "商务风" },
  { id: "minimal", name: "简洁风" },
  { id: "chinese", name: "中国风" },
  { id: "ink", name: "水墨风" },
];

export function resolveTemplatePreset(input?: string): TemplatePresetId {
  const s = String(input || "").toLowerCase();
  if (s.includes("broker") || s.includes("券商") || s.includes("modern")) return "broker";
  if (s.includes("business") || s.includes("商务")) return "business";
  if (s.includes("minimal") || s.includes("简洁")) return "minimal";
  if (s.includes("chinese") || s.includes("中国")) return "chinese";
  if (s.includes("ink") || s.includes("水墨")) return "ink";
  return "broker";
}

export function resolveCompanySkin(companyId?: string): CompanySkin | undefined {
  if (!companyId) return undefined;
  return COMPANY_SKINS.find((x) => x.id === companyId);
}
