// @ts-nocheck
// Legacy markdown templates pending configuration-driven replacement.
/**
 * MarkdownTemplateEngine — Markdown PPT 模板系统
 * 为三种产品类型提供默认 PPT Markdown 模板
 * 支持动态注入经纪人确认的修改建议
 */

import type { 计划书解读, PPT修改建议 } from "./interpretation-engine.ts";

export interface TemplateInput {
  interpretations: 计划书解读[];
  comparison?: {
    products: { name: string; planType: string }[];
    comparisonMetrics: {
      metric: string;
      values: { value: string; label: string }[];
      winner: number;
    }[];
    recommendation: string;
  };
  modifications?: Map<string, PPT修改建议[]>;  // pdfName -> modifications
  customerName?: string;
  companyInfo?: string;
}

export interface SlideDefinition {
  pageNumber: number;
  title: string;
  content: string;
  chartType: "折线图" | "柱状图" | "饼图" | "区域图" | "表格" | "KPI卡片" | "纯文本";
  visualNotes?: string;
  narrative?: string;
}

export class MarkdownTemplateEngine {
  /**
   * 根据输入生成完整的 PPT Markdown 大纲
   */
  static generateMarkdown(input: TemplateInput): string {
    const { interpretations, comparison, modifications, customerName } = input;

    const types = new Set(interpretations.map((i) => i.planType));
    const slides: SlideDefinition[] = [];

    let pageNum = 1;

    // 1. 封面
    slides.push(...this.buildCoverSlides(interpretations, customerName, pageNum));
    pageNum += 1;

    // 2. 公司介绍（如有）
    if (input.companyInfo) {
      slides.push(this.buildCompanyIntroSlide(input.companyInfo, pageNum++));
    }

    // 3. 客户需求分析
    slides.push(this.buildCustomerNeedsSlide(interpretations, pageNum++));

    // 4. 方案概览（根据产品类型）
    slides.push(this.buildOverviewSlide(interpretations, pageNum++));

    // 5. 各产品详解页
    for (const interp of interpretations) {
      const mods = modifications?.get(interp.pdfName) || interp.modificationSuggestions;
      slides.push(...this.buildProductSlides(interp, mods, pageNum));
      pageNum += 2;
    }

    // 6. 对比分析页（多产品时）
    if (comparison && comparison.products.length > 1) {
      slides.push(...this.buildComparisonSlides(comparison, pageNum));
      pageNum += 2;
    }

    // 7. 综合建议页
    slides.push(this.buildRecommendationSlide(interpretations, comparison, pageNum++));

    // 8. 感谢页
    slides.push(this.buildClosingSlide(pageNum));

    return this.renderMarkdown(slides, interpretations);
  }

  // ─── 封面幻灯片 ────────────────────────────────

  private static buildCoverSlides(
    interpretations: 计划书解读[],
    customerName: string | undefined,
    pageNum: number
  ): SlideDefinition[] {
    const name = customerName || "尊貴客戶";
    const primary = interpretations[0];
    const productNames = interpretations.map((i) => i.productName).join(" + ");

    // 提取关键数字用于封面 KPI
    const kpiCards: string[] = [];
    for (const interp of interpretations) {
      if (interp.planType === "savings") {
        const breakeven = interp.salesInsights.highlightNumbers.find((h) => h.type === "回本");
        if (breakeven) {
          kpiCards.push(`回本: 第${breakeven.year}年`);
        }
        const y20 = interp.salesInsights.highlightNumbers.find((h) => h.year === 20);
        if (y20) {
          kpiCards.push(`20年: ${y20.label}`);
        }
      } else if (interp.planType === "ci") {
        const pol = interp.policy;
        kpiCards.push(`保障: $${((pol.annual_premium as number) || 0 / 365).toFixed(0)}/天`);
        kpiCards.push(`保额: $${((pol.sum_insured as number) || 0 / 1000).toFixed(0)}K`);
      } else if (interp.planType === "iul") {
        const pol = interp.policy;
        kpiCards.push(`身故保障: $${((pol.sum_insured as number) || 0 / 1000).toFixed(0)}K`);
        kpiCards.push(`杠杆: ${((pol.sum_insured as number) || 0) / ((pol.initial_premium as number) || 1) * 1}x`);
      }
    }

    return [
      {
        pageNumber: pageNum,
        title: name,
        content: `产品方案: ${productNames}

关键数字:
${kpiCards.map((k) => `• ${k}`).join("\n")}

生成日期: ${new Date().toLocaleDateString("zh-HK")}`,
        chartType: "KPI卡片",
        visualNotes: "全屏深色背景，顶部标题大字，下方3-4个KPI卡片横向排列，白色强调色",
        narrative: `为 ${name} 精心设计的 ${productNames} 方案，整合风险保障与财富增值需求`,
      },
    ];
  }

