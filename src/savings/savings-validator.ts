import type { SavingsKeyMetrics } from "./savings-mapper.ts";

export interface ValidationIssue {
  field: string;
  message: string;
  level: "error" | "warn";
}

export function validateSavingsMetrics(m: SavingsKeyMetrics): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!m.productName) issues.push({ field: "productName", message: "缺少产品名称", level: "error" });
  if (!m.insuredAge || m.insuredAge <= 0) issues.push({ field: "insuredAge", message: "缺少被保人年龄", level: "error" });
  if (!m.currency) issues.push({ field: "currency", message: "缺少币种", level: "error" });
  if (!m.annualPremium || m.annualPremium <= 0) issues.push({ field: "annualPremium", message: "年缴保费异常", level: "error" });
  if (!m.payYears || m.payYears <= 0) issues.push({ field: "payYears", message: "缴费年期异常", level: "error" });
  if (m.multiple20 === null) issues.push({ field: "multiple20", message: "缺少第20年价值倍数", level: "warn" });
  if (m.multiple30 === null) issues.push({ field: "multiple30", message: "缺少第30年价值倍数", level: "warn" });
  if (m.breakevenYear === null) issues.push({ field: "breakevenYear", message: "未识别回本年", level: "warn" });
  return issues;
}

