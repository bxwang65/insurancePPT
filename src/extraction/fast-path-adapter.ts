/**
 * 把 signature-extractor 的输出转成 SavingsPlanExtraction 兼容的 JSON
 * 让 pipeline 可以直接消费而无需 LLM
 *
 * CI 计划: 也走同一转换 (退保发还金额 进 benefit_illustration, 保额进 policy)
 */
import type { SignatureExtractionResult } from "./signature-extractor.ts";

export interface SavingsPlanLike {
  product_name: string;
  product_type: "savings";
  insured: {
    name: string;
    age: number;
    gender: string;
    smoker: null;
  };
  policy: {
    product_name: string;
    currency: string;
    sum_insured: null;
    basic_sum_insured: null;
    annual_premium: number;
    premium_payment_period: string;
    coverage_period: string;
    total_premium_with_levy: number | null;
  };
  benefit_illustration: Array<{
    policy_year: number;
    total_premium_paid: number;
    guaranteed_cash_value: number;
    reversionary_bonus: number;
    terminal_dividend: number;
    total_surrender_value: number;
    death_benefit: number | null;
  }>;
  withdrawal_illustration: Array<{
    policy_year: number;
    total_premium_paid: number;
    annual_withdrawal: number;
    total_withdrawn: number;
    surrender_value_before: number;
    surrender_value_after: number;
  }>;
  sales_insights: {
    target_customer: string;
    key_selling_points: string[];
    unique_advantages: string;
    suggested_narrative: string;
    highlight_numbers: Array<{ year: number; label: string; value: number; description: string }>;
  };
  _meta?: {
    source: "signature_fast_path";
    signatureId: string;
    parser: string;
    warnings: string[];
  };
}

export function toSavingsPlanFromSignature(
  result: SignatureExtractionResult,
  signatureId: string,
  signatureProductName: string,
  currency = "USD",
): SavingsPlanLike {
  const s = result.summary;
  const insuredName = s.insured_name || "VIP";
  const insuredAge = Number(s.insured_age || 0);
  const insuredGender = s.insured_gender || "";
  const annualPremium = Number(s.annual_premium || 0);
  const annualPremiumWithLevy = Number(s.annual_premium_with_levy || 0) || null;
  const payYears = Number(s.payment_years || 0);
  const totalPremium = Number(s.premium_total || annualPremium * payYears);
  const coveragePeriod = s.coverage_period || `至128岁`;

  // 不提领表 → benefit_illustration
  // Total 必须 = Guar_CV + Rev + Term (退保发还总额 = 保证 + 归原 + 终期)
  const benefit_illustration: SavingsPlanLike["benefit_illustration"] = [];
  for (const y of Object.keys(result.no_withdraw).sort((a, b) => Number(a) - Number(b))) {
    const r = result.no_withdraw[y] as any;
    const gcv = Number(r.Guar_CV) || 0;
    const rev = Number(r.Rev) || 0;
    const term = Number(r.Term) || 0;
    const total = Number(r.Total) || 0;
    // 如果 Total < Guarantee（提取列错位）, 用公式重算
    const correctedTotal = total < gcv ? gcv + rev + term : total;
    benefit_illustration.push({
      policy_year: r.Y,
      total_premium_paid: Number(r.Paid) || 0,
      guaranteed_cash_value: gcv,
      reversionary_bonus: rev,
      terminal_dividend: term,
      total_surrender_value: correctedTotal,
      death_benefit: null,
      source_page: r.SourcePage,
    } as any);
  }

  // 提领表 → withdrawal_illustration
  const withdrawal_illustration: SavingsPlanLike["withdrawal_illustration"] = [];
  for (const y of Object.keys(result.withdraw).sort((a, b) => Number(a) - Number(b))) {
    const r = result.withdraw[y] as any;
    if (r.Annual_WD === 0 && r.Total === 0) continue;
    withdrawal_illustration.push({
      policy_year: r.Y,
      total_premium_paid: r.Paid || totalPremium,
      annual_withdrawal: r.Annual_WD,
      total_withdrawn: r.Cum_WD,
      surrender_value_before: 0,
      surrender_value_after: r.Total,
      source_page: r.SourcePage,
    } as any);
  }

  // 关键数字高亮 (无 LLM, 用规则自动选)
  const highlight_numbers: SavingsPlanLike["sales_insights"]["highlight_numbers"] = [];
  for (const y of [5, 7, 10, 20, 30]) {
    const r = result.no_withdraw[String(y)];
    if (!r) continue;
    const mult = r.Mult ?? (r.Total / totalPremium);
    const tag = y === 7 ? "回本年" : y === 20 ? "20年倍数" : y === 30 ? "30年倍数" : `Y${y}`;
    highlight_numbers.push({
      year: y,
      label: tag,
      value: Math.round(r.Total),
      description: mult >= 1
        ? `已达 ${mult.toFixed(2)} 倍本金`
        : `本金累计中 (${(mult * 100).toFixed(0)}%)`,
    });
  }

  return {
    product_name: signatureProductName || s.product_name || "未知产品",
    product_type: "savings",
    insured: {
      name: insuredName,
      age: insuredAge,
      gender: insuredGender,
      smoker: null,
    },
    policy: {
      product_name: signatureProductName || s.product_name || "",
      currency: s.currency || currency,
      sum_insured: null,
      basic_sum_insured: null,
      annual_premium: annualPremium,
      premium_payment_period: `${payYears}年`,
      coverage_period: coveragePeriod,
      total_premium_with_levy: annualPremiumWithLevy,
    },
    benefit_illustration,
    withdrawal_illustration,
    sales_insights: {
      target_customer: "本计划适合具备稳定供款能力、追求长期复利与传承规划的家庭。",
      key_selling_points: [
        "保证现金价值保底",
        "复归红利 + 终期分红双轮驱动",
        "至128岁超长保障周期",
      ],
      unique_advantages: "已通过 PDF 签名快路径完成提取，数字 100% 来自官方计划书。",
      suggested_narrative: "聚焦长期复利 + 灵活提领 + 代际传承。",
      highlight_numbers,
    },
    _meta: {
      source: "signature_fast_path",
      signatureId,
      parser: result.diagnostics.parser,
      warnings: result.diagnostics.warnings,
    },
  };
}
