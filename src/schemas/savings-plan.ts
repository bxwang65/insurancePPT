import { z } from "zod";
import {
  InsuredPersonSchema,
  PolicySummarySchema,
  YearlyBenefitRowSchema,
  ScenarioAnalysisSchema,
} from "./common.ts";
export type { YearlyBenefitRow } from "./common.ts";

/** 销售洞察（AI 从销售顾问角度分析） */
export const SalesInsightsSchema = z.object({
  /** 目标客户画像 */
  target_customer: z.string().describe("适合什么样的客户（如：高净值人士、退休规划、财富传承）"),
  /** 核心卖点 */
  key_selling_points: z.array(z.string()).describe("该计划的核心卖点列表"),
  /** 独特优势 */
  unique_advantages: z.string().optional().describe("相比同类产品的独特优势"),
  /** 建议的叙事主题 */
  suggested_narrative: z.string().optional().describe("建议的展示叙事方向（如：'您的退休收入蓝图'）"),
  /** 关键展示数字 */
  highlight_numbers: z.array(z.any()).optional().describe("建议在PPT中重点展示的关键数字"),
});

export type SalesInsights = z.infer<typeof SalesInsightsSchema>;

/** 每年提取场景数据行 */
export const WithdrawalRowSchema = z.object({
  policy_year: z.number().int().positive().describe("保单年度"),
  total_premium_paid: z.number().describe("已缴总保费"),
  annual_withdrawal: z.number().default(0).describe("当年提取金额"),
  total_withdrawn: z.number().default(0).describe("累计提取总额"),
  surrender_value_before: z.number().nullable().optional().describe("提取前退保金额"),
  surrender_value_after: z.number().nullable().describe("提取后退保金额"),
  guaranteed_value_after: z.number().nullable().optional().describe("提取后保证价值"),
  basic_sum_insured_after: z.number().nullable().optional().describe("提取后的基本金额"),
  age: z.number().nullable().optional().describe("保单年度终结年龄"),
  source_page: z.number().int().positive().optional().describe("来源页码"),
});

export type WithdrawalRow = z.infer<typeof WithdrawalRowSchema>;

/** 储蓄险完整提取结果 */
export const SavingsPlanExtractionSchema = z.object({
  /** 产品名称 */
  product_name: z.string().describe("产品名称"),
  /** 受保人信息 */
  insured: InsuredPersonSchema.describe("受保人信息"),
  /** 保单概要 */
  policy: PolicySummarySchema.describe("保单概要"),
  /** 逐年利益演示数据 */
  benefit_illustration: z.array(YearlyBenefitRowSchema).describe("逐年利益演示数据"),
  /** 情景分析（乐观/悲观），如有 */
  scenario_analysis: ScenarioAnalysisSchema.optional().describe("情景分析"),
  /** 提取场景演示（如有提取计划） */
  withdrawal_illustration: z.array(WithdrawalRowSchema).optional().describe("每年提取后的利益演示数据"),
  /** 销售洞察（AI 分析） */
  sales_insights: SalesInsightsSchema.optional().describe("AI 从销售视角分析的洞察"),
  /** 原始文本摘要（用于调试） */
  _raw_summary: z.string().optional().describe("原始文本摘要"),
});

export type SavingsPlanExtraction = z.infer<typeof SavingsPlanExtractionSchema>;

/** 验证提取结果，返回友好的错误信息 */
export function validateExtraction(data: unknown): {
  success: boolean;
  data?: SavingsPlanExtraction;
  errors: string[];
} {
  const result = SavingsPlanExtractionSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data, errors: [] };
  }
  return {
    success: false,
    errors: result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`
    ),
  };
}
