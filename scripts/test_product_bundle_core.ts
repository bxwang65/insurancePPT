import assert from "node:assert/strict";
import { planBundle } from "../src/bundles/bundle-planner.ts";
import { validateFormalCiPlan } from "../src/ci/formal-ci-validator.ts";
import { validateFormalIulPlan } from "../src/iul/formal-iul-validator.ts";
import type { NormalizedSavingsPlan } from "../src/savings/savings-normalizer.ts";
import type { NormalizedCiPlan } from "../src/ci/ci-normalizer.ts";
import type { NormalizedIulPlan } from "../src/iul/iul-normalizer.ts";

const source = { pdfHash: "test-hash", parser: "fixture" };
const savings = { kind: "savings", source } as NormalizedSavingsPlan;
const ci = {
  kind: "ci",
  productName: "CI fixture",
  insured: { name: "客户", age: 35, gender: "男", smoker: "否" },
  policy: {
    currency: "USD",
    sumInsured: 1_000_000,
    baseSumInsured: 1_000_000,
    upgradeBenefitAmount: 350_000,
    upgradeBenefitYears: 10,
    annualPremium: 20_000,
    annualPremiumWithLevy: 20_020,
    payYears: 20,
    totalPremium: 400_000,
    coveragePeriod: "终身",
  },
  coverageSummary: { majorCiCount: 58, earlyCiCount: 44 },
  coverageItems: [{ name: "严重疾病", amount: 1_000_000, description: "", sourcePage: 8 }],
  icuBenefitRules: [{ level: "一级", payoutPercentage: "20%", maxAmount: 50_000, waitingPeriodHours: 72, description: "", sourcePage: 9 }],
  multiClaimRules: [{ condition: "癌症", claimCount: 6, claimPercentage: "100%", waitingPeriod: "3年", description: "", sourcePage: 10 }],
  premiumWaiverRiders: [{ name: "免付保费附加契约", coverageAmount: 1_000_000, annualPremium: 0, payYears: 20, description: "", sourcePage: 1 }],
  benefitRows: [],
  cashValueMilestones: [{ policyYear: 20, label: "Y20", totalSurrenderValue: 48_000, sourcePage: 12 }],
  source,
} satisfies NormalizedCiPlan;
const iul = {
  kind: "iul",
  productName: "IUL fixture",
  insured: { name: "客户", age: 35, gender: "男", smoker: "否" },
  policy: { currency: "USD", sumInsured: 1_000_000, initialPremium: 100_000, annualPremium: 100_000, paymentPeriod: "5年", coveragePeriod: "终身" },
  indexAccounts: [{ name: "指数账户", allocation: 100, assumedRate: "6%", floorRate: "0%", capRate: "", participationRate: "" }],
  benefitRows: Array.from({ length: 20 }, (_, index) => ({
    policyYear: index + 1,
    age: 36 + index,
    totalPremiumPaid: 100_000 * Math.min(index + 1, 5),
    guaranteedCashValue: 0,
    nonGuaranteedCashValue: 0,
    guaranteedDeathBenefit: 1_000_000,
    nonGuaranteedDeathBenefit: 1_000_000,
    sourcePage: 18,
  })),
  source,
} satisfies NormalizedIulPlan;

assert.equal(planBundle([savings]).bundleId, "savings-single");
assert.equal(planBundle([ci]).bundleId, "ci-single");
assert.equal(planBundle([iul]).bundleId, "iul-single");
assert.equal(planBundle([savings, ci]).bundleId, "savings-ci");
assert.equal(planBundle([savings, iul]).bundleId, "savings-iul");
assert.equal(planBundle([savings, ci, iul]).bundleId, "savings-ci-iul");
assert.deepEqual(validateFormalCiPlan(ci), []);
assert.deepEqual(validateFormalIulPlan(iul), []);

console.log(JSON.stringify({
  status: "ok",
  bundles: ["savings-single", "ci-single", "iul-single", "savings-ci", "savings-iul", "savings-ci-iul"],
  ciQa: "pass",
  iulQa: "pass",
}, null, 2));
