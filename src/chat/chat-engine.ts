/**
 * ChatEngine — 对话引擎（支持全产品类型）
 * 接入 InterpretationEngine，为经纪人提供有温度的销售顾问式对话
 */

import { InterpretationEngine, type 计划书解读, type 销售洞察 } from "./interpretation-engine.ts";
import { llmClient } from "../lib/llm-client.ts";

interface ExtractedPlan {
  pdfName: string;
  planType: "savings" | "ci" | "iul";
  data: unknown;
}

interface ChatRequest {
  message: string;
  extractions: ExtractedPlan[];
  history: { role: "user" | "assistant"; content: string }[];
  customerName?: string;
}

export class ChatEngine {
  constructor(_apiKey: string) {}

  async chat(req: ChatRequest): Promise<string> {
    const { message, extractions, history, customerName } = req;

    // 1. 解读每份计划书
    const interpretations: 计划书解读[] = [];
    for (const ext of extractions) {
      const interp = InterpretationEngine.interpret(ext.pdfName, ext.planType, ext.data as Parameters<typeof InterpretationEngine.interpret>[2]);
      interpretations.push(interp);
    }

    // 2. 构建上下文
    const context = this.buildContext(interpretations);
    const insights = this.buildInsightsContext(interpretations);
    const recentHistory = history
      .slice(-20)
      .map((h) => `${h.role === "user" ? "用户" : "顾问"}: ${h.content}`)
      .join("\n\n");

    const systemPrompt = `你是一位资深的香港保险顾问，正在为保险经纪人提供专业分析建议。

## 已解析的计划书数据
${context}

## AI 销售洞察（InterpretationEngine 自动生成）
${insights}

## 你的角色定位
你不仅是数据分析师，更是一位**销售顾问**。你的回答应该：
1. **有温度** — 用客户能听懂的语言，而不是冰冷的数字堆砌
2. **有叙事** — 把数据转化成故事，比如"到第20年，您的100万已经变成了270万"
3. **有建议** — 主动建议如何向客户展示这些数据
4. **有对比** — 多份计划书时，给出清晰的对比分析和建议

## 输出规则
- 基于数据回答，不编造数字
- 涉及具体数字时引用数据来源（"根据计划书数据，第X年退保总额为$Y"）
- 主动给出展示建议（"建议在PPT中用折线图展示长期增长"）
- 关键数字要突出显示（用 **加粗**）
- 客户问"对比"时，清晰列出差异并给出倾向性建议`;

    const prompt = `## 历史对话
${recentHistory}

## 用户最新问题
${message}

请以资深保险顾问的身份回答，结合数据和销售洞察给出有温度的分析和建议。`;

    return this.callLLM(systemPrompt, prompt).catch(() => this.localFallback(message, interpretations));
  }

