// @ts-nocheck
// Legacy advisory layer. Formal savings exports use src/savings/* normalized models.
/**
 * InterpretationEngine — AI 计划书解读引擎
 * 对提取的 JSON 数据进行深度分析，生成销售洞察和修改建议
 */

import type { SavingsPlanExtraction } from "../schemas/savings-plan.ts";
import type { CiPlanExtraction } from "../schemas/critical-illness.ts";
import type { IulExtraction } from "../schemas/iul.ts";

export type PlanData = SavingsPlanExtraction | CiPlanExtraction | IulExtraction;

export interface Key数字 {
  year: number;
  label: string;
  value: number;
  description: string;
  type: "回本" | "翻倍" | "IRR" | "杠杆" | "保障";
}

export interface 销售洞察 {
  targetCustomer: string;          // 目标客户画像
  keySellingPoints: string[];      // 核心卖点
  uniqueAdvantages: string;        // 独特优势
  suggestedNarrative: string;      // 建议叙事方向
  highlightNumbers: Key数字[];     // 强调的关键数字
  comparisonPoints: string[];      // 对比维度
}

export interface PPT修改建议 {
  slideTitle: string;              // 建议的幻灯片标题
  contentFocus: string;           // 内容重点
  chartType: "折线图" | "柱状图" | "饼图" | "区域图" | "表格" | "KPI卡片";
  emphasisPoints: string[];        // 需要强调的要点
  visualStyle: "数据驱动" | "叙事驱动" | "对比驱动";
  narrativeText: string;           // 建议的叙事文案
}

export interface 计划书解读 {
  pdfName: string;
  planType: "savings" | "ci" | "iul";
  productName: string;
  insured: { name: string; age: number; gender: string };
  policy: Record<string, unknown>;
  salesInsights: 销售洞察;
  modificationSuggestions: PPT修改建议[];
  rawData: PlanData;
}

export interface 对比解读 {
  products: { name: string; planType: string }[];
  comparisonMetrics: {
    metric: string;
    values: { value: string; label: string }[];
    winner: number;  // index of winning product
  }[];
  recommendation: string;
}

export class InterpretationEngine {
  /**
   * 对单份计划书进行深度解读
   */
  static interpret(
    pdfName: string,
    planType: "savings" | "ci" | "iul",
    data: PlanData
  ): 计划书解读 {
    if (planType === "savings") {
      return this.interpretSavings(pdfName, data as SavingsPlanExtraction);
    } else if (planType === "ci") {
      return this.interpretCI(pdfName, data as CiPlanExtraction);
    } else {
      return this.interpretIUL(pdfName, data as IulExtraction);
    }
  }

  /**
   * 对多份计划书进行对比解读
   */
  static compare(
    interpretations: 计划书解读[]
  ): 对比解读 {
    const comparisonMetrics: 对比解读["comparisonMetrics"] = [];

    // 回本速度对比
    const breakevenYears = interpretations.map((i) => {
      if (i.planType === "savings") {
        return this.findBreakevenYear(i.rawData as SavingsPlanExtraction);
      } else if (i.planType === "ci") {
        return this.findCIBreakevenYear(i.rawData as CiPlanExtraction);
      } else {
        return this.findIULBreakevenYear(i.rawData as IulExtraction);
      }
    });

    comparisonMetrics.push({
      metric: "回本年份",
      values: breakevenYears.map((y, i) => ({
        value: y ? `第${y}年` : "未回本",
        label: interpretations[i].productName,
      })),
      winner: breakevenYears.findIndex((y) => y !== null && y === Math.min(...breakevenYears.filter(Boolean) as number[])),
    });

    // 长期回报对比
    const longTermMultiples = interpretations.map((i) => {
      if (i.planType === "savings") {
        return this.findLongTermMultiple(i.rawData as SavingsPlanExtraction, 20);
      } else if (i.planType === "ci") {
        return this.findCILongTermValue(i.rawData as CiPlanExtraction, 20);
      } else {
        return this.findIULLongTermValue(i.rawData as IulExtraction, 20);
      }
    });

    comparisonMetrics.push({
      metric: "20年回报倍数",
      values: longTermMultiples.map((m, i) => ({
        value: m ? `${m.toFixed(1)}x` : "N/A",
        label: interpretations[i].productName,
      })),
      winner: longTermMultiples.findIndex((m) => m === Math.max(...longTermMultiples.filter(Boolean) as number[])),
    });

    // 保障杠杆对比
    const leverageRatios = interpretations.map((i) => {
      if (i.planType === "ci" || i.planType === "iul") {
        const pol = i.policy;
        const premium = (pol.annual_premium as number) || (pol.initial_premium as number) || 0;
        const sumInsured = (pol.sum_insured as number) || 0;
        return premium > 0 ? sumInsured / premium : 0;
      }
      return 0;
    });

    const validLeverage = leverageRatios.filter((r) => r > 0);
    if (validLeverage.length > 0) {
      comparisonMetrics.push({
        metric: "保障杠杆 (保额/年缴保费)",
        values: leverageRatios.map((r, i) => ({
          value: r > 0 ? `${r.toFixed(1)}x` : "N/A",
          label: interpretations[i].productName,
        })),
        winner: leverageRatios.findIndex((r) => r === Math.max(...validLeverage)),
      });
    }

    return {
      products: interpretations.map((i) => ({
        name: i.productName,
        planType: i.planType,
      })),
      comparisonMetrics,
      recommendation: this.generateRecommendation(interpretations, comparisonMetrics),
    };
  }

