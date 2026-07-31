import type { CiPlanExtraction } from "../schemas/critical-illness.ts";
import { sourceRef, type SourceRef } from "../domain/source-ref.ts";

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function years(value: unknown): number {
  const match = String(value ?? "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

export interface NormalizedCiPlan {
  kind: "ci";
  productName: string;
  insured: { name: string; age: number; gender: string; smoker: string };
  policy: {
    currency: string;
    sumInsured: number;
    baseSumInsured: number;
    upgradeBenefitAmount: number;
    upgradeBenefitYears: number;
    annualPremium: number;
    annualPremiumWithLevy: number | null;
    payYears: number;
    totalPremium: number;
    coveragePeriod: string;
  };
  coverageSummary: {
    majorCiCount: number;
    earlyCiCount: number;
  };
  coverageItems: Array<{ name: string; amount: number; description: string; sourcePage?: number }>;
  icuBenefitRules: Array<{
    level: string;
    payoutPercentage?: string;
    maxAmount?: number | null;
    waitingPeriodHours?: number | null;
    description: string;
    sourcePage?: number;
  }>;
  multiClaimRules: Array<{
    condition: string;
    claimCount: number;
    claimPercentage?: string;
    waitingPeriod?: string;
    description: string;
    sourcePage?: number;
  }>;
  premiumWaiverRiders: Array<{
    name: string;
    coverageAmount?: number | null;
    annualPremium?: number | null;
    payYears?: number | null;
    description: string;
    sourcePage?: number;
  }>;
  benefitRows: Array<{
    policyYear: number;
    totalPremiumPaid: number;
    deathBenefit: number;
    ciBenefit?: number;
    sourcePage?: number;
  }>;
  source: SourceRef;
}

export function normalizeCiPlan(
  raw: CiPlanExtraction,
  options: { pdfPath?: string; parser?: string } = {},
): NormalizedCiPlan {
  return {
    kind: "ci",
    productName: raw.product_name || raw.policy.product_name,
    insured: {
      name: raw.insured.name || "客户",
      age: number(raw.insured.age),
      gender: raw.insured.gender || "",
      smoker: raw.insured.smoker || "",
    },
    policy: {
      currency: raw.policy.currency,
      sumInsured: number(raw.policy.sum_insured),
      baseSumInsured: number(raw.base_sum_insured ?? raw.policy.basic_sum_insured ?? raw.policy.sum_insured),
      upgradeBenefitAmount: number(raw.upgrade_benefit_amount),
      upgradeBenefitYears: number(raw.upgrade_benefit_years),
      annualPremium: number(raw.policy.annual_premium),
      annualPremiumWithLevy: raw.policy.total_premium_with_levy ?? null,
      payYears: years(raw.policy.premium_payment_period),
      totalPremium: number(raw.policy.annual_premium) * years(raw.policy.premium_payment_period),
      coveragePeriod: raw.policy.coverage_period,
    },
    coverageSummary: {
      majorCiCount: number(raw.major_ci_count),
      earlyCiCount: number(raw.early_ci_count),
    },
    coverageItems: (raw.coverage_items || []).map((item: any) => ({
      label: item.label || item.name || "",
      name: item.label || item.name || "",  // 兼容
      amount: number(item.amount),
      percentage: item.percentage || null,
      description: item.description || "",
      sourcePage: number(item.source_page) || 1,
      source_page: number(item.source_page) || 1,
    })),
    icuBenefitRules: (raw.icu_benefit_rules || []).map((rule) => ({
      level: rule.level,
      payoutPercentage: rule.payout_percentage || undefined,
      maxAmount: rule.max_amount ?? undefined,
      waitingPeriodHours: rule.waiting_period_hours ?? undefined,
      description: rule.description || "",
      sourcePage: rule.source_page,
    })),
    multiClaimRules: (raw.multi_claim || []).map((item) => ({
      condition: item.condition,
      claimCount: number(item.claim_count),
      claimPercentage: item.claim_percentage || undefined,
      waitingPeriod: item.waiting_period || undefined,
      description: item.description || "",
      sourcePage: item.source_page,
    })),
    premiumWaiverRiders: (raw.premium_waiver_riders || []).map((item) => ({
      name: item.name,
      coverageAmount: item.coverage_amount ?? undefined,
      annualPremium: item.annual_premium ?? undefined,
      payYears: item.pay_years ?? undefined,
      description: item.description || "",
      sourcePage: item.source_page,
    })),
    benefitRows: (raw.benefit_illustration || []).map((row: any) => ({
      policyYear: row.policy_year,
      totalPremiumPaid: number(row.total_premium_paid),
      deathBenefit: number(row.death_benefit) || number(raw.policy?.sum_insured || 0),
      ciBenefit: number(row.ci_benefit) || undefined,
      sourcePage: row.source_page || 1,
    })),
    source: sourceRef(options),
  };
}
