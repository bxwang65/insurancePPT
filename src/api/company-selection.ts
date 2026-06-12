import { resolveCompanySkin } from "../config/render-presets.ts";
import type { CompanySkin } from "../config/render-presets.ts";

export function requireSelectedCompany(companyId?: string): CompanySkin {
  const selected = String(companyId || "").trim();
  if (!selected) {
    throw new Error("请选择公司后再生成正式版。");
  }
  const company = resolveCompanySkin(selected);
  if (!company) {
    throw new Error("公司选择无效，请重新选择。");
  }
  return company;
}
