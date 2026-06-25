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

  // ── 缴费年期一致性 (数据驱动, 不信任 LLM 提取的 paymentPeriod 字段) ──
  // 关键防御: Sunlife IUL 趸交 PDF 第 7-9 页有英文 Premium Breakdown 表, 旧版 extractor 会污染数据
  // 这里从 totalPremiumPaid 的逐年增量反推缴费年数 (因为 totalPremiumPaid 是累计值, 永远不减)
  if (plan.benefitRows.length > 0 && plan.policy.paymentPeriod) {
    let detectedPayYears = 0;
    let prevPaid = 0;
    for (const row of plan.benefitRows) {
      const yearDelta = row.totalPremiumPaid - prevPaid;
      if (yearDelta > 0) {
        // 该年有缴费
        detectedPayYears = row.policyYear;
        prevPaid = row.totalPremiumPaid;
      } else {
        // 当年累计无增长, 缴费期结束
        break;
      }
    }
    const statedRaw = String(plan.policy.paymentPeriod).trim();
    const statedPayYears = statedRaw === "趸交" ? 1 : parseInt(statedRaw.replace("年", ""), 10) || 0;
    if (detectedPayYears > 0 && statedPayYears > 0 && detectedPayYears !== statedPayYears) {
      issues.push({
        code: "IUL_PAY_TERM_MISMATCH",
        level: "error",
        message: `缴费年期不一致: 利益表显示 ${detectedPayYears} 年 (Y1-Y${detectedPayYears} 有保费), 但 policy.paymentPeriod = "${plan.policy.paymentPeriod}"`,
      });
    }
  }

  // ── 年龄合理性 (防御类似 age=412700 的英文表污染) ──
  // 上限 150: 真实保单可能到 Y72 (49岁+72=121), 留余量; 远超 150 一定是英文表污染
  for (const row of plan.benefitRows) {
    if (!Number.isFinite(row.age) || row.age < 0 || row.age > 150) {
      issues.push({
        code: "IUL_AGE_OUT_OF_RANGE",
        level: "error",
        message: `Y${row.policyYear} 年龄异常: ${row.age} (应在 0-150, 可能英文 Premium Breakdown 表污染)`,
      });
      break;  // 一个就够, 不重复报
    }
  }

  return issues;
}