  // ─── 公司介绍幻灯片 ────────────────────────────────

  private static buildCompanyIntroSlide(companyInfo: string, pageNum: number): SlideDefinition {
    return {
      pageNumber: pageNum,
      title: "合作机构",
      content: companyInfo,
      chartType: "纯文本",
      visualNotes: "简洁白色背景，左侧公司Logo占位区，右侧公司介绍文字",
      narrative: "选择专业可靠的合作伙伴，为您的财务规划保驾护航",
    };
  }

  // ─── 客户需求分析幻灯片 ────────────────────────────────

  private static buildCustomerNeedsSlide(
    interpretations: 计划书解读[],
    pageNum: number
  ): SlideDefinition[] {
    const insights = interpretations.map((i) => i.salesInsights);

    // 汇总目标客户
    const targetCustomers = [...new Set(insights.map((s) => s.targetCustomer))];
    const sellingPoints = insights.flatMap((s) => s.keySellingPoints).slice(0, 5);
    const narratives = [...new Set(insights.map((s) => s.suggestedNarrative))];

    return [
      {
        pageNumber: pageNum,
        title: "需求分析",
        content: `目标客户画像
${targetCustomers.map((t) => `• ${t}`).join("\n")}

核心诉求
${sellingPoints.map((s) => `• ${s}`).join("\n")}

方案定位
${narratives.map((n) => `• ${n}`).join("\n")}`,
        chartType: "KPI卡片",
        visualNotes: "三栏布局，每栏一个主题（客户画像/核心诉求/方案定位），使用浅色卡片背景",
        narrative: "深入理解您的需求，为您定制最适合的保障与财富规划方案",
      },
    ];
  }

  // ─── 方案概览幻灯片 ────────────────────────────────

  private static buildOverviewSlide(
    interpretations: 计划书解读[],
    pageNum: number
  ): SlideDefinition[] {
    const layers: { type: string; icon: string; name: string; desc: string }[] = [];

    if (interpretations.some((i) => i.planType === "ci")) {
      layers.push({ type: "ci", icon: "🛡️", name: "风险防护层", desc: "危疾保障，抵御健康风险" });
    }
    if (interpretations.some((i) => i.planType === "savings")) {
      layers.push({ type: "savings", icon: "💰", name: "财富累积层", desc: "储蓄增值，长期复利增长" });
    }
    if (interpretations.some((i) => i.planType === "iul")) {
      layers.push({ type: "iul", icon: "📈", name: "传承规划层", desc: "高杠杆传承，指数增长" });
    }

    return [
      {
        pageNumber: pageNum,
        title: "方案架构",
        content: layers
          .map(
            (l) =>
              `${l.icon} ${l.name}\n${l.desc}\n产品: ${interpretations.find((i) => i.planType === l.type)?.productName || ""}`
          )
          .join("\n\n"),
        chartType: "纯文本",
        visualNotes: "三层金字塔或阶梯图，从下到上依次是风险防护→财富累积→传承规划，使用渐变色区分",
        narrative: "从健康保障到财富累积，再到资产传承 — 三层架构层层递进，完整覆盖您的人生规划需求",
      },
    ];
  }

  // ─── 各产品详解幻灯片 ────────────────────────────────

