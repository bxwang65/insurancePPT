import fs from "fs";
import path from "path";
import { loadCompanyCatalog, loadProductCatalog } from "./catalog-loader.ts";
import { rankCompanyEvidence } from "../knowledge/company-knowledge-index.ts";

export interface CompanyProfile {
  id: string;
  displayName: string;
  aliases: string[];
  tags: string[];
}

export interface CompanyKnowledgeMatch {
  companyId: string;
  companyName: string;
  evidenceFiles: string[];
  confidence: number;
  matchedBy: "product_catalog" | "company_alias" | "company_forced" | "unknown";
}

const KNOWLEDGE_ROOT = "/Users/soldier/Desktop/公司介绍";

const CONFIG_COMPANIES = loadCompanyCatalog();
const COMPANY_PROFILES: CompanyProfile[] = [
  ...CONFIG_COMPANIES.map((company) => ({ id: company.id, displayName: company.displayName, aliases: company.aliases, tags: company.aliases })),
];

const PRODUCT_COMPANY_CATALOG = loadProductCatalog();

function normalizeLoose(input: string): string {
  return input
    .toLowerCase()
    .replace(/[「」『』（）()【】\[\]\-_\s·•・.,，:：/\\|]+/g, "")
    .replace(/x/gi, "")
    .trim();
}

function scoreProfile(input: string, p: CompanyProfile): number {
  const hay = normalizeLoose(input);
  let score = 0;
  for (const a of p.aliases) if (hay.includes(normalizeLoose(a))) score += 4;
  for (const t of p.tags) if (hay.includes(normalizeLoose(t))) score += 2;
  return score;
}

export function expectedCompanyIdForProduct(productName?: string): string | undefined {
  const normalized = normalizeLoose(productName || "");
  if (!normalized) return undefined;
  const matched = PRODUCT_COMPANY_CATALOG.find((entry) =>
    entry.aliases.some((alias) => normalized.includes(normalizeLoose(alias)))
  );
  return matched?.companyId;
}

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    const list = fs.readdirSync(cur, { withFileTypes: true });
    for (const ent of list) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (/\.(pdf|pptx|jpg|jpeg|png)$/i.test(ent.name)) out.push(full);
    }
  }
  return out;
}

export function matchCompanyKnowledge(params: {
  productName?: string;
  companyHint?: string;
  forcedCompanyId?: string;
}): CompanyKnowledgeMatch {
  const seed = `${params.productName || ""} ${params.companyHint || ""}`.trim();
  const expectedCompanyId = expectedCompanyIdForProduct(params.productName);
  const catalog = expectedCompanyId
    ? PRODUCT_COMPANY_CATALOG.find((entry) => entry.companyId === expectedCompanyId)
    : undefined;
  const best = COMPANY_PROFILES
    .map((p) => ({ p, score: scoreProfile(seed, p) }))
    .sort((a, b) => b.score - a.score)[0];
  const forced = params.forcedCompanyId
    ? COMPANY_PROFILES.find((profile) => profile.id === params.forcedCompanyId)
    : undefined;
  const picked = forced || (catalog
    ? COMPANY_PROFILES.find((profile) => profile.id === catalog.companyId)
    : best && best.score > 0 ? best.p : undefined);

  const companyConfig = CONFIG_COMPANIES.find((company) => company.id === picked?.id);
  const indexedEvidence = picked
    ? rankCompanyEvidence({
        companyId: picked.id,
        rankingTerms: companyConfig?.evidenceRanking,
        preferredDirectories: companyConfig?.knowledgeDirectories,
        allowedAudiences: ["public"],
        primaryDirectoryOnly: true,
        limit: 8,
      })
    : [];
  const companyDirCandidates = indexedEvidence.length === 0 && fs.existsSync(KNOWLEDGE_ROOT)
    ? fs.readdirSync(KNOWLEDGE_ROOT).filter((d) => {
        const n = d.toLowerCase();
        return companyConfig?.knowledgeDirectories.includes(d) || picked?.aliases.some((a) => n.includes(a.toLowerCase()));
      }).sort((a, b) => {
        const preferred = (name: string) => name.toLowerCase().startsWith(`${picked?.id}-`) ? 1 : 0;
        return preferred(b) - preferred(a);
      })
    : [];
  const evidence: string[] = [];
  for (const dir of companyDirCandidates) {
    const files = walkFiles(path.join(KNOWLEDGE_ROOT, dir));
    evidence.push(...files.sort((a, b) => {
      const rank = (file: string) => /简介|一图|fact|年报|财务|实力|概览/i.test(path.basename(file)) ? 1 : 0;
      return rank(b) - rank(a);
    }).slice(0, 8));
  }

  return {
    companyId: picked?.id || "unknown",
    companyName: picked?.displayName || "待确认公司",
    evidenceFiles: indexedEvidence.length ? indexedEvidence : evidence.slice(0, 12),
    confidence: forced ? 1 : catalog ? 1 : best?.score ? Math.min(0.95, 0.45 + best.score / 20) : 0,
    matchedBy: forced ? "company_forced" : catalog ? "product_catalog" : picked ? "company_alias" : "unknown",
  };
}