  // ─── 储蓄险解读 ────────────────────────────────

  private static interpretSavings(pdfName: string, data: SavingsPlanExtraction): 计划书解读 {
    const policy = data.policy;
    const benefitIllustration = data.benefit_illustration || [];
    const years = benefitIllustration;

    // 找关键数字
    const totalPremiums = years.map((r) => r.total_premium_paid);
    const totalPaid = Math.max(...totalPremiums);

    // 回本年份
    const breakevenYear = this.findBreakevenYear(data);

    // 翻倍年份
    const doubleYear = years.find((r) => r.total_surrender_value >= 2 * totalPaid)?.policy_year || null;

    // 高亮数字（关键里程碑）
    const highlightNumbers: Key数字[] = [];

    if (breakevenYear) {
      const row = years.find((r) => r.policy_year === breakevenYear)!;
      highlightNumbers.push({
        year: breakevenYear,
        label: "回本",
        value: row.total_surrender_value,
        description: `已缴保费 ${this.fmt(row.total_premium_paid)}，账户价值 ${this.fmt(row.total_surrender_value)}，成功回本`,
        type: "回本",
      });
    }

    // 10/20/30年数据
    for (const y of [10, 20, 30]) {
      const row = years.find((r) => r.policy_year === y);
      if (row && row.total_surrender_value > 0) {
        const multiple = (row.total_surrender_value / totalPaid).toFixed(1);
        highlightNumbers.push({
          year: y,
          label: `${multiple}x`,
          value: row.total_surrender_value,
          description: `第${y}年账户价值 ${this.fmt(row.total_surrender_value)}，是已缴保费的 ${multiple} 倍`,
          type: y === 20 ? "翻倍" : y === 30 ? "IRR" : "回本",
        });
      }
    }

    // 销售洞察
    const annualPremium = (policy.annual_premium as number) || 0;
    const suggestedNarrative = this.generateSavingsNarrative(policy.premium_payment_period as string, annualPremium, breakevenYear, doubleYear);

    // 目标客户判断
    const targetCustomer = this.identifySavingsTargetCustomer(data);

    // 修改建议
    const modificationSuggestions = this.generateSavingsModifications(data, highlightNumbers);

    return {
      pdfName,
      planType: "savings",
      productName: (policy.product_name as string) || "未知产品",
      insured: data.insured || { name: "未知", age: 0, gender: "未知" },
      policy: policy as unknown as Record<string, unknown>,
      salesInsights: {
        targetCustomer,
        keySellingPoints: this.extractSavingsKeyPoints(data),
        uniqueAdvantages: this.extractSavingsUniqueAdvantages(data),
        suggestedNarrative,
        highlightNumbers,
        comparisonPoints: ["回本速度", "长期回报倍数", "IRR", "保证vs非保证比例"],
      },
      modificationSuggestions,
      rawData: data,
    };
  }

