/**
 * Normalized Deck Data — 跨 renderer 共享的数据契约
 *
 * 设计目标:
 * 1. 单一数据源: PPTX / HTML / PDF / JSON 渲染器都消费同一份
 * 2. 强制包含源追溯: pdfHash + sourcePage 让任何数据点都可回溯
 * 3. 包含商业洞察: targetCustomer / keySellingPoints 让叙事层也能消费
 */
import type { NormalizedSavingsPlan } from "../savings/savings-normalizer.ts";
import type { PdfSignature } from "../extraction/signatures/types.ts";

export type DeckProductKind = "savings" | "ci" | "iul";

export interface DeckBenefitRow {
  policyYear: number;
  age: number;
  totalPremiumPaid: number;
  guaranteedCashValue: number;
  reversionaryBonus: number;
  terminalDividend: number;
  totalSurrenderValue: number;
  deathBenefit: number | null;
  sourcePage?: number;
}

export interface DeckWithdrawalRow {
  policyYear: number;
  age: number;
  totalPremiumPaid: number;
  annualWithdrawal: number;
  cumulativeWithdrawal: number;
  surrenderValueAfter: number;
  guaranteedValueAfter?: number;
  basicSumInsuredAfter?: number;
  sourcePage?: number;
}

export interface DeckMeta {
  pdfHash: string;
  pdfPath: string;
  parser: string;
  signatureId?: string;
  productCode?: string;
  extractedAt: string;
}

export interface DeckSalesInsight {
  targetCustomer: string;
  keySellingPoints: string[];
  uniqueAdvantages?: string;
  suggestedNarrative?: string;
  highlightNumbers: Array<{ year: number; label: string; value: number; description?: string }>;
}

export interface DeckProduct {
  kind: DeckProductKind;
  productName: string;
  rawProductName?: string;
  insured: { name: string; age: number; gender: string; smoker?: boolean | null };
  policy: {
    currency: string;
    annualPremium: number;
    annualPremiumWithLevy?: number | null;
    payYears: number;
    contractualTotalPremium: number;
    coveragePeriod: string;
    sumInsured?: number | null;
    basicSumInsured?: number | null;
  };
  benefitRows: DeckBenefitRow[];
  withdrawalRows: DeckWithdrawalRow[];
  withdrawalProvenance?: "official_extracted" | "advisor_scenario_calculated" | "missing";
  salesInsights?: DeckSalesInsight;
}

export interface DeckCompany {
  id: string;
  displayName: string;
  shortEn: string;
  rating?: string;
  brandProfile?: any;
  evidence: Array<{ text: string; sourceFile: string }>;
}

export interface DeckCustomer {
  name: string;
  age?: number;
  gender?: string;
}

export interface DeckContract {
  id: string;
  generatedAt: string;
  customer: DeckCustomer;
  tenantId: string;
  stylePreset: string;
  quality: "standard" | "high";
  outputFormat: "pptx" | "html" | "pdf" | "json" | "all";
  outputStem: string;
  products: DeckProduct[];
  company: DeckCompany;
  meta: DeckMeta;
  signature?: PdfSignature;
  fidelity: {
    passed: boolean;
    issueCount: number;
    errors: number;
    warnings: number;
    crossCheckPassRate?: number;
  };
}

export function buildDeckContract(params: {
  customer: DeckCustomer;
  tenantId: string;
  stylePreset: string;
  quality: "standard" | "high";
  outputFormat: DeckContract["outputFormat"];
  outputStem: string;
  company: DeckCompany;
  products: DeckProduct[];
  meta: DeckMeta;
  signature?: PdfSignature;
  fidelity: DeckContract["fidelity"];
}): DeckContract {
  return {
    id: `deck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    generatedAt: new Date().toISOString(),
    ...params,
  };
}

export function savingsToDeckProduct(plan: NormalizedSavingsPlan, salesInsights?: DeckSalesInsight): DeckProduct {
  return {
    kind: "savings",
    productName: plan.productName,
    rawProductName: plan.rawProductName,
    insured: plan.insured,
    policy: {
      currency: plan.policy.currency,
      annualPremium: plan.policy.annualPremium,
      annualPremiumWithLevy: plan.policy.annualPremiumWithLevy,
      payYears: plan.policy.payYears,
      contractualTotalPremium: plan.policy.contractualTotalPremium,
      coveragePeriod: plan.policy.coveragePeriod,
    },
    benefitRows: plan.benefitRows.map((r) => ({
      policyYear: r.policyYear,
      age: r.age,
      totalPremiumPaid: r.totalPremiumPaid,
      guaranteedCashValue: r.guaranteedCashValue,
      reversionaryBonus: r.reversionaryBonus,
      terminalDividend: r.terminalDividend,
      totalSurrenderValue: r.totalSurrenderValue,
      deathBenefit: r.deathBenefit,
      sourcePage: r.sourcePage,
    })),
    withdrawalRows: plan.withdrawalRows.map((r) => ({
      policyYear: r.policyYear,
      age: r.age,
      totalPremiumPaid: r.totalPremiumPaid,
      annualWithdrawal: r.annualWithdrawal,
      cumulativeWithdrawal: r.cumulativeWithdrawal,
      surrenderValueAfter: r.surrenderValueAfter,
      guaranteedValueAfter: r.guaranteedValueAfter,
      basicSumInsuredAfter: r.basicSumInsuredAfter,
      sourcePage: r.sourcePage,
    })),
    withdrawalProvenance: plan.withdrawalProvenance,
    salesInsights,
  };
}
