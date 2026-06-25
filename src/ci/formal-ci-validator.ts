import type { FormalDeckIssue } from "../savings/formal-deck-validator.ts";
import type { NormalizedCiPlan } from "./ci-normalizer.ts";

export function validateFormalCiPlan(plan: NormalizedCiPlan): FormalDeckIssue[] {
  const issues: FormalDeckIssue[] = [];
  if (!plan.productName) issues.push({ code: "CI_PRODUCT_NAME_MISSING", level: "error", message: "重疾险缺少产品名称" });
  if (!Number.isFinite(plan.insured.age)) issues.push({ code: "CI_INSURED_AGE_MISSING", level: "error", message: "重疾险缺少受保人年龄" });
  if (plan.policy.sumInsured <= 0) issues.push({ code: "CI_SUM_INSURED_INVALID", level: "error", message: "重疾险保额无效" });
  if (plan.policy.annualPremium <= 0) issues.push({ code: "CI_ANNUAL_PREMIUM_INVALID", level: "error", message: "重疾险年缴保费无效" });
  if (plan.policy.payYears <= 0) issues.push({ code: "CI_PAY_YEARS_INVALID", level: "error", message: "重疾险缴费年期无效" });
  if (!plan.coverageItems.length) issues.push({ code: "CI_COVERAGE_ITEMS_MISSING", level: "error", message: "重疾险保障项目为空" });
  return issues;
}
