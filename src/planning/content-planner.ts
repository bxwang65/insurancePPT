// @ts-nocheck
// Legacy planner pending normalized CI/IUL migration.
/**
 * ContentPlanner v2 — LLM驱动的叙事规划引擎
 *
 * 重构目标：
 * 1. 真正调用LLM理解环宇盈活数据，生成有销售叙事的ContentPlan
 * 2. 支持 DeepSeek/MiniMax 多provider自动切换
 * 3. 输出结构化 SlidePlan[]，驱动后续 HTML 渲染引擎
 * 4. fallback 降级为规则生成（不再空跑）
 *
 * 核心流程：
 *   PDF数据 → LLM解读(产品叙事+客户画像+关键数字) → ContentPlan
 *   ContentPlan → HTML渲染器 → 高质量PNG → PPTX
 */

import { llmClient, type LLMResponse } from "../lib/llm-client.ts"
import type { SavingsPlanExtraction } from "../schemas/savings-plan.ts"
import type { CiPlanExtraction } from "../schemas/critical-illness.ts"
import type { IulExtraction } from "../schemas/iul.ts"

// ─── 类型定义 ─────────────────────────────────────────────

export type VisualType = "KPI卡片" | "面积图" | "折线图" | "柱状图" | "饼图" | "表格" | "对比图" | "品牌页" | "纯文本"
export type LayoutType = "左图右文" | "上图下文" | "全屏KPI" | "三栏" | "对比" | "单栏" | "表格式"

export interface SlidePlan {
  pageNumber: number
  title: string
  narrativeText: string       // 叙事文案（销售视角，30字内）
  contentFocus: string        // 核心信息描述
  visualType: VisualType
  chartType?: string         // 图表子类型： "折线面积图" | "分组柱状图" | "堆叠柱状图" | "双线对比图" | "KPI卡片组" | "数据表格"
  dataHighlights: string[]   // 要突出的数据标签
  layout: LayoutType
  emphasisNotes?: string      // 视觉强调说明（字体/颜色/动效提示）
  htmlTemplate?: string       // 可选：指定HTML模板路径
}

export interface ContentPlan {
  overallNarrative: string    // 整体故事线（一句话概括PPT核心）
  customerProfileSummary: string
  slides: SlidePlan[]
  metadata: {
    productTypes: string[]
    totalPages: number
    generatedAt: string
    brandColors: {
      primary: string
      accent_teal: string
      accent_gold: string
    }
    salesNarrative?: string   // LLM生成的销售叙事（可选）
    keyMetrics?: {            // LLM识别的关键指标
      breakevenYear: number | null
      y20Multiple: number | null
      y30Multiple: number | null
      y100Multiple: number | null
    }
  }
}

type PlanData = SavingsPlanExtraction | CiPlanExtraction | IulExtraction

interface PlanInput {
  extractions: Array<{
    pdfName: string
    planType: "savings" | "ci" | "iul"
    data: PlanData
  }>
  userIntent?: string
  customerName?: string
  conversationHistory?: string[]
}

// ─── 品牌配色 ─────────────────────────────────────────────

const BRAND_COLORS = {
  primary: "#0A3C5F",
  accent_teal: "#18898D",
  accent_gold: "#C9A027"
}

const TYPE_LABELS: Record<string, string> = {
  savings: "储蓄险",
  ci: "重疾险",
  iul: "万用寿险"
}

// ─── 核心类 ─────────────────────────────────────────────

export class ContentPlanner {
  constructor(private apiKey?: string) {}