  private static buildProductSlides(
    interp: 计划书解读,
    modifications: PPT修改建议[],
    startPageNum: number
  ): SlideDefinition[] {
    const slides: SlideDefinition[] = [];
    const typeLabels = { savings: "储蓄险", ci: "重疾险", iul: "万用寿险" };

    // 产品介绍页
    slides.push({
      pageNumber: startPageNum,
      title: `${interp.productName} (${typeLabels[interp.planType]})`,
      content: `受保人: ${interp.insured.name} | ${interp.insured.age}岁 | ${interp.insured.gender}

产品特点:
${interp.salesInsights.keySellingPoints.map((s) => `• ${s}`).join("\n")}

独特优势:
${interp.salesInsights.uniqueAdvantages}`,
      chartType: "纯文本",
      visualNotes: "左侧产品图标/占位区，右侧产品特点列表，底部强调独特优势",
      narrative: interp.salesInsights.suggestedNarrative,
    });

    // 数据分析页（根据第一个修改建议）
    const firstMod = modifications[0];
    if (firstMod) {
      slides.push({
        pageNumber: startPageNum + 1,
        title: firstMod.slideTitle,
        content: `内容重点: ${firstMod.contentFocus}

强调要点:
${firstMod.emphasisPoints.map((p) => `• ${p}`).join("\n")}

叙事文案:
${firstMod.narrativeText}`,
        chartType: firstMod.chartType,
        visualNotes: `使用 ${firstMod.chartType === "折线图" ? "折线图展示长期增长趋势" : firstMod.chartType === "KPI卡片" ? "大字号KPI卡片突出核心数字" : firstMod.chartType} 可视化`,
        narrative: firstMod.narrativeText,
      });
    }

    // 如果有highlight数字，生成关键数字页
    if (interp.salesInsights.highlightNumbers.length > 0) {
      slides.push({
        pageNumber: startPageNum + 2,
        title: "关键数字",
        content: interp.salesInsights.highlightNumbers
          .map(
            (h) =>
              `${h.label} (第${h.year}年)\n价值: $${(h.value / 1000).toFixed(0)}K\n${h.description}`
          )
          .join("\n\n"),
        chartType: "KPI卡片",
        visualNotes: "4-6个数字卡片网格布局，每个卡片显示标签+数值+描述",
        narrative: "这些关键数字是评估这份计划书价值的重要指标",
      });
    }

    return slides;
  }

  // ─── 对比分析幻灯片 ────────────────────────────────

  private static buildComparisonSlides(
    comparison: {
      products: { name: string; planType: string }[];
      comparisonMetrics: {
        metric: string;
        values: { value: string; label: string }[];
        winner: number;
      }[];
      recommendation: string;
    },
    pageNum: number
  ): SlideDefinition[] {
    const slides: SlideDefinition[] = [];

    // 对比表格页
    const tableRows = comparison.comparisonMetrics
      .map(
        (m) =>
          `${m.metric}\n${m.values.map((v) => `${v.label}: ${v.value}`).join(" | ")}`
      )
      .join("\n\n");

    slides.push({
      pageNumber: pageNum,
      title: "产品对比分析",
      content: tableRows,
      chartType: "表格",
      visualNotes: "清晰的行列表格，对比维度横向排列，产品纵向排列，获胜项用强调色标注",
      narrative: "通过关键指标对比，更清晰地了解各产品的优势和适用场景",
    });

    // 建议页
    slides.push({
      pageNumber: pageNum + 1,
      title: "综合建议",
      content: comparison.recommendation,
      chartType: "纯文本",
      visualNotes: "大段落文字，居中显示，配合简单的图标或引言装饰",
      narrative: comparison.recommendation,
    });

    return slides;
  }

  // ─── 综合建议幻灯片 ────────────────────────────────

  private static buildRecommendationSlide(
    interpretations: 计划书解读[],
    comparison: { recommendation: string } | undefined,
    pageNum: number
  ): SlideDefinition {
    const combinedNarrative = interpretations
      .map((i) => i.salesInsights.suggestedNarrative)
      .join("；");

    return {
      pageNumber: pageNum,
      title: "综合方案建议",
      content: `方案定位
${combinedNarrative}

${comparison?.recommendation || ""}

下一步行动
• 详细了解各产品具体条款
• 根据个人需求调整保障额度
• 确认投保意向，启动申请流程`,
      chartType: "纯文本",
      visualNotes: "两栏布局，左侧方案定位文字，右侧下一步行动清单",
      narrative: "综合考量您的需求和各产品特点，我们推荐以上方案组合，为您构建完整的保障与财富规划",
    };
  }