  private static findBreakevenYear(data: SavingsPlanExtraction): number | null {
    const years = data.benefit_illustration || [];
    for (const r of years) {
      if (r.total_surrender_value >= r.total_premium_paid) {
        return r.policy_year;
      }
    }
    return null;
  }

  private static findLongTermMultiple(data: SavingsPlanExtraction, year: number): number | null {
    const years = data.benefit_illustration || [];
    const row = years.find((r) => r.policy_year === year);
    if (!row) return null;
    const totalPaid = years[years.length - 1]?.total_premium_paid || 1;
    return row.total_surrender_value / totalPaid;
  }

  private static generateSavingsNarrative(
    paymentPeriod: string,
    annualPremium: number,
    breakevenYear: number | null,
    doubleYear: number | null
  ): string {
    const paymentLabel = paymentPeriod?.replace("年", "") || "未知";
    const totalPayment = annualPremium * parseInt(paymentLabel);

    let narrative = `${paymentLabel}年缴，每年 ${this.fmt(annualPremium)}，总投入 ${this.fmt(totalPayment)}。`;

    if (breakevenYear) {
      narrative += `第${breakevenYear}年回本，`;
    }
    if (doubleYear) {
      narrative += `第${doubleYear}年翻${(2).toFixed(1)}倍`;
    }

    return narrative;
  }

  private static identifySavingsTargetCustomer(data: SavingsPlanExtraction): string {
    const policy = data.policy;
    const annualPremium = (policy.annual_premium as number) || 0;
    const paymentPeriod = (policy.premium_payment_period as string) || "";

    const totalPayment = annualPremium * parseInt(paymentPeriod.replace("年", "") || "0");

    if (totalPayment >= 500000) {
      return "高净值人士 · 财富传承 · 退休规划";
    } else if (totalPayment >= 100000) {
      return "中产家庭 · 教育基金 · 退休储备";
    } else {
      return "年轻家庭 · 储蓄起步 · 风险保障";
    }
  }

  private static extractSavingsKeyPoints(data: SavingsPlanExtraction): string[] {
    const points: string[] = [];
    const pol = data.policy;

    if (pol.premium_payment_period) {
      points.push(`${pol.premium_payment_period}缴款，灵活规划`);
    }
    if (data.withdrawal_illustration && data.withdrawal_illustration.length > 0) {
      points.push("支持灵活提取，满足养老/教育需求");
    }
    points.push("复归红利+终期分红，双重增值");

    return points;
  }

  private static extractSavingsUniqueAdvantages(data: SavingsPlanExtraction): string {
    const years = data.benefit_illustration || [];
    const earlyYear = years.find((r) => r.policy_year === 5);
    if (earlyYear && earlyYear.total_surrender_value > 2 * earlyYear.total_premium_paid) {
      return "中期流动性好，第5年退保已超已缴保费2倍";
    }
    return "长期复利增值，保证+非保证双重回报";
  }

  private static generateSavingsModifications(
    data: SavingsPlanExtraction,
    highlightNumbers: Key数字[]
  ): PPT修改建议[] {
    const suggestions: PPT修改建议[] = [];

    // 封面建议
    const breakeven = highlightNumbers.find((h) => h.type === "回本");
    suggestions.push({
      slideTitle: "封面",
      contentFocus: "客户姓名 + 产品名称 + 核心卖点数字",
      chartType: "KPI卡片",
      emphasisPoints: breakeven ? [`回本年份: 第${breakeven.year}年`] : [],
      visualStyle: "叙事驱动",
      narrativeText: breakeven
        ? `这份 ${data.policy.product_name} 让您的 ${this.fmt(data.policy.annual_premium as number)} 年缴转化为 ${this.fmt(breakeven.value)} 的账户价值`
        : `专业财富规划方案，为您的家庭构建稳健的财务未来`,
    });

    // 账户增长分析页
    const y20 = highlightNumbers.find((h) => h.year === 20);
    if (y20) {
      suggestions.push({
        slideTitle: "账户价值增长分析",
        contentFocus: "第10/20/30年的账户价值曲线",
        chartType: "折线图",
        emphasisPoints: ["回本时间点", "翻倍时间点", "长期增长趋势"],
        visualStyle: "数据驱动",
        narrativeText: `到第20年，您的 ${this.fmt(data.policy.annual_premium as number)} 年缴已经变成了 ${this.fmt(y20.value)}，是原始投入的 ${y20.label}`,
      });
    }

    // 对比页（如果有提取方案）
    if (data.withdrawal_illustration && data.withdrawal_illustration.length > 0) {
      suggestions.push({
        slideTitle: "提取方案对比",
        contentFocus: "不提取 vs 提取后的账户价值对比",
        chartType: "区域图",
        emphasisPoints: ["提取金额", "提取后剩余", "累计提取总额"],
        visualStyle: "对比驱动",
        narrativeText: "根据您的需求，可以选择在特定年份开始提取资金，比如教育金或退休金，同时保持账户持续增长",
      });
    }

    return suggestions;
  }

