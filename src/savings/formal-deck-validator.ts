import type { NormalizedSavingsPlan } from "./savings-normalizer.ts";
import { crossValidateSavings, type CrossCheckIssue } from "./cross-validator.ts";

export interface FormalDeckIssue {
  code: string;
  level: "error" | "warn";
  message: string;
}

function continuity(rows: { policyYear: number }[]): boolean {
  return rows.every((row, index) => index === 0 || row.policyYear === rows[index - 1].policyYear + 1);
}

export function validateFormalSavingsPlan(plan: NormalizedSavingsPlan): FormalDeckIssue[] {
  const issues: FormalDeckIssue[] = [];
  if (!plan.productName) issues.push({ code: "PRODUCT_NAME_MISSING", level: "error", message: "缺少产品名称" });
  if (!plan.insured.age && plan.insured.age !== 0) issues.push({ code: "INSURED_AGE_MISSING", level: "error", message: "缺少受保人年龄" });
  if (plan.policy.annualPremium <= 0) issues.push({ code: "ANNUAL_PREMIUM_INVALID", level: "error", message: "年缴保费无效" });
  if (plan.policy.payYears <= 0) issues.push({ code: "PAY_YEARS_INVALID", level: "error", message: "缴费年期无效" });
  if (plan.benefitRows.length < 20) issues.push({ code: "BENEFIT_ROWS_INCOMPLETE", level: "error", message: `基础利益表仅提取 ${plan.benefitRows.length} 行` });
  if (!continuity(plan.benefitRows)) issues.push({ code: "BENEFIT_ROWS_DISCONTINUOUS", level: "error", message: "基础利益表保单年度不连续" });
  if (!plan.source.pdfHash) issues.push({ code: "SOURCE_HASH_MISSING", level: "error", message: "缺少源 PDF 哈希" });
  if (plan.benefitRows.some((row) => !row.sourcePage)) issues.push({ code: "BENEFIT_SOURCE_PAGE_MISSING", level: "warn", message: "基础利益表存在缺少来源页码的数据" });
  if (plan.withdrawalRows.length && !continuity(plan.withdrawalRows)) issues.push({ code: "WITHDRAWAL_ROWS_DISCONTINUOUS", level: "error", message: "提领表保单年度不连续" });
  if (plan.withdrawalRows.some((row) => !row.sourcePage)) issues.push({ code: "WITHDRAWAL_SOURCE_PAGE_MISSING", level: "warn", message: "提领表存在缺少来源页码的数据" });
  if (!plan.withdrawalRows.length) issues.push({ code: "WITHDRAWAL_ROWS_MISSING", level: "warn", message: "未提取官方提领表，正式版将隐藏提领页面" });
  // 关键数字交叉验证 (vs 签名基线)
  const signatureId = (plan as any).source?.signatureId;
  if (signatureId) {
    issues.push(...crossValidateSavings(plan, signatureId));
  }
  return issues;
}

export class FormalDeckValidationError extends Error {
  constructor(public readonly issues: FormalDeckIssue[]) {
    super(`正式版导出校验失败: ${issues.filter((issue) => issue.level === "error").map((issue) => issue.message).join("；")}`);
  }
}