  // ─── 感谢幻灯片 ────────────────────────────────

  private static buildClosingSlide(pageNum: number): SlideDefinition {
    return {
      pageNumber: pageNum,
      title: "感谢",
      content: "感谢您的时间\n期待为您提供专业服务\n\n本文件仅供参考，不构成要约或建议。\n非保证金额并非保证，实际可能高于或低于预期。",
      chartType: "纯文本",
      visualNotes: "深色背景，大字“感谢”，副标题居中，底部免责小字",
      narrative: "感谢您查看这份保险方案，期待成为您财务规划路上的可靠伙伴",
    };
  }

  // ─── 渲染 Markdown ────────────────────────────────

  private static renderMarkdown(slides: SlideDefinition[], interpretations: 计划书解读[]): string {
    const typeMap = { savings: "储蓄险", ci: "重疾险", iul: "万用寿险" };

    let md = `# 保险计划书 PPT 大纲\n\n`;
    md += `> 自动生成时间: ${new Date().toLocaleString("zh-HK")}\n`;
    md += `> 产品类型: ${interpretations.map((i) => typeMap[i.planType]).join(" + ")}\n\n`;

    md += `---\n\n`;

    for (const slide of slides) {
      md += `## 第 ${slide.pageNumber} 页: ${slide.title}\n\n`;
      md += `${slide.content}\n\n`;
      md += `> **视觉风格**: ${slide.visualNotes || "标准布局"}\n`;
      if (slide.narrative) {
        md += `> **叙事文案**: ${slide.narrative}\n`;
      }
      md += `> **图表类型**: ${slide.chartType}\n\n`;
      md += `---\n\n`;
    }

    // 附加说明
    md += `## 附加说明\n\n`;
    md += `### 数据来源\n`;
    for (const interp of interpretations) {
      md += `- ${interp.pdfName}: ${interp.productName} (${typeMap[interp.planType]})\n`;
    }
    md += `\n### 强调的关键数字\n`;
    for (const interp of interpretations) {
      if (interp.salesInsights.highlightNumbers.length > 0) {
        md += `\n**${interp.productName}**:\n`;
        for (const h of interp.salesInsights.highlightNumbers) {
          md += `- ${h.label} (第${h.year}年): $${(h.value / 1000).toFixed(0)}K\n`;
        }
      }
    }

    return md;
  }

  // ─── 提取 Markdown 模板（供 AI 使用） ────────────────────────────────