  /**
   * 主入口：生成内容规划
   *
   * 流程：
   *  1. buildProductSummary — 构产品数据摘要（用于LLM理解）
   *  2. extractUserFocus — 从对话历史/意图中提取用户关注点
   *  3. buildPlanningPrompt — 构建LLM prompt
   *  4. llmClient.structuredOutput — 调用LLM生成ContentPlan
   *  5. 验证/补充metadata
   *  6. fallback — LLM失败时用规则生成（保证永远有输出）
   */
  async plan(input: PlanInput): Promise<ContentPlan> {
    const { extractions, userIntent, customerName, conversationHistory } = input

    // 构建产品摘要（用于LLM）
    const productSummary = this.buildProductSummary(extractions)

    // 提取用户关注点
    const userFocusPoints = this.extractUserFocus(conversationHistory, userIntent)

    // 构建LLM prompt
    const prompt = this.buildPlanningPrompt(
      productSummary,
      userFocusPoints,
      customerName
    )

    const systemPrompt = `你是一位专业的香港保险计划书 PPT 设计专家，精通储蓄险、重疾险、万用寿险（IUL）等各类计划书的销售叙事设计。你的风格：专业、高端、温暖，像资深保险顾问给客户讲解。每页的叙事文案要有感染力，30字内。能精准理解计划书数据中的关键数字，并设计合适的图表类型呈现。`

    try {
      const result = await llmClient.structuredOutput<ContentPlan>(
        prompt,
        systemPrompt,
        this.getSchema()
      )

      // 验证slides数组
      if (!result.data.slides || !Array.isArray(result.data.slides) || result.data.slides.length === 0) {
        throw new Error("Invalid LLM output: slides array missing or empty")
      }

      // 补充metadata
      result.data.metadata = {
        productTypes: extractions.map(e => e.planType),
        totalPages: result.data.slides.length,
        generatedAt: new Date().toISOString(),
        brandColors: BRAND_COLORS,
        // 从数据中提取关键指标
        keyMetrics: this.extractKeyMetrics(extractions)
      }
      return this.normalizePlan(result.data, extractions)

    } catch (err) {
      console.warn("[ContentPlanner] LLM规划失败，使用规则fallback:", err)
      const fallbackPlan = this.generateFallbackPlan(extractions, userIntent, customerName)
      fallbackPlan.metadata.keyMetrics = this.extractKeyMetrics(extractions)
      return this.normalizePlan(fallbackPlan, extractions)
    }
  }

  private normalizePlan(plan: ContentPlan, extractions: PlanInput["extractions"]): ContentPlan {
    const slides = (plan.slides || []).map((s, i) => ({
      ...s,
      pageNumber: i + 1,
      narrativeText: this.trimNarrative(s.narrativeText || s.contentFocus || ""),
      dataHighlights: Array.isArray(s.dataHighlights) ? s.dataHighlights.slice(0, 6) : [],
    }));
    return {
      ...plan,
      slides,
      metadata: {
        ...plan.metadata,
        productTypes: extractions.map((e) => e.planType),
        totalPages: slides.length,
        generatedAt: new Date().toISOString(),
        brandColors: BRAND_COLORS,
      },
    };
  }

