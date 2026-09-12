import crypto from "crypto";
import fs from "fs";
import { loadProductCatalog } from "../config/catalog-loader.ts";
import type { SavingsPlanExtraction } from "../schemas/savings-plan.ts";

export type DataProvenance = "official_extracted" | "advisor_scenario_calculated" | "missing";

export interface SourceRef {
  pdfHash: string;
  pdfPath?: string;
  parser: string;
  page?: number;
  signatureId?: string;
}

export interface NormalizedBenefitRow {
  policyYear: number;
  age: number;
  totalPremiumPaid: number;
  guaranteedCashValue: number;
  reversionaryBonus: number;
  terminalDividend: number;
  totalSurrenderValue: number;
  deathBenefit: number;
  sourcePage?: number;
}

export interface NormalizedWithdrawalRow {
  policyYear: number;
  age: number;
  totalPremiumPaid: number;
  annualWithdrawal: number;
  cumulativeWithdrawal: number;
  surrenderValueAfter: number;
  guaranteedValueAfter: number;
  basicSumInsuredAfter: number;
  sourcePage?: number;
}

export interface NormalizedSavingsPlan {
  kind: "savings";
  productName: string;
  rawProductName?: string;
  insured: { name: string; age: number; gender: string };
  policy: {
    currency: string;
    annualPremium: number;
    annualPremiumWithLevy: number | null;
    payYears: number;
    contractualTotalPremium: number;
    coveragePeriod: string;
  };
  benefitRows: NormalizedBenefitRow[];
  withdrawalRows: NormalizedWithdrawalRow[];
  withdrawalProvenance: DataProvenance;
  source: SourceRef;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function years(value: unknown): number {
  const match = String(value ?? "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function sha256(file?: string): string {
  if (!file || !fs.existsSync(file)) return "";
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function canonicalProductName(rawName: string): string {
  const normalized = rawName.toLowerCase();
  const product = loadProductCatalog().find((entry) =>
    entry.planType === "savings" &&
    entry.aliases.some((alias) => normalized.includes(alias.toLowerCase())),
  );
  return product?.displayName || rawName;
}

export function normalizeSavingsPlan(
  raw: SavingsPlanExtraction,
  options: { pdfPath?: string; parser?: string } = {},
): NormalizedSavingsPlan {
  const insuredAge = number(raw.insured.age);
  const benefitRows = (raw.benefit_illustration || [])
    .map((row: any): NormalizedBenefitRow => ({
      policyYear: number(row.policy_year),
      age: number(row.age) || insuredAge + number(row.policy_year),
      totalPremiumPaid: number(row.total_premium_paid),
      guaranteedCashValue: number(row.guaranteed_cash_value),
      reversionaryBonus: number(row.reversionary_bonus),
      terminalDividend: number(row.terminal_dividend),
      totalSurrenderValue: number(row.total_surrender_value),
      deathBenefit: number(row.death_benefit),
      sourcePage: number(row.source_page) || undefined,
    }))
    .filter((row) => row.policyYear > 0)
    .sort((a, b) => a.policyYear - b.policyYear);

  let cumulative = 0;
  const withdrawalRows = (raw.withdrawal_illustration || [])
    .map((row: any): NormalizedWithdrawalRow => {
      const annualWithdrawal = number(row.annual_withdrawal);
      cumulative = number(row.total_withdrawn ?? row.cumulative_withdrawal) || cumulative + annualWithdrawal;
      return {
        policyYear: number(row.policy_year),
        age: number(row.age) || insuredAge + number(row.policy_year),
        totalPremiumPaid: number(row.total_premium_paid),
        annualWithdrawal,
        cumulativeWithdrawal: cumulative,
        surrenderValueAfter: number(row.surrender_value_after),
        guaranteedValueAfter: number(row.guaranteed_value_after),
        basicSumInsuredAfter: number(row.basic_sum_insured_after),
        sourcePage: number(row.source_page) || undefined,
      };
    })
    .filter((row) => row.policyYear > 0)
    .sort((a, b) => a.policyYear - b.policyYear);

  const annualPremium = number(raw.policy.annual_premium);
  let payYears = years(raw.policy.premium_payment_period);

  // 防御性兜底: 提取器返回 premium_payment_period="0年" 时 (如 AXA 盛利II / CPIC 世代悅享),
  // 从 benefitRows 自动推算 payYears (与 orchestrator.ts IUL 逻辑一致)
  if (payYears <= 0 && annualPremium > 0 && benefitRows.length > 0) {
    let inferredPay = 0;
    let prevPaid = 0;
    for (const r of benefitRows) {
      const paid = number(r.totalPremiumPaid);
      if (paid > prevPaid) {
        inferredPay += 1;
        prevPaid = paid;
      } else if (paid > 0 && paid === prevPaid) {
        break;
      } else {
        break;
      }
    }
    if (inferredPay > 0 && inferredPay <= 30) {
      payYears = inferredPay;
    } else if (benefitRows[0] && number(benefitRows[0].totalPremiumPaid) >= annualPremium) {
      payYears = 1;
    }
  }
  const rawProductName = raw.product_name || raw.policy.product_name;
  return {
    kind: "savings",
    productName: canonicalProductName(rawProductName),
    rawProductName,
    insured: { name: raw.insured.name || "客户", age: insuredAge, gender: raw.insured.gender || "" },
    policy: {
      currency: raw.policy.currency || "USD",
      annualPremium,
      annualPremiumWithLevy: raw.policy.total_premium_with_levy ?? null,
      payYears,
      contractualTotalPremium: annualPremium * payYears,
      coveragePeriod: raw.policy.coverage_period,
    },
    benefitRows,
    withdrawalRows,
    withdrawalProvenance: withdrawalRows.length ? "official_extracted" : "missing",
    source: {
      pdfHash: sha256(options.pdfPath),
      pdfPath: options.pdfPath,
      parser: options.parser || "llm-json",
      signatureId: (options as any).signatureId,
    },
  };
}
