import fs from "fs";
import path from "path";

const FACTS_PATH = path.resolve(import.meta.dir, "../../data/company-facts.generated.json");
const MANUAL_FACTS_PATH = path.resolve(import.meta.dir, "../../data/company-facts.manual.json");

export interface CompanyFact {
  label: string;
  value: string;
}

export interface CompanyFactEntry {
  companyId: string;
  displayName: string;
  companyIntro: string;
  facts: CompanyFact[];
  evidenceFiles: string[];
}

interface CompanyFactbook {
  companies: CompanyFactEntry[];
}

let cached: CompanyFactbook | null = null;

function readFactbook(filePath: string): CompanyFactbook {
  if (!fs.existsSync(filePath)) return { companies: [] };
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as CompanyFactbook;
}

function loadFactbook(): CompanyFactbook {
  if (cached) return cached;
  const generated = readFactbook(FACTS_PATH);
  const manual = readFactbook(MANUAL_FACTS_PATH);
  const merged = new Map<string, CompanyFactEntry>();
  for (const entry of generated.companies) merged.set(entry.companyId, entry);
  for (const entry of manual.companies) {
    const previous = merged.get(entry.companyId);
    merged.set(entry.companyId, {
      ...(previous || {}),
      ...entry,
      facts: entry.facts?.length ? entry.facts : previous?.facts || [],
      evidenceFiles: previous?.evidenceFiles || entry.evidenceFiles || [],
    });
  }
  cached = { companies: [...merged.values()] };
  return cached;
}

export function getCompanyFacts(companyId?: string): CompanyFactEntry | undefined {
  if (!companyId) return undefined;
  return loadFactbook().companies.find((entry) => entry.companyId === companyId);
}