  // ─── 重疾险解读 ────────────────────────────────

  private static interpretCI(pdfName: string, data: CiPlanExtraction): 计划书解读 {
    const policy = data.policy;
    const benefitIllustration = data.benefit_illustration || [];
    const coverageItems = data.coverage_items || [];

    // 找关键数字
    const annualPremium = (policy.annual_premium as number) || 0;
    const sumInsured = (policy.sum_insured as number) || 0;

    // 回本年份（退保价值 > 0）
    const breakevenYear = this.findCIBreakevenYear(data);

    // 保障还原年份
    const multiClaim = data.multi_claim || [];

    // 高亮数字
    const highlightNumbers: Key数字[] = [];

    if (breakevenYear) {
      const row = benefitIllustration.find((r) => r.policy_year === breakevenYear);
      if (row) {
        highlightNumbers.push({
          year: breakevenYear,
          label: "开始有现金价值",
          value: row.surrender_value_total || 0,
          description: `缴满${breakevenYear}年后开始积累现金价值 ${this.fmt(row.surrender_value_total || 0)}`,
          type: "回本",
        });
      }
    }

    // 20年数据
    const row20 = benefitIllustration.find((r) => r.policy_year === 20);
    if (row20 && row20.surrender_value_total) {
      const totalPaid = annualPremium * 20;
      highlightNumbers.push({
        year: 20,
        label: "20年现金价值",
        value: row20.surrender_value_total,
        description: `连续缴费20年后，现金价值 ${this.fmt(row20.surrender_value_total)}，身故赔偿 ${this.fmt(row20.death_benefit_total || 0)}`,
        type: "保障",
      });
    }

    // 销售洞察
    const targetCustomer = this.identifyCITargetCustomer(data);
    const suggestedNarrative = this.generateCINarrative(policy, annualPremium, sumInsured, coverageItems);

    // 修改建议
    const modificationSuggestions = this.generateCIModifications(data, highlightNumbers, coverageItems);

    return {
      pdfName,
      planType: "ci",
      productName: (policy.product_name as string) || "未知产品",
      insured: data.insured || { name: "未知", age: 0, gender: "未知" },
      policy: policy as unknown as Record<string, unknown>,
      salesInsights: {
        targetCustomer,
        keySellingPoints: this.extractCIKeyPoints(data, coverageItems),
        uniqueAdvantages: this.extractCIUniqueAdvantages(data, multiClaim),
        suggestedNarrative,
        highlightNumbers,
        comparisonPoints: ["保障范围", "多次赔付", "保费性价比", "保障期限"],
      },
      modificationSuggestions,
      rawData: data,
    };
  }

  private static findCIBreakevenYear(data: CiPlanExtraction): number | null {
    const years = data.benefit_illustration || [];
    for (const r of years) {
      if ((r.surrender_value_total || 0) > 0) {
        return r.policy_year;
      }
    }
    return null;
  }

  private static findCILongTermValue(data: CiPlanExtraction, year: number): number | null {
    const years = data.benefit_illustration || [];
    const row = years.find((r) => r.policy_year === year);
    return row?.surrender_value_total || null;
  }