  private trimNarrative(text: string): string {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length <= 30) return clean;
    return `${clean.slice(0, 29)}…`;
  }

  /**
   * 构建产品摘要（用于LLM理解）
   * 将原始JSON数据转化为LLM可读的摘要文本
   */
  private buildProductSummary(extractions: PlanInput["extractions"]): string {
    return extractions.map(ext => {
      const data = ext.data as any
      const type = TYPE_LABELS[ext.planType] || ext.planType

      let summary = `【${data.product_name || ext.pdfName}】(${type})\n`
      summary += `受保人: ${data.insured?.name || '未知'}`
      if (data.insured?.age) summary += ` | ${data.insured.age}岁`
      if (data.insured?.gender) summary += ` | ${data.insured.gender === 'M' ? '男' : '女'}`

      if (ext.planType === "savings") {
        const policy = data.policy || {}
        const annualPremium = (policy.annual_premium as number) || 0
        const paymentPeriod = (policy.premium_payment_period as string) || '未知'
        const totalPrem = annualPremium * parseInt(paymentPeriod.replace('年', '') || '0') || 0

        summary += `\n年缴: $${annualPremium.toLocaleString()} | 缴期: ${paymentPeriod} | 总投入: $${totalPrem.toLocaleString()}`

        const benefits = data.benefit_illustration || []
        if (benefits.length > 0) {
          // 找回本年份
          const breakeven = benefits.find((r: any) => r.total_surrender_value >= r.total_premium_paid && r.policy_year > 2)
          if (breakeven) {
            summary += `\n回本: 第${breakeven.policy_year}年 (退保总值 $${breakeven.total_surrender_value.toLocaleString()} ≥ 已缴 $${breakeven.total_premium_paid.toLocaleString()})`
          }

          // 找关键年份数据
          for (const y of [5, 10, 15, 20, 25, 30, 100]) {
            const row = benefits.find((r: any) => r.policy_year === y)
            if (row && row.total_surrender_value > 0) {
              const mult = totalPrem > 0 ? (row.total_surrender_value / totalPrem).toFixed(2) : 'N/A'
              summary += `\n  Y${y}: 退保总值 $${row.total_surrender_value.toLocaleString()} | 回报 ${mult}x | 保GCV $${row.guaranteed_cash_value.toLocaleString()} | 非保 $${((row.reversionary_bonus || 0) + (row.terminal_dividend || 0)).toLocaleString()}`
            }
          }

          // 提取方案
          if (data.withdrawal_illustration && data.withdrawal_illustration.length > 0) {
            const w10 = data.withdrawal_illustration.find((w: any) => w.policy_year === 10)
            if (w10) {
              summary += `\n提取方案(年提$35K): Y10剩余 $${w10.remaining_value.toLocaleString()} | 累计提取 $${w10.cumulative_withdrawal.toLocaleString()}`
            }
          }
        }
      } else if (ext.planType === "ci") {
        const policy = data.policy || {}
        const annualPrem = (policy.annual_premium as number) || 0
        const sumInsured = (policy.sum_insured as number) || 0
        const paymentYears = (policy.payment_years as number) || 0
        summary += `\n保额: $${sumInsured.toLocaleString()} | 年缴: $${annualPrem.toLocaleString()} | 缴费期: ${paymentYears}年`
        if (annualPrem > 0) summary += ` | 每天 $${(annualPrem / 365).toFixed(1)}`

        const benefits = data.benefit_illustration || []
        if (benefits.length > 0) {
          for (const y of [10, 20, 30]) {
            const row = benefits.find((r: any) => r.policy_year === y)
            if (row) {
              summary += `\n  Y${y}: 身故赔偿 $${(row.death_benefit_total || 0).toLocaleString()} | 退保价值 $${(row.surrender_value_total || 0).toLocaleString()}`
            }
          }
        }

        if (data.coverage_items && data.coverage_items.length > 0) {
          summary += `\n保障项目: ${data.coverage_items.map((c: any) => c.item_name || c.name || '未知').slice(0, 5).join(', ')}`
        }
      } else if (ext.planType === "iul") {
        const policy = data.policy || {}
        summary += `\n身故保障: $${(policy.sum_insured as number)?.toLocaleString() || '未知'}`
        if (policy.index_account_rate) summary += ` | 指数利率: ${policy.index_account_rate}%`
        if (policy.capital_partition) summary += ` | 资本分割: ${policy.capital_partition}%`

        const benefits = data.benefit_illustration || []
        if (benefits.length > 0) {
          for (const y of [10, 20, 30]) {
            const row = benefits.find((r: any) => r.policy_year === y)
            if (row) {
              const cashValue = row.cash_value || row.account_value || 0
              summary += `\n  Y${y}: 现金价值 $${cashValue.toLocaleString()} | 身故赔偿 $${(row.death_benefit || 0).toLocaleString()}`
            }
          }
        }
      }

      return summary
    }).join("\n\n")
  }

  /**
   * 从对话历史提取用户关注点
   */
  private extractUserFocus(
    conversationHistory?: string[],
    userIntent?: string
  ): string[] {
    const focusPoints: string[] = []

    const allText = [userIntent, ...(conversationHistory || [])].filter(Boolean).join(" ")

    if (allText) {
      const patterns = [
        { pattern: /回本|breakeven/i, label: "回本速度分析" },
        { pattern: /对比|比较|差异/i, label: "产品对比" },
        { pattern: /传承|遗产|代/i, label: "财富传承" },
        { pattern: /收益|回报|增值|增长/i, label: "投资收益分析" },
        { pattern: /保障|覆盖|赔付/i, label: "保障范围分析" },
        { pattern: /提取|领取|现金/i, label: "提取方案分析" },
        { pattern: /IRR|内部收益率|复利/i, label: "IRR/复利分析" },
        { pattern: /退休|养老|教育/i, label: "退休/教育金规划" },
        { pattern: /死亡|身故|理赔/i, label: "身故保障分析" },
      ]

      for (const { pattern, label } of patterns) {
        if (pattern.test(allText)) {
          focusPoints.push(label)
        }
      }
    }

    if (focusPoints.length === 0) {
      focusPoints.push("完整方案展示")
    }

    return focusPoints
  }

  /**
   * 构建LLM规划prompt
   */
  private buildPlanningPrompt(
    productSummary: string,
    userFocusPoints: string[],
    customerName?: string
  ): string {
    const focusStr = userFocusPoints.join("、")
    const clientLabel = customerName ? `VIP ${customerName}` : "尊貴客戶"

    return `## 任务
根据以下保险计划书数据，设计一份专业销售 PPT 的大纲结构。

## 产品信息
${productSummary}

## 客户信息
客户姓名: ${clientLabel}
用户关注点: ${focusStr}

## 设计规范
- 配色方案:
  - 主色(深海蓝): #0A3C5F
  - 强调色(青绿): #18898D
  - 强调色(金色): #C9A027
  - 背景: 深蓝渐变背景，白色文字
- 风格: 专业、高端、温暖，像资深保险顾问给客户讲解
- 叙事文案要有感染力，30字内，直击客户痛点

## 输出要求
1. 总页数8-12页
2. 每页有明确的叙事重点和销售逻辑
3. 选择合适的图表类型呈现数据（Chart.js可用：折线图、面积图、柱状图、堆叠柱状图、饼图）
4. 突出关键数字（回本年份、翻倍年份、长期倍数等）
5. 叙事要有逻辑：
   - 封面（吸引注意）
   - 问题/需求分析（建立共鸣）
   - 产品介绍（解决方案）
   - 数据展示（证明效果）
   - 综合建议（行动号召）
   - 感谢页

请以JSON格式输出（格式见下方schema）。只输出JSON，不要任何额外文字。`
  }

  /**
   * 获取JSON Schema（用于结构化输出）
   */
  private getSchema(): object {
    return {
      type: "object",
      properties: {
        overallNarrative: {
          type: "string",
          description: "整体故事线（一句 话概括PPT的核心叙事，20字内）"
        },
        customerProfileSummary: {
          type: "string",
          description: "客户画像简述（15字内）"
        },
        slides: {
          type: "array",
          items: {
            type: "object",
            properties: {
              pageNumber: { type: "number" },
              title: { type: "string", description: "页面标题，20字内" },
              narrativeText: { type: "string", description: "叙事文案，30字内，有感染力，像销售顾问在说话" },
              contentFocus: { type: "string", description: "这页要传达的核心信息，20字内" },
              visualType: {
                type: "string",
                enum: ["KPI卡片", "面积图", "折线图", "柱状图", "饼图", "表格", "对比图", "品牌页", "纯文本"]
              },
              chartType: { type: "string", description: "图表子类型：如'折线面积图'、'分组柱状图'、'双线对比图'、'KPI卡片组'、'数据表格'" },
              dataHighlights: {
                type: "array",
                items: { type: "string" },
                description: "要突出的数据标签，如['回本年份Y7', '20年倍数2.7x', 'Y30: 5.9x']"
              },
              layout: {
                type: "string",
                enum: ["左图右文", "上图下文", "全屏KPI", "三栏", "对比", "单栏", "表格式"]
              },
              emphasisNotes: { type: "string", description: "视觉强调说明：如'金强调线'、'数字放大'、'渐变背景'等" }
            },
            required: ["pageNumber", "title", "narrativeText", "visualType", "dataHighlights", "layout"]
          }
        }
      },
      required: ["overallNarrative", "slides"]
    }
  }

  /**
   * 从extractions中提取关键指标
   */
  private extractKeyMetrics(extractions: PlanInput["extractions"]) {
    const metrics = { breakevenYear: null as number | null, y20Multiple: null as number | null, y30Multiple: null as number | null, y100Multiple: null as number | null }

    for (const ext of extractions) {
      if (ext.planType === "savings") {
        const data = ext.data as SavingsPlanExtraction
        const benefits = data.benefit_illustration || []
        const yearMap: Record<number, typeof benefits[0]> = {}
        for (const r of benefits) yearMap[r.policy_year] = r

        if (benefits.length > 0) {
          const totalPrem = Math.max(...benefits.map(r => r.total_premium_paid || 0)) || 1

          // 回本年份
          for (const r of benefits) {
            if (r.total_surrender_value >= r.total_premium_paid && r.policy_year > 2 && !metrics.breakevenYear) {
              metrics.breakevenYear = r.policy_year
              break
            }
          }

          // Y20
          const y20 = yearMap[20]
          if (y20) metrics.y20Multiple = parseFloat((y20.total_surrender_value / totalPrem).toFixed(2))

          // Y30
          const y30 = yearMap[30]
          if (y30) metrics.y30Multiple = parseFloat((y30.total_surrender_value / totalPrem).toFixed(2))

          // Y100
          const last = benefits[benefits.length - 1]
          if (last) metrics.y100Multiple = parseFloat((last.total_surrender_value / totalPrem).toFixed(1))
        }
        break  // 只看第一个储蓄险
      }
    }

    return metrics
  }

  /**
   * Fallback：当LLM不可用时，使用规则生成结构化大纲
   * 这是真正的降级策略，不是"空跑"
   */
  private generateFallbackPlan(
    extractions: PlanInput["extractions"],
    userIntent?: string,
    customerName?: string
  ): ContentPlan {
    const slides: SlidePlan[] = [];
    const name = customerName || "尊贵客户";
    let pageNum = 1;
    const metrics = this.extractKeyMetrics(extractions);

    slides.push({
      pageNumber: pageNum++,
      title: `${name}专属方案`,
      narrativeText: "把复杂条款讲成可执行决策",
      contentFocus: "封面与核心指标",
      visualType: "KPI卡片",
      chartType: "KPI卡片组",
      dataHighlights: metrics.breakevenYear ? [`回本Y${metrics.breakevenYear}`] : [],
      layout: "全屏KPI",
      emphasisNotes: "深色背景+金色关键数字",
    });

    for (const ext of extractions) {
      const data = ext.data as any;
      const policy = data?.policy || {};
      slides.push({
        pageNumber: pageNum++,
        title: `${data?.product_name || ext.pdfName} 概览`,
        narrativeText: "先看结构，再看收益与保障",
        contentFocus: "产品信息和受保人画像",
        visualType: "KPI卡片",
        dataHighlights: [
          policy.annual_premium ? `年缴$${Number(policy.annual_premium).toLocaleString()}` : "年缴待确认",
          policy.premium_payment_period ? `缴费${policy.premium_payment_period}` : "缴费期待确认",
        ],
        layout: "上图下文",
      });

      if (ext.planType === "savings") {
        slides.push({
          pageNumber: pageNum++,
          title: "长期价值增长",
          narrativeText: "短缴费，长复利，适合传承规划",
          contentFocus: "退保价值与关键年份增长",
          visualType: "折线图",
          chartType: "双线对比图",
          dataHighlights: [
            metrics.y20Multiple ? `20年${metrics.y20Multiple}x` : "20年倍数",
            metrics.y30Multiple ? `30年${metrics.y30Multiple}x` : "30年倍数",
          ],
          layout: "左图右文",
        });
      } else if (ext.planType === "ci") {
        slides.push({
          pageNumber: pageNum++,
          title: "保障责任拆解",
          narrativeText: "预算可控，但保障深度要足够",
          contentFocus: "重疾责任与多次赔付逻辑",
          visualType: "表格",
          chartType: "数据表格",
          dataHighlights: ["保额", "缴费期", "核心赔付责任"],
          layout: "表格式",
        });
      } else {
        slides.push({
          pageNumber: pageNum++,
          title: "杠杆与现金价值",
          narrativeText: "先保障底线，再争取指数增值",
          contentFocus: "IUL账户价值与身故杠杆",
          visualType: "对比图",
          chartType: "双线对比图",
          dataHighlights: ["身故保障", "现金价值", "杠杆倍数"],
          layout: "对比",
        });
      }
    }

    if (extractions.length > 1) {
      slides.push({
        pageNumber: pageNum++,
        title: "多产品组合建议",
        narrativeText: "组合不是堆叠，是风险分层",
        contentFocus: "回本、保障、灵活性三维对比",
        visualType: "对比图",
        chartType: "分组柱状图",
        dataHighlights: ["回本速度", "长期倍数", "保障杠杆"],
        layout: "对比",
      });
    }

    slides.push({
      pageNumber: pageNum++,
      title: "下一步执行建议",
      narrativeText: userIntent ? `围绕“${userIntent.slice(0, 12)}”落地` : "明确目标后，执行更稳",
      contentFocus: "行动路径与跟进节奏",
      visualType: "纯文本",
      dataHighlights: [],
      layout: "单栏",
    });

    slides.push({
      pageNumber: pageNum++,
      title: "感谢",
      narrativeText: "感谢信任，方案可继续迭代优化",
      contentFocus: "联系方式与声明",
      visualType: "纯文本",
      dataHighlights: [],
      layout: "单栏",
    });

    return {
      overallNarrative: "以客户目标为中心的保障与财富协同方案",
      customerProfileSummary: customerName ? `客户: ${customerName}` : "客户画像待补充",
      slides,
      metadata: {
        productTypes: extractions.map((e) => e.planType),
        totalPages: slides.length,
        generatedAt: new Date().toISOString(),
        brandColors: BRAND_COLORS,
      },
    };
  }

  /**
   * 渲染为Markdown大纲（供调试/日志使用）
   */
  renderToMarkdown(plan: ContentPlan): string {
    let md = `# 保险计划书 PPT 大纲 (ContentPlanner v2)\n\n`
    md += `> 生成时间: ${new Date().toLocaleString("zh-HK")}\n`
    md += `> 整体叙事: ${plan.overallNarrative}\n`
    md += `> 客户画像: ${plan.customerProfileSummary}\n`
    md += `> 总页数: ${plan.slides.length}\n\n`
    md += `---\n\n`

    for (const slide of plan.slides) {
      md += `## 第 ${slide.pageNumber} 页: ${slide.title}\n\n`
      md += `**叙事文案**: ${slide.narrativeText}\n\n`
      md += `**核心信息**: ${slide.contentFocus}\n\n`
      md += `**视觉类型**: ${slide.visualType}`
      if (slide.chartType) md += ` → ${slide.chartType}`
      md += `\n\n`
      md += `**布局**: ${slide.layout}\n\n`
      if (slide.dataHighlights.length > 0) {
        md += `**数据亮点**: ${slide.dataHighlights.join(" | ")}\n\n`
      }
      if (slide.emphasisNotes) {
        md += `**视觉强调**: ${slide.emphasisNotes}\n\n`
      }
      md += `---\n\n`
    }

    return md
  }

  /**
   * 导出单例
   */
  static readonly shared = new ContentPlanner()
}

export default ContentPlanner
