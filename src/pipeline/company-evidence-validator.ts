import fs from "fs";
import path from "path";
import { loadCompanyKnowledgeIndex } from "../knowledge/company-knowledge-index.ts";
import type { FormalDeckIssue } from "../savings/formal-deck-validator.ts";

export function validateCompanyEvidence(params: {
  companyId?: string;
  evidenceFiles?: string[];
}): FormalDeckIssue[] {
  const issues: FormalDeckIssue[] = [];
  const companyId = params.companyId || "unknown";
  const evidenceFiles = (params.evidenceFiles || []).filter(Boolean);
  if (!companyId || companyId === "unknown") {
    issues.push({ code: "COMPANY_ID_MISSING", level: "error", message: "缺少公司识别结果，无法正式导出" });
    return issues;
  }
  if (!evidenceFiles.length) {
    issues.push({ code: "COMPANY_EVIDENCE_MISSING", level: "error", message: "公司公开证据为空，无法正式导出" });
    return issues;
  }
  const index = loadCompanyKnowledgeIndex();
  if (!index) {
    issues.push({ code: "COMPANY_INDEX_MISSING", level: "error", message: "公司资料索引缺失，无法校验证据来源" });
    return issues;
  }
  const allowed = new Set(
    index.documents
      .filter((doc) => doc.companyId === companyId && (doc.audience || "unknown") === "public")
      .map((doc) => path.resolve(index.knowledgeRoot, doc.relativePath)),
  );
  for (const file of evidenceFiles) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      issues.push({ code: "COMPANY_EVIDENCE_FILE_MISSING", level: "error", message: `公司证据文件不存在: ${file}` });
      continue;
    }
    if (!allowed.has(resolved)) {
      issues.push({
        code: "COMPANY_EVIDENCE_NOT_PUBLIC_INDEXED",
        level: "error",
        message: `公司证据不在公开索引清单中: ${path.basename(file)}`,
      });
    }
  }
  return issues;
}