  private static generateCINarrative(
    policy: Record<string, unknown>,
    annualPremium: number,
    sumInsured: number,
    coverageItems: Array<{ name: string; amount?: number }>
  ): string {
    const dailyCost = (annualPremium / 365).toFixed(1);

    let narrative = `每天只需 $${dailyCost}，换 ${this.fmt(sumInsured)} 的全面保障。`;

    if (coverageItems.length > 0) {
      const cancerItem = coverageItems.find((c) => c.name.toLowerCase().includes("癌") || c.name.includes("cancer"));
      if (cancerItem) {
        narrative += " 癌症保障全面覆盖。";
      }
    }

    return narrative;
  }

  private static identifyCITargetCustomer(data: CiPlanExtraction): string {
    const age = data.insured?.age || 0;

    if (age <= 35) {
      return "年轻家庭 · 健康保障起步 · 经济实惠";
    } else if (age <= 50) {
      return "中青年 · 家庭支柱 · 高杠杆保障";
    } else {
      return "资深人士 · 健康风险 · 多次赔付保障";
    }
  }

  private static extractCIKeyPoints(data: CiPlanExtraction, coverageItems: Array<{ name: string; amount?: number }>): string[] {
    const points: string[] = [];
    const policy = data.policy;

    points.push(`年缴 ${this.fmt(policy.annual_premium as number)}，保障 ${policy.coverage_period || "终身"}`);

    if (coverageItems.some((c) => c.name.includes("癌") || c.name.includes("cancer"))) {
      points.push("癌症多次赔付，保障不中断");
    }

    const multiClaim = data.multi_claim || [];
    if (multiClaim.length > 0) {
      points.push(`可赔付 ${multiClaim.length} 种危疾情况`);
    }

    return points;
  }

  private static extractCIUniqueAdvantages(data: CiPlanExtraction, multiClaim: Array<{ condition: string; claim_count: number }>): string {
    if (multiClaim.length > 0) {
      return `多次赔付设计，癌症/中风/心脏病各可赔付多次，保障不断升级`;
    }
    return `保障范围广，覆盖多种危疾，情况一次性赔付`;
  }

  private static generateCIModifications(
    data: CiPlanExtraction,
    highlightNumbers: Key数字[],
    coverageItems: Array<{ name: string; amount?: number }>
  ): PPT修改建议[] {
    const suggestions: PPT修改建议[] = [];

    // 封面建议
    const annualPremium = (data.policy.annual_premium as number) || 0;
    const dailyCost = (annualPremium / 365).toFixed(1);

    suggestions.push({
      slideTitle: "封面",
      contentFocus: "客户姓名 + 每天成本 + 保障额度",
      chartType: "KPI卡片",
      emphasisPoints: [`每天 $${dailyCost}`, `总保障 ${this.fmt(data.policy.sum_insured as number)}`],
      visualStyle: "叙事驱动",
      narrativeText: `每天只需 $${dailyCost}，即可获得 ${this.fmt(data.policy.sum_insured as number)} 的全面危疾保障，为您和家人的健康构建坚实防线`,
    });

    // 保障范围页
    if (coverageItems.length > 0) {
      suggestions.push({
        slideTitle: "危疾保障范围",
        contentFocus: "各类危疾保障项目和赔付金额",
        chartType: "表格",
        emphasisPoints: coverageItems.slice(0, 5).map((c) => c.name),
        visualStyle: "数据驱动",
        narrativeText: "全面覆盖常见危疾，包括癌症、心脏病、中风等，每项都有明确的赔付额度",
      });
    }

    // 多次赔付页
    const multiClaim = data.multi_claim || [];
    if (multiClaim.length > 0) {
      suggestions.push({
        slideTitle: "多次赔付保障",
        contentFocus: "多次赔付条件和总保障额度",
        chartType: "柱状图",
        emphasisPoints: multiClaim.map((m) => `${m.condition} (${m.claim_count}次)`),
        visualStyle: "对比驱动",
        narrativeText: `危疾不等于保障终点，这款计划支持 ${multiClaim.length} 种情况的多次赔付，让您的保障与时俱进`,
      });
    }

    return suggestions;
  }

  // ─── IUL 解读 ────────────────────────────────

