import { z } from "zod";

/** 受保人信息 */
export const InsuredPersonSchema = z.object({
  /** 受保人姓名 */
  name: z.string().describe("受保人姓名"),
  /** 年龄 */
  age: z.number().nullable().describe("年龄"),
  /** 性别 */
  gender: z.string().nullable().describe("性别"),
  /** 是否吸烟 */
  smoker: z.string().nullable().optional().default("").describe("是否吸烟"),
});

export type InsuredPerson = z.infer<typeof InsuredPersonSchema>;

/** 保单概要 */
export const PolicySummarySchema = z.object({
  /** 产品名称 */
  product_name: z.string().optional().default("").describe("产品名称"),
  /** 保单货币 */
  currency: z.string().describe("保单货币"),
  /** 投保时保额 */
  sum_insured: z.number().nullable().describe("投保时保额"),
  /** 投保时基本金额（储蓄计划特有） */
  basic_sum_insured: z.number().nullable().optional().describe("投保时基本金额"),
  /** 年缴保费 */
  annual_premium: z.number().describe("年缴保费"),
  /** 保费缴付年期 */
  premium_payment_period: z.string().describe("保费缴付年期"),
  /** 保障年期 */
  coverage_period: z.string().describe("保障年期"),
  /** 包含保费征费的总保费 */
  total_premium_with_levy: z.number().nullable().optional().describe("包含保费征费的总保费"),
});

export type PolicySummary = z.infer<typeof PolicySummarySchema>;

/** 每年利益演示数据行 */
export const YearlyBenefitRowSchema = z.object({
  /** 保单年度 */
  policy_year: z.number().int().positive().describe("保单年度"),
  /** 已缴总保费 */
  total_premium_paid: z.number().describe("已缴总保费"),
  /** 保证现金价值 */
  guaranteed_cash_value: z.number().default(0).describe("保证现金价值"),
  /** 复归红利（非保证） */
  reversionary_bonus: z.number().default(0).describe("复归红利非保证"),
  /** 终期分红（非保证） */
  terminal_dividend: z.number().default(0).describe("终期分红非保证"),
  /** 退保发还总额 */
  total_surrender_value: z.number().nullable().describe("退保发还总额"),
  /** 身故赔偿额（如有） */
  death_benefit: z.number().nullable().optional().describe("身故赔偿额"),
  /** 原始计划书物理页码 */
  source_page: z.number().int().positive().optional().describe("来源页码"),
});

export type YearlyBenefitRow = z.infer<typeof YearlyBenefitRowSchema>;

/** 情景分析（乐观/悲观） */
export const ScenarioRowSchema = z.object({
  policy_year: z.number().int().positive().describe("保单年度"),
  guaranteed_cash_value: z.number().default(0).describe("保证现金价值"),
  pessimistic_total: z.number().nullable().optional().describe("悲观情景退保发还总额"),
  optimistic_total: z.number().nullable().optional().describe("乐观情景退保发还总额"),
});

export type ScenarioRow = z.infer<typeof ScenarioRowSchema>;

export const ScenarioAnalysisSchema = z.object({
  pessimistic: z.array(ScenarioRowSchema).optional().describe("悲观情景数据"),
  optimistic: z.array(ScenarioRowSchema).optional().describe("乐观情景数据"),
});

export type ScenarioAnalysis = z.infer<typeof ScenarioAnalysisSchema>;
