/**
 * Design Tokens — 集中所有视觉常量
 *
 * 所有模板/渲染器都从这里 import, 禁止在各 renderer 写死颜色或字体
 */

export const COLORS = {
  // 主品牌
  primary: "#0A1628",       // 深海蓝（modern 默认）
  primaryDark: "#0A1628",
  primaryLight: "#1E3A5F",
  // 强调色
  gold: "#C8963E",          // 金线（单屏 ≤2 处）
  goldLight: "#E5C988",
  goldDark: "#A07B30",
  // 数据
  dataBlue: "#4FC3F7",      // 保证部分
  dataOrange: "#C8963E",    // 非保证部分
  dataGreen: "#00D4AA",     // 总值 / KPI 高亮
  dataRed: "#A0413F",       // 警示
  // 中性
  bgDark: "#0A1628",
  bgLight: "#F8F5F0",
  bgCream: "#EFE4DF",       // 米色底
  textPrimary: "#FFFFFF",
  textSecondary: "#E0E0E0",
  textMuted: "#888888",
  textOnLight: "#332825",   // 深咖主文字
  // 边框
  border: "#D6CDC4",
  divider: "#1E3A5F",
} as const;

export const FONTS = {
  // 中文
  zhHei: "PingFang SC",
  zhHeiMac: "STHeiti Medium",
  zhHeiWin: "Microsoft YaHei",
  zhSong: "SimSun",
  // 英文
  enSans: "Avenir Next",
  enSansFallback: "Helvetica Neue",
  enSerif: "Georgia",
  // 等宽
  mono: "JetBrains Mono",
  monoFallback: "Menlo",
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  pageMargin: 32,
  cardGap: 16,
} as const;

export const TYPOGRAPHY = {
  hero: 48,
  title: 28,
  subtitle: 18,
  body: 14,
  caption: 11,
  data: 16,
  kpi: 36,
} as const;

export const RADII = {
  sm: 4,
  md: 8,
  lg: 16,
  pill: 999,
} as const;

export type ColorToken = keyof typeof COLORS;
export type FontToken = keyof typeof FONTS;