  private static interpretIUL(pdfName: string, data: IulExtraction): 计划书解读 {
    const policy = data.policy;
    const yearlyData = data.yearly_data || [];

    const annualPremium = (policy.initial_premium as number) || (policy.annual_premium as number) || 0;
    const sumInsured = (policy.sum_insured as number) || 0;

    // 高亮数字
    const highlightNumbers: Key数字[] = [];

    // 20年价值
    const row20 = yearlyData.find((r) => r.year === 20);
    if (row20) {
      highlightNumbers.push({
        year: 20,
        label: "20年账户价值",
        value: row20.cash_value_non_guaranteed || row20.cash_value_guaranteed || 0,
        description: `第20年账户价值 ${this.fmt(row20.cash_value_non_guaranteed || row20.cash_value_guaranteed || 0)}，身故保障 ${this.fmt(sumInsured)}`,
        type: "IRR",
      });
    }

    // 保证 vs 非保证对比
    const row5 = yearlyData.find((r) => r.year === 5);
    if (row5) {
      highlightNumbers.push({
        year: 5,
        label: "5年账户价值",
        value: row5.cash_value_non_guaranteed || 0,
        description: `保证 ${this.fmt(row5.cash_value_guaranteed || 0)} vs 非保证 ${this.fmt(row5.cash_value_non_guaranteed || 0)}`,
        type: "杠杆",
      });
    }

    // 销售洞察
    const targetCustomer = this.identifyIULTargetCustomer(data);
    const suggestedNarrative = this.generateIULNarrative(policy, annualPremium, sumInsured);

    // 修改建议
    const modificationSuggestions = this.generateIULModifications(data, highlightNumbers);

    return {
      pdfName,
      planType: "iul",
      productName: (policy.product_name as string) || "未知产品",
      insured: data.insured || { name: "未知", age: 0, gender: "未知" },
      policy: policy as unknown as Record<string, unknown>,
      salesInsights: {
        targetCustomer,
        keySellingPoints: this.extractIULKeyPoints(data),
        uniqueAdvantages: this.extractIULUniqueAdvantages(data),
        suggestedNarrative,
        highlightNumbers,
        comparisonPoints: ["保证 vs 非保证比例", "指数账户增长率", "身故保障杠杆", "灵活性"],
      },
      modificationSuggestions,
      rawData: data,
    };
  }

  private static findIULBreakevenYear(data: IulExtraction): number | null {
    const yearlyData = data.yearly_data || [];
    for (const r of yearlyData) {
      const g = r.cash_value_guaranteed || 0;
      const ng = r.cash_value_non_guaranteed || 0;
      const total = g + ng;
      if (total >= (data.policy.initial_premium as number || data.policy.annual_premium as number || 0) * (data.policy.premium_payment_years as number || 5)) {
        return r.year;
      }
    }
    return null;
  }

  private static findIULLongTermValue(data: IulExtraction, year: number): number | null {
    const yearlyData = data.yearly_data || [];
    const row = yearlyData.find((r) => r.year === year);
    return row?.cash_value_non_guaranteed || null;
  }

  private static generateIULNarrative(
    policy: Record<string, unknown>,
    annualPremium: number,
    sumInsured: number
  ): string {
    const paymentYears = (policy.premium_payment_years as number) || 5;
    const leverage = sumInsured / (annualPremium * paymentYears);

    return `年缴 ${this.fmt(annualPremium)}，${paymentYears}年供款，获得 ${this.fmt(sumInsured)} 身故保障，杠杆比例 ${leverage.toFixed(1)}x。参与美国经济增长，分享 S&P 500 历史平均回报。`;
  }

  private static identifyIULTargetCustomer(data: IulExtraction): string {
    const sumInsured = (data.policy.sum_insured as number) || 0;

    if (sumInsured >= 1000000) {
      return "高净值人士 · 资产传承 · 税务规划";
    } else if (sumInsured >= 500000) {
      return "企业主 · 风险保障 · 投资结合";
    } else {
      return "中产家庭 · 长期投资 · 家庭保护";
    }
  }

  private static extractIULKeyPoints(data: IulExtraction): string[] {
    const points: string[] = [];
    const policy = data.policy;

    if (policy.index_account_rate) {
      points.push(`指数账户假设利率 ${policy.index_account_rate}%（S&P 500）`);
    }
    if (policy.fixed_account_rate) {
      points.push(`固定账户保证利率 ${policy.fixed_account_rate}%`);
    }
    if (policy.sum_insured) {
      points.push(`${this.fmt(policy.sum_insured as number)} 高额身故保障`);
    }

    return points;
  }

