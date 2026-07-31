import { z } from "zod";
import { InsuredPersonSchema, PolicySummarySchema } from "./common.ts";
import { SalesInsightsSchema } from "./savings-plan.ts";

/** 保障项目 */
export const CoverageItemSchema = z.object({
  name: z.string().optional().default("").describe("保障项目名称"),
  label: z.string().optional().default("").describe("保障项目名称（别名）"),
  amount: z.number().nullable().describe("保障金额"),
  description: z.string().optional().describe("简要说明"),
  percentage: z.union([z.number(), z.string()]).nullable().optional().describe("赔付比例"),
  source_page: z.number().int().positive().optional().describe("来源页码"),
}).transform((item) => ({
  ...item,
  name: item.name || item.label || "",
  label: item.name || item.label || "",
}));

export const IcuBenefitRuleSchema = z.object({
  level: z.string().describe("ICU 赔付层级"),
  payout_percentage: z.string().optional().describe("赔付比例"),
  max_amount: z.number().nullable().optional().describe("最高赔付金额"),
  waiting_period_hours: z.number().nullable().optional().describe("等待时长（小时）"),
  description: z.string().optional().describe("说明"),
  source_page: z.number().int().positive().optional().describe("来源页码"),
});

export const PremiumWaiverRiderSchema = z.object({
  name: z.string().describe("附加契约名称"),
  coverage_amount: z.number().nullable().optional().describe("附加契约保额"),
  annual_premium: z.number().nullable().optional().describe("附加契约年缴保费"),
  pay_years: z.number().nullable().optional().describe("附加契约缴费年期"),
  description: z.string().optional().describe("说明"),
  source_page: z.number().int().positive().optional().describe("来源页码"),
});

/** 每年利益演示 — 仅需: 已缴总保费, 身故赔偿额 */
export const CiYearlyRowSchema = z.object({
  policy_year: z.number().int().positive().describe("保单年度"),
  total_premium_paid: z.number().default(0).describe("已缴总保费 = annual_premium × min(policy_year, payment_years)"),
  death_benefit: z.number().default(0).describe("身故赔偿额（通常=保额, 无则填0, 渲染器会fallback到sum_insured）"),
  ci_benefit: z.number().nullable().optional().describe("严重疾病赔偿额（如有）"),
  source_page: z.number().int().positive().optional().describe("来源页码"),
});

/** 多次赔付说明 */
export const MultiClaimSchema = z.object({
  condition: z.string().describe("疾病名称"),
  claim_count: z.number().describe("赔付次数"),
  claim_percentage: z.string().optional().describe("赔付比例"),
  waiting_period: z.string().optional().describe("等待期"),
  description: z.string().optional().describe("说明"),
  source_page: z.number().int().positive().optional().describe("来源页码"),
});

/** 重疾险完整提取结果 */
export const CiPlanExtractionSchema = z.object({
  product_name: z.string().describe("产品全称"),
  product_type: z.string().optional().describe("产品类型"),
  insured: InsuredPersonSchema,
  policy: PolicySummarySchema,
  base_sum_insured: z.number().nullable().optional().describe("基础保额"),
  upgrade_benefit_amount: z.number().nullable().optional().describe("升级保障金额"),
  upgrade_benefit_years: z.number().nullable().optional().describe("升级保障年期"),
  early_ci_count: z.number().nullable().optional().describe("早期危疾数量"),
  major_ci_count: z.number().nullable().optional().describe("严重疾病数量"),
  /** 保障项目列表 */
  coverage_items: z.array(CoverageItemSchema).describe("保障项目列表"),
  icu_benefit_rules: z.array(IcuBenefitRuleSchema).optional().describe("ICU / 深切治疗保障规则"),
  /** 多次赔付详情 */
  multi_claim: z.array(MultiClaimSchema).optional().describe("多次赔付说明"),
  premium_waiver_riders: z.array(PremiumWaiverRiderSchema).optional().describe("豁免保费附加责任"),
  /** 利益演示 */
  benefit_illustration: z.array(CiYearlyRowSchema).optional().describe("利益演示数据"),
  /** 销售洞察 */
  sales_insights: SalesInsightsSchema.optional(),
});

export type CiPlanExtraction = z.infer<typeof CiPlanExtractionSchema>;

export function validateCiExtraction(data: unknown) {
  const result = CiPlanExtractionSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data, errors: [] };
  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}
