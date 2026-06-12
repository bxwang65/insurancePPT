import type { FormalDeckIssue } from "../savings/formal-deck-validator.ts";
import type { NormalizedIulPlan } from "./iul-normalizer.ts";

function continuous(rows: Array<{ policyYear: number }>): boolean {
  return rows.every((row, index) => index === 0 || row.policyYear === rows[index - 1].policyYear + 1);
}

export function validateFormalIulPlan(plan: NormalizedIulPlan): FormalDeckIssue[] {
  const issues: FormalDeckIssue[] = [];
  if (!plan.productName) issues.push({ code: "IUL_PRODUCT_NAME_MISSING", level: "error", message: "IUL 缺少产品名称" });
  if (!Number.isFinite(plan.insured.age)) issues.push({ code: "IUL_INSURED_AGE_MISSING", level: "error", message: "IUL 缺少受保人年龄" });
  if (plan.policy.sumInsured <= 0) issues.push({ code: "IUL_SUM_INSURED_INVALID", level: "error", message: "IUL 保额无效" });
  if (!plan.indexAccounts.length) issues.push({ code: "IUL_INDEX_ACCOUNT_MISSING", level: "error", message: "IUL 缺少指数账户配置" });
  if (plan.benefitRows.length < 20) issues.push({ code: "IUL_BENEFIT_ROWS_INCOMPLETE", level: "error", message: `IUL 利益表仅提取 ${plan.benefitRows.length} 行` });
  if (!continuous(plan.benefitRows)) issues.push({ code: "IUL_BENEFIT_ROWS_DISCONTINUOUS", level: "error", message: "IUL 利益表保单年度不连续" });
  if (!plan.source.pdfHash) issues.push({ code: "IUL_SOURCE_HASH_MISSING", level: "error", message: "IUL 缺少源 PDF 哈希" });
  if (plan.benefitRows.some((row) => !row.sourcePage)) {
    issues.push({ code: "IUL_SOURCE_PAGE_MISSING", level: "error", message: "IUL 利益表存在缺少来源页码的数据" });
  }
  return issues;
}
