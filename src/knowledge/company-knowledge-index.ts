import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "../../");
const DEFAULT_INDEX_PATH = path.join(ROOT, "data/company-knowledge-index.json");

export interface CompanyKnowledgeDocument {
  id: string;
  companyId: string;
  sourceDirectory: string;
  relativePath: string;
  fileName: string;
  extension: string;
  documentType: string;
  audience?: "public" | "internal" | "unknown";
  sizeBytes: number;
  modifiedAt: string;
  pageCount?: number | null;
  textExcerpt: string;
}

interface CompanyKnowledgeIndex {
  version: number;
  generatedAt: string;
  knowledgeRoot: string;
  documents: CompanyKnowledgeDocument[];
}

let cachedIndex: CompanyKnowledgeIndex | undefined;

export function loadCompanyKnowledgeIndex(): CompanyKnowledgeIndex | undefined {
  if (cachedIndex) return cachedIndex;
  const indexPath = process.env.COMPANY_KNOWLEDGE_INDEX || DEFAULT_INDEX_PATH;
  if (!fs.existsSync(indexPath)) return undefined;
  cachedIndex = JSON.parse(fs.readFileSync(indexPath, "utf8")) as CompanyKnowledgeIndex;
  return cachedIndex;
}

export function rankCompanyEvidence(params: {
  companyId: string;
  rankingTerms?: string[];
  preferredDirectories?: string[];
  allowedAudiences?: Array<"public" | "internal" | "unknown">;
  primaryDirectoryOnly?: boolean;
  limit?: number;
}): string[] {
  const index = loadCompanyKnowledgeIndex();
  if (!index) return [];
  const rankingTerms = params.rankingTerms || [];
  const preferredDirectories = params.preferredDirectories || [];
  const allowedAudiences = params.allowedAudiences || ["public"];
  const primaryDirectory = preferredDirectories[0];
  const hasPrimaryDirectory = Boolean(primaryDirectory) && index.documents.some((document) =>
    document.companyId === params.companyId &&
    document.sourceDirectory === primaryDirectory &&
    allowedAudiences.includes(document.audience || "unknown")
  );
  const priority: Record<string, number> = {
    financial_strength: 9,
    annual_report: 8,
    investment: 7,
    participating_performance: 6,
    product_brochure: 4,
    service: 3,
    training: 2,
    illustration: 1,
    policy_contract: 0,
    image: 0,
    other: 0,
  };
  return index.documents
    .filter((document) =>
      document.companyId === params.companyId &&
      allowedAudiences.includes(document.audience || "unknown") &&
      (!params.primaryDirectoryOnly || !hasPrimaryDirectory || document.sourceDirectory === primaryDirectory)
    )
    .map((document) => {
      const haystack = `${document.fileName} ${document.textExcerpt}`.toLowerCase();
      const keywordScore = rankingTerms.reduce(
        (score, term) => score + (haystack.includes(term.toLowerCase()) ? 3 : 0),
        0,
      );
      const directoryIndex = preferredDirectories.indexOf(document.sourceDirectory);
      const directoryScore = directoryIndex === -1 ? 0 : Math.max(0, 18 - directoryIndex * 6);
      return { document, score: (priority[document.documentType] || 0) + keywordScore + directoryScore };
    })
    .sort((a, b) => b.score - a.score || a.document.relativePath.localeCompare(b.document.relativePath))
    .slice(0, params.limit || 12)
    .map(({ document }) => path.join(index.knowledgeRoot, document.relativePath));
}
