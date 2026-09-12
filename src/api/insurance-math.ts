/**
 * 保险产品通用数学工具
 *
 * 关键: 杠杆倍数 = 保额 / 总缴保费 (annual × pay_years)
 *       不是 保额 / 年缴保费 — 后者会把 25 年缴的产品杠杆放大 25 倍
 */

/**
 * 从 premium_payment_period 字符串提取缴费年数
 * "5年" → 5, "10年" → 10, "趸交" → 1, "" → 0
 */
export function parsePayYears(period: string | number | null | undefined): number {
  if (period == null) return 0;
  if (typeof period === "number") return Math.max(period, 0);
  const s = String(period).trim();
  if (!s) return 0;
  if (/趸交/.test(s)) return 1;
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * 计算总缴保费 = 年缴 × 缴费年数
 * 优先用 annual_premium, fallback initial_premium (老 schema 字段)
 */
export function totalPremiumPaid(
  policy: { annual_premium?: unknown; initial_premium?: unknown; premium_payment_period?: unknown }
): number {
  const annual = Number((policy.annual_premium as number) ?? (policy.initial_premium as number) ?? 0);
  if (!Number.isFinite(annual) || annual <= 0) return 0;
  const years = parsePayYears(policy.premium_payment_period as string);
  if (years <= 0) return annual; // 没缴费年期 → 当趸交处理
  return annual * years;
}

/**
 * 保障杠杆倍数 = 保额 / 总缴保费
 * 返回字符串 (含 x), totalPremium=0 时返回 "—"
 */
export function leverageRatio(
  sumInsured: number,
  policy: { annual_premium?: unknown; initial_premium?: unknown; premium_payment_period?: unknown }
): string {
  const total = totalPremiumPaid(policy);
  if (total <= 0 || !Number.isFinite(sumInsured) || sumInsured <= 0) return "—";
  return (sumInsured / total).toFixed(1) + "x";
}