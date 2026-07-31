// @ts-nocheck
// Legacy non-savings outline generator pending CI/IUL normalized models.
/**
 * OutlineGenerator — PPT 大纲生成器
 * 接入 InterpretationEngine + MarkdownTemplateEngine
 * 支持结构化输入 + 可选的 AI 增强生成
 */

import { InterpretationEngine, type 计划书解读, type PPT修改建议 } from "./interpretation-engine.ts";
import { MarkdownTemplateEngine, type TemplateInput } from "../templates/markdown-templates.ts";

interface OutlineInput {
  /** 直接传入已提取的 JSON 数据（来自 orchestrator） */
  extractions: {
    pdfName: string;
    planType: "savings" | "ci" | "iul";
    data: unknown;
  }[];
  customerName?: string;
  /** 可选：经纪人确认的修改建议 Map<pdfName, PPT修改建议[]> */
  modifications?: Map<string, PPT修改建议[]>;
  /** 可选：公司介绍文案 */
  companyInfo?: string;
  /** 是否使用 AI 进一步增强（默认 false，直接用模板生成） */
  enhanceWithAI?: boolean;
  /** AI API Key（当 enhanceWithAI=true 时需要） */
  apiKey?: string;
}

export class OutlineGenerator {
  constructor(private apiKey?: string) {
    this.apiKey = apiKey;
  }

  /**
   * 从原始提取数据生成 PPT Markdown 大纲
   *
   * 流程:
   *  1. 用 InterpretationEngine 解读每份计划书
   *  2. (可选) 用 InterpretationEngine.compare() 做多产品对比
   *  3. 用 MarkdownTemplateEngine 生成 Markdown 大纲
   *  4. (可选) AI 增强 — 优化叙事文案
   */
  async generate(input: OutlineInput): Promise<string> {
    // 1. 解读每份计划书
    const interpretations: 计划书解读[] = [];
    for (const ext of input.extractions) {
      console.log(`[outline] ${ext.pdfName} planType=${ext.planType} data.keys=${Object.keys(ext.data || {}).join(',')}`);
      const interp = InterpretationEngine.interpret(
        ext.pdfName,
        ext.planType,
        ext.data as Parameters<typeof InterpretationEngine.interpret>[2]
      );
      interpretations.push(interp);
    }

    // 2. 多产品对比
    const comparison = interpretations.length > 1
      ? InterpretationEngine.compare(interpretations)
      : undefined;

    // 3. 生成 Markdown 大纲
    const templateInput: TemplateInput = {
      interpretations,
      comparison,
      modifications: input.modifications,
      customerName: input.customerName,
      companyInfo: input.companyInfo,
    };

    let markdown = MarkdownTemplateEngine.generateMarkdown(templateInput);

    // 4. 可选 AI 增强（优先使用传入的apiKey，其次读环境变量）
    const aiKey = input.apiKey || process.env.MINIMAX_API_KEY || process.env.API_KEY || "";
    if (input.enhanceWithAI && aiKey) {
      try {
        const enhanced = await this.enhanceWithAI(markdown, interpretations, aiKey);
        markdown = enhanced;
      } catch (err) {
        console.warn("[OutlineGenerator] AI 增强失败，使用模板生成结果:", err);
      }
    }

    return markdown;
  }

  /**
   * 直接从 InterpretationEngine 的解读结果生成大纲
   * （跳过数据解析，直接用结构化输出）
   */
  generateFromInterpretation(
    interpretations: 计划书解读[],
    options?: {
      comparison?: ReturnType<typeof InterpretationEngine.compare>;
      modifications?: Map<string, PPT修改建议[]>;
      customerName?: string;
      companyInfo?: string;
      enhanceWithAI?: boolean;
      apiKey?: string;
    }
  ): string {
    const templateInput: TemplateInput = {
      interpretations,
      comparison: options?.comparison,
      modifications: options?.modifications,
      customerName: options?.customerName,
      companyInfo: options?.companyInfo,
    };

    return MarkdownTemplateEngine.generateMarkdown(templateInput);
  }

  /**
   * AI 增强叙事文案
   * — 将模板生成的 Markdown 传给 AI，让它优化每页的叙事文案和视觉描述
   */
  private async enhanceWithAI(
    markdown: string,
    interpretations: 计划书解读[],
    _apiKey: string
  ): Promise<string> {
    const typeMap = { savings: "储蓄险", ci: "重疾险", iul: "万用寿险" };
    const productList = interpretations
      .map((i) => `${i.productName} (${typeMap[i.planType]})`)
      .join("、");

    const prompt = `你是一位保险 PPT 设计专家，精通 Gamma/Google Stitch 风格。
请优化以下 PPT 大纲的叙事文案和视觉描述。

## 产品清单
${productList}

## 当前大纲
${markdown}

## 优化要求
1. **叙事文案**：每页的 narrativeText 要更有说服力，像专业的保险经纪人在给客户讲解
2. **视觉描述**：visualNotes 要更具体，指明颜色、布局、数据展示方式
3. **保持结构**：只优化文案，不改变页面结构和顺序
4. **中文输出**：所有文案必须是中文
5. **突出数字**：关键数字（回本年份/倍数/IRR）要用醒目方式呈现

请直接输出优化后的 Markdown，不做任何解释。`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${_apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`AI enhancement failed: ${response.status} ${response.statusText}`);
    }
    const result = await response.json();
    if (result.error) throw new Error(result.error.message);
    return result.candidates?.[0]?.content?.parts?.[0]?.text || markdown;
  }

  /**
   * 生成跨产品对比分析的 JSON 数据
   * 供 PPT 生成器的 build_comparison_table 使用
   */
  generateComparisonData(
    interpretations: 计划书解读[]
  ): {
    metrics: {
      metric: string;
      values: { value: string; label: string }[];
      winner: number;
    }[];
    recommendation: string;
  }[] {
    if (interpretations.length < 2) return [];

    const comparison = InterpretationEngine.compare(interpretations);
    return comparison.comparisonMetrics.map((m) => ({
      metric: m.metric,
      values: m.values,
      winner: m.winner,
    }));
  }
}
