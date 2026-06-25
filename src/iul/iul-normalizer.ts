import type { IulExtraction } from "../schemas/iul.ts";
import { sourceRef, type SourceRef } from "../domain/source-ref.ts";

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface NormalizedIulPlan {
  kind: "iul";
  productName: string;
  insured: { name: string; age: number; gender: string; smoker: string };
  policy: {
    currency: string;
    sumInsured: number;
    initialPremium: number;
    annualPremium: number;
    paymentPeriod: string;
    coveragePeriod: string;
  };
  indexAccounts: Array<{
    name: string;
    allocation: number;
    assumedRate: string;
    floorRate: string;
    capRate: string;
    participationRate: string;
  }>;
  benefitRows: Array<{
    policyYear: number;
    age: number;
    totalPremiumPaid: number;
    guaranteedCashValue: number;
    nonGuaranteedCashValue: number;
    guaranteedDeathBenefit: number;
    nonGuaranteedDeathBenefit: number;
    sourcePage?: number;
  }>;
  source: SourceRef;
}

export function normalizeIulPlan(
  raw: IulExtraction,
  options: { pdfPath?: string; parser?: string } = {},
): NormalizedIulPlan {
  const insuredAge = number(raw.insured.age);
  return {
    kind: "iul",
    productName: raw.product_name,
    insured: {
      name: raw.insured.name || "客户",
      age: insuredAge,
      gender: raw.insured.gender || "",
      smoker: raw.insured.smoker || "",
    },
    policy: {
      currency: raw.policy.currency,
      sumInsured: number(raw.policy.sum_insured),
      initialPremium: number(raw.policy.initial_premium),
      annualPremium: number(raw.policy.annual_premium),
      paymentPeriod: raw.policy.premium_payment_period,
      coveragePeriod: raw.policy.coverage_period,
    },
    indexAccounts: (raw.index_accounts || []).map((account) => ({
      name: account.name,
      allocation: number(account.allocation),
      assumedRate: account.current_assumed_rate || "",
      floorRate: account.guaranteed_floor_rate || "",
      capRate: account.cap_rate || "",
      participationRate: account.participation_rate || "",
    })),
    benefitRows: (raw.benefit_illustration || []).map((row) => ({
      policyYear: row.policy_year,
      age: number(row.age) || insuredAge + row.policy_year,
      totalPremiumPaid: number(row.total_premium_paid),
      guaranteedCashValue: number(row.guaranteed_cash_value),
      nonGuaranteedCashValue: number(row.non_guaranteed_cash_value),
      guaranteedDeathBenefit: number(row.guaranteed_death_benefit),
      nonGuaranteedDeathBenefit: number(row.non_guaranteed_death_benefit),
      sourcePage: row.source_page,
    })),
    source: sourceRef(options),
  };
}
