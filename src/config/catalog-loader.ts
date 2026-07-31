import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "../../config");

export interface CompanyCatalogEntry {
  id: string;
  displayName: string;
  aliases: string[];
  tenantId: string;
  knowledgeDirectories: string[];
  evidenceRanking: string[];
  companyIntro: string;
  companyHighlights?: Array<{ text: string; sourceFile: string }>;
}

export interface ProductCatalogEntry {
  id: string;
  companyId: string;
  planType: "savings" | "ci" | "iul";
  displayName: string;
  aliases: string[];
  requiredModules: string[];
}

export interface BundleCatalogEntry {
  id: string;
  displayName: string;
  products: Array<"savings" | "ci" | "iul">;
  templateFamily: string;
  status?: string;
  modules: string[];
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

export function loadCompanyCatalog(): CompanyCatalogEntry[] {
  return readJsonFiles<CompanyCatalogEntry>(path.join(ROOT, "companies"));
}

export function loadProductCatalog(): ProductCatalogEntry[] {
  return readJsonFiles<ProductCatalogEntry>(path.join(ROOT, "products"));
}

export function loadBundleCatalog(): BundleCatalogEntry[] {
  return readJsonFiles<BundleCatalogEntry>(path.join(ROOT, "bundles"));
}