  private static extractIULUniqueAdvantages(data: IulExtraction): string {
    const policy = data.policy;
    const indexRate = (policy.index_account_rate as number) || 0;

    if (indexRate >= 7) {
      return "高增长潜力账户，参与美国经济增长，保底0%不亏损本金";
    }
    return "指数+固定双账户，攻守兼备，灵活配置";
  }

  private static generateIULModifications(
    data: IulExtraction,
    highlightNumbers: Key数字[]
  ): PPT修改建议[] {
    const suggestions: PPT修改建议[] = [];

    // 封面建议
    suggestions.push({
      slideTitle: "封面",
      contentFocus: "客户姓名 + 身故保障 + 投资增长叙事",
      chartType: "KPI卡片",
      emphasisPoints: [`身故保障 ${this.fmt(data.policy.sum_insured as number)}`],
      visualStyle: "叙事驱动",
      narrativeText: `这份 IUL 计划不仅为您提供 ${this.fmt(data.policy.sum_insured as number)} 的高额身故保障，还让您的资金参与美国经济增长，实现保障与投资的双重目标`,
    });

    // 保证 vs 非保证对比页
    suggestions.push({
      slideTitle: "保证 vs 非保证账户价值",
      contentFocus: "不同年份的保证价值和非保证价值对比",
      chartType: "区域图",
      emphasisPoints: ["保证现金价值", "非保证账户价值", "两者差距"],
      visualStyle: "对比驱动",
      narrativeText: "非保证部分让您参与市场增长，保证部分确保本金安全。这种设计让您在任何市场环境下都安心",
    });

    // 长期增长页
    const y20 = highlightNumbers.find((h) => h.year === 20);
    if (y20) {
      suggestions.push({
        slideTitle: "长期账户增长预测",
        contentFocus: "20年+的账户价值增长曲线",
        chartType: "折线图",
        emphasisPoints: ["账户价值增长", "身故保障维持", "总回报倍数"],
        visualStyle: "数据驱动",
        narrativeText: `历史数据显示，S&P 500 长期年化回报约 10%。到第20年，您的账户预计达到 ${this.fmt(y20.value)}，同时维持 ${this.fmt(data.policy.sum_insured as number)} 的身故保障`,
      });
    }

    return suggestions;
  }

  // ─── 对比解读辅助 ────────────────────────────────

  private static generateRecommendation(
    interpretations: 计划书解读[],
    comparisonMetrics: 对比解读["comparisonMetrics"]
  ): string {
    if (interpretations.length === 1) {
      const i = interpretations[0];
      return `建议重点突出 ${i.salesInsights.suggestedNarrative}，在 PPT 中使用 ${i.modificationSuggestions[0]?.chartType || "折线图"} 展示数据`;
    }

    // 多产品对比
    const savingsPlan = interpretations.find((i) => i.planType === "savings");
    const ciPlan = interpretations.find((i) => i.planType === "ci");
    const iulPlan = interpretations.find((i) => i.planType === "iul");

    const parts: string[] = [];

    if (savingsPlan && ciPlan) {
      parts.push("储蓄+重疾组合：先用重疾保障健康风险，再用储蓄实现财富增值");
    }
    if (iulPlan && ciPlan) {
      parts.push("IUL+重疾组合：IUL 提供高杠杆传承，重疾提供健康保障");
    }
    if (savingsPlan && iulPlan) {
      parts.push("储蓄+IUL组合：保守与进取兼顾，短期流动性与长期增长兼备");
    }

    return parts.length > 0 ? parts.join("；") + "。建议在 PPT 中使用三层架构展示（风险防护→财富累积→传承规划）" : "建议在 PPT 中分别展示各产品的独特优势";
  }

  // ─── 工具方法 ────────────────────────────────

  private static fmt(n: number): string {
    if (n >= 1_000_000) {
      return `$${(n / 1_000_000).toFixed(2)}M`;
    }
    if (n >= 1_000) {
      return `$${(n / 1_000).toFixed(0)}K`;
    }
    return `$${n.toFixed(0)}`;
  }
}