  private buildContext(interpretations: 计划书解读[]): string {
    if (interpretations.length === 0) return "暂无计划书数据。";

    const typeLabels = { savings: "储蓄险", ci: "重疾险", iul: "万用寿险" };
    const parts: string[] = [];

    for (let i = 0; i < interpretations.length; i++) {
      const interp = interpretations[i];
      const d = interp.rawData as Record<string, unknown>;
      const pol = interp.policy;

      let ctx = `【${interp.productName}】(${typeLabels[interp.planType]})\n`;
      ctx += `受保人: ${interp.insured.name} | ${interp.insured.age}岁 | ${interp.insured.gender}\n`;

      if (interp.planType === "savings") {
        const annualPrem = (pol.annual_premium as number) || 0;
        const paymentPeriod = (pol.premium_payment_period as string) || "";
        ctx += `年缴: $${annualPrem.toLocaleString()} | 缴付${paymentPeriod}\n`;
        const breakeven = interp.salesInsights.highlightNumbers.find((h) => h.type === "回本");
        if (breakeven) ctx += `回本: 第${breakeven.year}年 (退保总额 ${this.fmt(breakeven.value)})\n`;
        const y20 = interp.salesInsights.highlightNumbers.find((h) => h.year === 20);
        if (y20) ctx += `20年倍数: ${y20.label} (退保总额 ${this.fmt(y20.value)})\n`;
        ctx += `\n关键年度数据:\n`;
        ctx += `| 年度 | 退保总额 | 倍数 |\n|-----|---------|------|\n`;
        for (const h of interp.salesInsights.highlightNumbers) {
          ctx += `| Y${h.year} | ${this.fmt(h.value)} | ${h.label} |\n`;
        }
      } else if (interp.planType === "ci") {
        const sumInsured = (pol.sum_insured as number) || 0;
        const annualPrem = (pol.annual_premium as number) || 0;
        const dailyCost = (annualPrem / 365).toFixed(1);
        ctx += `保额: ${this.fmt(sumInsured)} | 年缴: ${this.fmt(annualPrem)} (每天 $${dailyCost})\n`;
        ctx += `保障期限: ${pol.coverage_period || "终身"}\n`;
        const coverageItems = (d.coverage_items as Array<{ name: string; amount?: number }>) || [];
        if (coverageItems.length > 0) {
          ctx += `\n保障项目 (${coverageItems.length}项):\n`;
          for (const item of coverageItems.slice(0, 6)) {
            ctx += `• ${item.name}: ${item.amount ? this.fmt(item.amount) : "—"}\n`;
          }
        }
      } else if (interp.planType === "iul") {
        const sumInsured = (pol.sum_insured as number) || 0;
        const initialPrem = (pol.initial_premium as number) || 0;
        const leverage = initialPrem > 0 ? (sumInsured / initialPrem).toFixed(1) : "—";
        ctx += `身故保障: ${this.fmt(sumInsured)} | 初始保费: ${this.fmt(initialPrem)} | 杠杆: ${leverage}x\n`;
        if (pol.index_account_rate) ctx += `指数账户假设利率: ${pol.index_account_rate}%\n`;
        if (pol.fixed_account_rate) ctx += `固定账户保证利率: ${pol.fixed_account_rate}%\n`;
      }

      parts.push(ctx);
    }
    return parts.join("\n\n");
  }

  private buildInsightsContext(interpretations: 计划书解读[]): string {
    const parts: string[] = [];
    for (const interp of interpretations) {
      const si = interp.salesInsights;
      parts.push(
        `【${interp.productName}】\n` +
        `目标客户: ${si.targetCustomer}\n` +
        `核心卖点: ${si.keySellingPoints.join("、")}\n` +
        `独特优势: ${si.uniqueAdvantages}\n` +
        `建议叙事: ${si.suggestedNarrative}\n` +
        `对比维度: ${si.comparisonPoints.join("、")}`
      );
    }
    return parts.join("\n\n");
  }

  private async callLLM(systemPrompt: string, prompt: string): Promise<string> {
    try {
      const result = await llmClient.chat(prompt, systemPrompt);
      return result.content;
    } catch (err) {
      console.error("[ChatEngine] LLM call failed:", err);
      throw err;
    }
  }

  private localFallback(message: string, interpretations: 计划书解读[]): string {
    const first = interpretations[0];
    if (!first) return "当前无可用计划书数据，请先完成解析后再提需求。";
    const key = first.salesInsights.highlightNumbers;
    const y20 = key.find((k) => k.year === 20);
    const y30 = key.find((k) => k.year === 30);
    const age = first.insured.age;
    const scenario = age < 18 ? "教育金" : "养老金";
    return [
      "已收到你的定制需求（当前为系统兜底回复，核心数据已基于解析结果）。",
      `产品：${first.productName}；客户：${first.insured.name}（${age}岁，建议按${scenario}路径展示）。`,
      `关键数字：20年约${y20?.label || "-"}，30年约${y30?.label || "-"}。`,
      "建议你下一步直接生成PPT，我会优先优化：公司页、里程碑页、提领/不提领双表格、图表解释卡。",
      `你刚才的问题是：${message}`,
    ].join("\n");
  }

  private fmt(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  }
}