  /**
   * 返回三种产品的默认模板，供 AI 在生成 PPT 时参考
   */
  static getDefaultTemplates(): Record<string, string> {
    return {
      savings: `# 储蓄险 PPT 模板

## 页面结构（建议 8-12 页）

### 第1页: 封面
- 标题: 客户姓名
- 副标题: {产品名称} 财富规划方案
- KPI卡片: 年缴保费 | 回本年份 | 20年预期回报
- 风格: 深色背景 + 金色强调 + 大字体

### 第2页: 方案概览
- 三层架构图: 风险防护 → 财富累积 → 传承规划
- 每层显示产品名称和核心卖点
- 叙事: "从保障到增值，全方位规划"

### 第3页: 产品介绍
- 受保人信息
- 产品特点列表
- 核心卖点（3-5条）
- 叙事: {suggested_narrative}

### 第4页: 账户价值增长分析
- 折线图: 第1/3/5/7/10/15/20/30年的退保价值
- X轴: 保单年度, Y轴: 金额
- 标注回本时间点和翻倍时间点
- 叙事: "时间是最好的朋友，复利是最大的杠杆"

### 第5页: 关键年度数据表
- 表格: 年度 | 已缴保费 | 保证金额 | 非保证 | 退保总额 | 倍数
- 高亮第5/10/20/30年的数据
- 叙事: "用数据说话，让选择更清晰"

### 第6页: 保证 vs 非保证
- 区域图: 保证现金价值 vs 复归红利+终期分红
- 显示两者差距随时间的变化
- 叙事: "保证的是底线，非保证的是想象空间"

### 第7页: 提取方案（如有）
- 对比图: 不提取 vs 提取后的账户价值
- 显示提取金额和提取后剩余
- 叙事: "按需提取，灵活规划人生"

### 第8页: 综合建议
- 总结核心卖点
- 对比市场同类产品优势
- 下一步行动

### 第9页: 感谢
- 深色背景
- 大字"感谢"
- 免责提示（小字）
`,

      ci: `# 重疾险 PPT 模板

## 页面结构（建议 6-10 页）

### 第1页: 封面
- 标题: 客户姓名
- 副标题: {产品名称} 健康保障方案
- KPI卡片: 每天成本 | 总保额 | 保障期限
- 风格: 清爽背景 + 橙色/绿色强调

### 第2页: 方案概览
- 三层架构图: 基础保障 → 多次赔付 → 保障升级
- 每层显示产品名称和核心卖点
- 叙事: "健康是最大的财富，保障是最智慧的投资"

### 第3页: 产品介绍
- 受保人信息（姓名/年龄/性别）
- 保障项目概览
- 核心卖点（3-5条）
- 叙事: {suggested_narrative}

### 第4页: 保障范围
- 表格或网格布局展示各保障项目
- 每项显示名称和赔付金额
- 重点标注癌症/中风/心脏病保障
- 叙事: "全面覆盖常见危疾，让保障无死角"

### 第5页: 多次赔付设计
- 流程图或时间轴展示多次赔付条件
- 每种情况显示赔付次数和总限额
- 叙事: "危疾不等于终点，保障与时俱进"

### 第6页: 现金价值累积
- 折线图: 第5/10/15/20/25/30年的现金价值和身故赔偿
- 显示保单如何成为"有保障的储蓄"
- 叙事: "不仅是一份保障，更是一份积累"

### 第7页: 每天成本计算
- 大字显示: $X/天 = 全方位危疾保障
- 对比: 一天一杯咖啡的价格 vs 全年保障
- 叙事: "用小钱换大保障，智慧之选"

### 第8页: 综合建议
- 总结核心卖点
- 对比市场同类产品优势
- 下一步行动

### 第9页: 感谢
- 深色背景
- 大字"感谢"
- 免责提示（小字）
`,

      iul: `# 万用寿险 PPT 模板

## 页面结构（建议 8-12 页）

### 第1页: 封面
- 标题: 客户姓名
- 副标题: {产品名称} 传承保障方案
- KPI卡片: 身故保障 | 杠杆比例 | 账户增长
- 风格: 深色背景 + 蓝绿渐变强调

### 第2页: 方案概览
- 双账户架构图: 固定账户（保证）vs 指数账户（增长）
- 显示两个账户的特点和适用场景
- 叙事: "攻守兼备，让您的财富既有保障又有增长"

### 第3页: 产品介绍
- 受保人信息（姓名/年龄/性别）
- 账户配置（固定 vs 指数比例）
- 核心卖点（3-5条）
- 叙事: {suggested_narrative}

### 第4页: 保证 vs 非保证账户价值
- 双折线图: 保证现金价值 vs 非保证账户价值
- 显示两条线的发展趋势和差距
- 标注保底0%的优势
- 叙事: "保底不亏本，上涨分享市场红利"

### 第5页: 指数账户增长预测
- 折线图: 假设不同指数利率下的账户价值
- 显示 S&P 500 历史平均（约10%）下的预期
- 标注20/30/40年后的价值
- 叙事: "参与美国经济增长，让复利为您工作"

### 第6页: 身故保障维持
- 柱状图: 不同年份的身故保障 vs 账户价值
- 显示两者如何相互配合
- 叙事: "无论市场如何波动，身故保障始终保护您的家人"

### 第7页: 税务优势
- 说明 IUL 的税务优惠（根据香港/新加坡税法）
- 对比一般投资的税务影响
- 叙事: "税务优化让您的财富更高效地传承"

### 第8页: 综合建议
- 总结核心卖点
- 对比市场同类产品优势
- 下一步行动

### 第9页: 感谢
- 深色背景
- 大字"感谢"
- 免责提示（小字）
`,
    };
  }
}
