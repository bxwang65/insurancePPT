import { z } from "zod";
import { InsuredPersonSchema } from "./common.ts";
import { SalesInsightsSchema } from "./savings-plan.ts";

/** 指数账户信息 */
export const IndexAccountSchema = z.object({
  name: z.string().describe("指数账户名称（如标普500、环球指数等）"),
  allocation: z.union([z.number(), z.string()]).transform(v => typeof v === 'string' ? parseFloat(v) || 0 : v).describe("配置比例（百分比）"),
  current_assumed_rate: z.string().nullable().optional().describe("当前假设利率"),
  guaranteed_floor_rate: z.string().nullable().optional().describe("保证最低下限利率"),
  cap_rate: z.string().nullable().optional().describe("上限率"),
  participation_rate: z.string().nullable().optional().describe("参与率"),
  multiplier: z.string().nullable().optional().describe("倍数系数"),
});

export type IndexAccount = z.infer<typeof IndexAccountSchema>;

/** 兼容 AI 输出的字符串数字（如 "66,355"） */
const numCoerce = (v: unknown) => {
  if (typeof v === "string") {
    const cleaned = parseFloat(v.replace(/,/g, ""));
    return Number.isNaN(cleaned) ? null : cleaned;
  }
  return v;
};

/** 每年 IUL 利益演示 */
export const IulYearlyRowSchema = z.object({
  policy_year: z.preprocess(numCoerce, z.number().int().positive()).describe("保单年度"),
  age: z.preprocess(numCoerce, z.number()).optional().describe("年龄"),
  total_premium_paid: z.preprocess(numCoerce, z.number()).describe("累计已缴保费"),
  /** AI 输出字段（非保证/当前假设） */
  account_value: z.preprocess(numCoerce, z.number().nullable()).optional().describe("账户价值（AI输出）"),
  cash_value: z.preprocess(numCoerce, z.number().nullable()).optional().describe("退保现金价值（AI输出）"),
  death_benefit: z.preprocess(numCoerce, z.number().nullable()).optional().describe("身故赔偿（AI输出）"),
  cost_of_insurance: z.any().nullable().optional(),
  /** 保证基础 */
  guaranteed_account_value: z.preprocess(numCoerce, z.number().nullable().default(0)).describe("保证基础-账户价值"),
  guaranteed_cash_value: z.preprocess(numCoerce, z.number().nullable().default(0)).describe("保证基础-现金价值（退保价值）"),
  guaranteed_death_benefit: z.preprocess(numCoerce, z.number().nullable()).optional().describe("保证基础-身故赔偿"),
  /** 非保证基础（当前假设） */
  non_guaranteed_account_value: z.preprocess(numCoerce, z.number().nullable().default(0)).describe("非保证基础-账户价值"),
  non_guaranteed_cash_value: z.preprocess(numCoerce, z.number().nullable().default(0)).describe("非保证基础-现金价值（退保价值）"),
  non_guaranteed_death_benefit: z.preprocess(numCoerce, z.number().nullable()).optional().describe("非保证基础-身故赔偿"),
  source_page: z.preprocess(numCoerce, z.number().int().positive()).optional().describe("来源页码"),
}).passthrough().transform((row) => ({
  ...row,
  non_guaranteed_account_value: row.non_guaranteed_account_value ?? row.account_value ?? 0,
  non_guaranteed_cash_value: row.non_guaranteed_cash_value ?? row.cash_value ?? 0,
  non_guaranteed_death_benefit: row.non_guaranteed_death_benefit ?? row.death_benefit ?? undefined,
}));

export type IulYearlyRow = z.infer<typeof IulYearlyRowSchema>;

/** IUL 完整提取结果 */
export const IulExtractionSchema = z.object({
  product_name: z.string().describe("产品名称"),
  product_type: z.string().optional().describe("产品类型"),
  insured: InsuredPersonSchema,
  policy: z.object({
    currency: z.string().describe("保单货币"),
    sum_insured: z.preprocess(numCoerce, z.number().nullable()).describe("投保金额/保障金额"),
    initial_premium: z.preprocess(numCoerce, z.number().nullable()).optional().describe("首年保费"),
    annual_premium: z.preprocess(numCoerce, z.number().nullable()).describe("年缴保费（如有固定）"),
    premium_payment_period: z.union([z.string(), z.number()]).transform(v => typeof v === 'number' ? `${v}年` : v).describe("保费缴付年期（如灵活保费/5年）"),
    coverage_period: z.string().describe("保障年期（如终身）"),
    payment_mode: z.string().optional().describe("付款模式（年缴/月缴等）"),
    risk_class: z.string().optional().describe("风险类别（标准/优选等）"),
    day_1_cash_value: z.preprocess(numCoerce, z.number().nullable()).optional().describe("首日现金价值"),
    total_premium_target: z.preprocess(numCoerce, z.number().nullable()).optional().describe("预设总保费"),
  }).describe("保单信息"),
  /** 指数账户配置 */
  index_accounts: z.array(IndexAccountSchema).optional().describe("指数账户配置"),
  /** 关键费率 */
  rates: z.object({
    fixed_account_current_rate: z.string().optional().describe("固定账户当前派息率"),
    long_term_bonus_rate: z.string().optional().describe("长期红利率"),
    guaranteed_floor: z.string().optional().describe("指数账户保证下限率"),
    coi_charges: z.string().optional().describe("保险成本(COI)说明"),
  }).optional().describe("关键费率"),
  /** 逐年利益演示 */
  benefit_illustration: z.array(IulYearlyRowSchema).optional().describe("逐年利益演示"),
  /** 销售洞察 */
  sales_insights: SalesInsightsSchema.optional(),
});

export type IulExtraction = z.infer<typeof IulExtractionSchema>;

export function validateIulExtraction(data: unknown) {
  const result = IulExtractionSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data, errors: [] };
  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}
