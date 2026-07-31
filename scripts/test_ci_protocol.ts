import assert from "node:assert/strict";
import { normalizeCiPlan } from "../src/ci/ci-normalizer.ts";
import { validateFormalCiPlan } from "../src/ci/formal-ci-validator.ts";
import type { CiPlanExtraction } from "../src/schemas/critical-illness.ts";

const raw: CiPlanExtraction = {
  product_name: "愛伴航保險計劃2",
  insured: { name: "VIP 女士", age: 32, gender: "女", smoker: "非吸烟者" },
  policy: {
    product_name: "愛伴航保險計劃2",
    currency: "USD",
    sum_insured: 100000,
    basic_sum_insured: 100000,
    annual_premium: 7008,
    premium_payment_period: "10年",
    coverage_period: "终身",
    total_premium_with_levy: 7015.01,
  },
  base_sum_insured: 100000,
  upgrade_benefit_amount: 35000,
  upgrade_benefit_years: 10,
  early_ci_count: 44,
  major_ci_count: 58,
  coverage_items: [
    { name: "严重疾病赔偿", amount: 100000, description: "基本重疾保障", source_page: 8 },
    { name: "升级保障（首十年）", amount: 35000, description: "前十年额外保障", source_page: 1 },
  ],
  icu_benefit_rules: [
    { level: "级别一", payout_percentage: "20%", max_amount: 50000, waiting_period_hours: 72, description: "入住ICU连续72小时", source_page: 8 },
  ],
  multi_claim: [
    { condition: "癌症", claim_count: 6, claim_percentage: "100%", waiting_period: "3年", description: "持续癌症现金选项相关", source_page: 10 },
  ],
  premium_waiver_riders: [
    { name: "免付保费附加契约（基本计划）", coverage_amount: 100000, annual_premium: 0, pay_years: 10, description: "豁免未来应付定期保费", source_page: 1 },
  ],
  benefit_illustration: [
    {
      policy_year: 20,
      total_premium_paid: 70080,
      guaranteed_cash_value: 29272,
      terminal_dividend: 18730,
      total_surrender_value: 48002,
      death_benefit: 124870,
      ci_benefit: 124870,
      source_page: 3,
    },
  ],
  cash_value_milestones: [
    { policy_year: 20, label: "Y20 退保价值", total_surrender_value: 48002, source_page: 3 },
    { policy_year: 30, label: "Y30 退保价值", total_surrender_value: 146065, source_page: 3 },
  ],
};

const normalized = normalizeCiPlan(raw, { pdfPath: "/Users/soldier/free-code/packages/insurance-ppt/package.json", parser: "fixture-ci" });
const issues = validateFormalCiPlan(normalized).filter((issue) => issue.level === "error");

assert.equal(normalized.policy.baseSumInsured, 100000);
assert.equal(normalized.policy.upgradeBenefitAmount, 35000);
assert.equal(normalized.policy.upgradeBenefitYears, 10);
assert.equal(normalized.policy.totalPremium, 70080);
assert.equal(normalized.coverageSummary.majorCiCount, 58);
assert.equal(normalized.coverageSummary.earlyCiCount, 44);
assert.equal(normalized.icuBenefitRules[0]?.waitingPeriodHours, 72);
assert.equal(normalized.multiClaimRules[0]?.condition, "癌症");
assert.equal(normalized.premiumWaiverRiders[0]?.name.includes("免付保费"), true);
assert.equal(normalized.cashValueMilestones[1]?.totalSurrenderValue, 146065);
assert.deepEqual(issues, []);

console.log(JSON.stringify({
  status: "ok",
  policy: normalized.policy,
  coverageSummary: normalized.coverageSummary,
  icuRules: normalized.icuBenefitRules.length,
  multiClaimRules: normalized.multiClaimRules.length,
  riders: normalized.premiumWaiverRiders.length,
  milestones: normalized.cashValueMilestones.length,
}, null, 2));
