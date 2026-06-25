import path from "path";
import { loadCompanyCatalog } from "../config/catalog-loader.ts";
import { getCompanyFacts } from "../knowledge/company-facts.ts";
import type { PipelineRequest } from "../pipeline/types.ts";

export function buildTemplateCompanyContext(reqCompanyContext?: PipelineRequest["companyContext"]) {
  const companyConfig = loadCompanyCatalog().find((company) => company.id === reqCompanyContext?.companyId);
  const factEntry = getCompanyFacts(reqCompanyContext?.companyId);
  return {
    companyName: reqCompanyContext?.companyName || companyConfig?.displayName || "保险公司",
    companyIntro: factEntry?.companyIntro || companyConfig?.companyIntro || "公司资料来自内部知识库。",
    companyHighlights: companyConfig?.companyHighlights || [],
    companyFacts: factEntry?.facts || [],
    evidenceTitles: (reqCompanyContext?.evidenceFiles || []).map((file) => path.basename(file)),
  };
}
