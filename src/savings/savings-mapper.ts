export interface SavingsKeyMetrics {
  insuredName: string;
  insuredAge: number;
  insuredGender: string;
  productName: string;
  currency: string;
  annualPremium: number;
  payYears: number;
  totalPremium: number;
  breakevenYear: number | null;
  multiple20: number | null;
  multiple30: number | null;
  withdrawStartYear: number | null;
  withdrawStartAge: number | null;
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function parseYears(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v || "").trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

export function mapSavingsMetrics(data: any): SavingsKeyMetrics {
  const rows = Array.isArray(data?.benefit_illustration) ? data.benefit_illustration : [];
  const insuredAge = n(data?.insured?.age || 0);
  const annualPremium = n(data?.policy?.annual_premium || 0);
  const payYears = parseYears(data?.policy?.premium_payment_period || 0);
  // `total_premium_with_levy` in insurer proposals is commonly one annual
  // premium including levy, not the contractual total across all pay years.
  const totalPremium = annualPremium * payYears;

  const row20 = rows.find((r: any) => n(r?.policy_year) === 20);
  const row30 = rows.find((r: any) => n(r?.policy_year) === 30);
  const multiple20 = row20 ? Number((n(row20.total_surrender_value) / Math.max(n(row20.total_premium_paid), 1)).toFixed(2)) : null;
  const multiple30 = row30 ? Number((n(row30.total_surrender_value) / Math.max(n(row30.total_premium_paid), 1)).toFixed(2)) : null;

  let breakevenYear: number | null = null;
  for (const r of rows) {
    const paid = n(r?.total_premium_paid);
    const val = n(r?.total_surrender_value);
    if (paid > 0 && val >= paid) {
      breakevenYear = n(r?.policy_year);
      break;
    }
  }

  const wr = Array.isArray(data?.withdrawal_illustration) ? data.withdrawal_illustration : [];
  let withdrawStartYear: number | null = null;
  let withdrawStartAge: number | null = null;
  for (const r of wr) {
    if (n(r?.annual_withdrawal) > 0) {
      withdrawStartYear = n(r?.policy_year);
      withdrawStartAge = n(r?.age || insuredAge + withdrawStartYear);
      break;
    }
  }

  return {
    insuredName: String(data?.insured?.name || "客户"),
    insuredAge,
    insuredGender: String(data?.insured?.gender || ""),
    productName: String(data?.product_name || data?.policy?.product_name || ""),
    currency: String(data?.policy?.currency || "USD"),
    annualPremium,
    payYears,
    totalPremium,
    breakevenYear,
    multiple20,
    multiple30,
    withdrawStartYear,
    withdrawStartAge,
  };
}
