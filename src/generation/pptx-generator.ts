// @ts-nocheck
// Legacy fallback generator. Formal API exports no longer call this module.
import PptxGenJS from "pptxgenjs";
import type { SavingsPlanExtraction, YearlyBenefitRow } from "../schemas/savings-plan.ts";

export interface PptConfig {
  brandColor?: string;
  accentColor?: string;
  titleColor?: string;
  /** Customer name for personalization */
  customerName?: string;
  /** Custom subtitle (e.g. "您的退休规划方案") */
  subtitle?: string;
}

const DARK: PptConfig = {
  brandColor: "0A1628",
  accentColor: "1A73E8",
  titleColor: "1A73E8",
};

export class SavingsPlanPptGenerator {
  protected pptx: PptxGenJS;
  protected config: PptConfig;
  protected data: SavingsPlanExtraction;

  constructor(data: SavingsPlanExtraction, config?: Partial<PptConfig>) {
    this.pptx = new PptxGenJS();
    this.config = { ...DARK, ...config };
    this.data = data;
    this.pptx.defineLayout({ name: "WIDE", width: 10, height: 5.625 });
    this.pptx.layout = "WIDE";
  }

  async generate(outputPath: string): Promise<void> {
    this.addCoverSlide();
    this.addOverviewSlide();
    this.addWealthGrowthSlide();
    this.addKeyTableSlide();
    this.addMultiplesSlide();
    this.addBreakevenSlide();
    this.addClosingSlide();
    await this.pptx.writeFile({ fileName: outputPath });
  }

  // ─── Slide 1: Warm Cover ────────────────────────────
  private addCoverSlide(): void {
    const s = this.pptx.addSlide();
    s.background = { fill: this.config.brandColor };

    const name = this.config.customerName || this.data.insured.name || "尊貴客戶";
    const subtitle = this.config.subtitle || this.data.sales_insights?.suggested_narrative || "財富增值與傳承方案";

    // Large personalized title
    s.addText(`${name}`, {
      x: 0.8, y: 1.0, w: 8.4, h: 0.8,
      fontSize: 36, fontFace: "Arial", color: "FFFFFF", bold: true,
    });
    s.addText(subtitle, {
      x: 0.8, y: 1.8, w: 8.4, h: 0.6,
      fontSize: 20, fontFace: "Arial", color: "90CAF9",
    });

    // Product name
    s.addShape(this.pptx.ShapeType.rect, {
      x: 0.8, y: 2.8, w: 4, h: 0.04, fill: { color: this.config.accentColor },
    });
    s.addText(this.data.product_name, {
      x: 0.8, y: 3.0, w: 8.4, h: 0.4,
      fontSize: 13, fontFace: "Arial", color: "8899AA",
    });

    // Key metrics in boxes
    const p = this.data.policy;
    const benefitRows = this.data.benefit_illustration ?? [];
    const totalPrem = benefitRows.length > 0
        ? Math.max(...benefitRows.map((r) => r.total_premium_paid ?? 0))
        : 0;
    const lastYear = benefitRows[benefitRows.length - 1];
    const multiple = totalPrem > 0 && lastYear
        ? ((lastYear.total_surrender_value ?? 0) / totalPrem).toFixed(1)
        : "-";
    const finalValue = lastYear?.total_surrender_value ?? 0;

    const metrics = [
      { label: "年繳保費", value: `$${this.formatShort(p.annual_premium)}` },
      { label: "繳費年期", value: p.premium_payment_period },
      { label: "總投入", value: `$${this.formatShort(totalPrem)}` },
      { label: "期末倍數", value: `${multiple}x` },
    ];

    metrics.forEach((m, i) => {
      const bx = 0.8 + i * 2.2;
      s.addShape(this.pptx.ShapeType.roundRect, {
        x: bx, y: 3.7, w: 1.9, h: 1.2,
        fill: { color: "FFFFFF", transparency: 90 },
        rectRadius: 6,
        line: { color: "FFFFFF", width: 0.5, transparency: 80 },
      });
      s.addText(m.value, {
        x: bx, y: 3.8, w: 1.9, h: 0.6,
        fontSize: 18, fontFace: "Arial", color: "FFFFFF", bold: true, align: "center",
      });
      s.addText(m.label, {
        x: bx, y: 4.4, w: 1.9, h: 0.4,
        fontSize: 10, fontFace: "Arial", color: "90CAF9", align: "center",
      });
    });

    const today = new Date().toISOString().split("T")[0];
    s.addText(`方案生成: ${today}`, {
      x: 0.8, y: 5.1, w: 4, h: 0.3,
      fontSize: 9, fontFace: "Arial", color: "667788",
    });
  }

  // ─── Slide 2: 方案概览 ────────────────────────────
  private addOverviewSlide(): void {
    const s = this.pptx.addSlide();
    s.background = { fill: "FFFFFF" };

    // Side accent bar
    s.addShape(this.pptx.ShapeType.rect, {
      x: 0, y: 0, w: 0.06, h: 5.625, fill: { color: this.config.accentColor },
    });

    s.addText("方案概覽", {
      x: 0.4, y: 0.3, w: 5, h: 0.6,
      fontSize: 22, fontFace: "Arial", color: "1A1A2E", bold: true,
    });

    const si = this.data.sales_insights;
    const p = this.data.policy;

    // Left column: customer profile + selling points
    let leftContent = `📋 **計劃要點**\n`;
    leftContent += `受保人: ${this.data.insured.name} | ${this.data.insured.age ?? "-"}歲\n`;
    leftContent += `保單貨幣: ${p.currency}\n`;
    leftContent += `年繳保費: $${p.annual_premium.toLocaleString()}\n`;
    leftContent += `繳費${p.premium_payment_period} | 保障${p.coverage_period}\n`;

    if (si?.target_customer) {
      leftContent += `\n🎯 **適合人群**\n${si.target_customer}`;
    }
    if (si?.key_selling_points?.length) {
      leftContent += `\n\n⭐ **核心優勢**\n${si.key_selling_points.map((pt) => `• ${pt}`).join("\n")}`;
    }

    s.addText(leftContent, {
      x: 0.5, y: 1.1, w: 4.3, h: 3.8,
      fontSize: 12, fontFace: "Arial", color: "444444",
      lineSpacingMultiple: 1.4, valign: "top",
      paraSpaceAfter: 6,
    });

    // Right column: highlight numbers
    if (si?.highlight_numbers?.length) {
      const highlights = si.highlight_numbers.slice(0, 4);
      s.addText("📊 **關鍵數字**", {
        x: 5.3, y: 1.1, w: 4.3, h: 0.4,
        fontSize: 14, fontFace: "Arial", color: "1A1A2E", bold: true,
      });

      highlights.forEach((h, i) => {
        const by = 1.7 + i * 0.9;
        s.addShape(this.pptx.ShapeType.roundRect, {
          x: 5.3, y: by, w: 4.2, h: 0.75,
          fill: { color: "F0F4FF" },
          rectRadius: 6,
        });
        s.addText(`Y${h.year}`, {
          x: 5.5, y: by + 0.05, w: 0.6, h: 0.3,
          fontSize: 10, fontFace: "Arial", color: this.config.accentColor, bold: true,
        });
        const valStr = h.value >= 1_000_000 ? `$${(h.value / 1_000_000).toFixed(2)}M` : `$${h.value.toLocaleString()}`;
        s.addText(valStr, {
          x: 5.5, y: by + 0.3, w: 1.8, h: 0.35,
          fontSize: 16, fontFace: "Arial", color: "1A1A2E", bold: true,
        });
        s.addText(h.label, {
          x: 7.2, y: by + 0.3, w: 2.2, h: 0.35,
          fontSize: 11, fontFace: "Arial", color: "666666",
        });
        if (h.description) {
          s.addText(h.description, {
            x: 5.5, y: by + 0.65, w: 3.8, h: 0.35,
            fontSize: 9, fontFace: "Arial", color: "888888",
          });
        }
      });
    }
  }

  // ─── Slide 3: 财富增长可视化 ─────────────────────
  private addWealthGrowthSlide(): void {
    const s = this.pptx.addSlide();
    s.background = { fill: "FFFFFF" };

    s.addShape(this.pptx.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.7, fill: { color: "1A1A2E" },
    });
    s.addText("財富增長軌跡", {
      x: 0.4, y: 0.1, w: 6, h: 0.5,
      fontSize: 20, fontFace: "Arial", color: "FFFFFF", bold: true,
    });

    const allYears = this.data.benefit_illustration;
    const chartYears = allYears.filter((r) => r.policy_year <= 30);

    if (chartYears.length < 2) {
      s.addText("數據不足", { x: 1, y: 2, w: 8, h: 0.5, fontSize: 14, color: "999999" });
      return;
    }

    const labels = chartYears.map((r) => `Y${r.policy_year}`);
    const totalData = chartYears.map((r) => r.total_surrender_value);

    // Line chart for total surrender value
    s.addChart(this.pptx.ChartType.line, [
      { name: "退保發還總額", labels, values: totalData },
    ], {
      x: 0.3, y: 0.85, w: 9.4, h: 3.0,
      lineSize: 3,
      chartColors: ["1A73E8"],
      catAxisLabelFontSize: 8,
      valAxisLabelFontSize: 9,
      valAxisLabelFormat: "#,##0",
      showLegend: false,
      showMarker: true,
      markerSize: 5,
    });

    // Highlight key milestones
    const milestones = [5, 10, 15, 20, 25, 30];
    const yearMap = new Map(allYears.map((r) => [r.policy_year, r]));
    const totalPrem = Math.max(...allYears.map((r) => r.total_premium_paid));

    const milestoneText = milestones
      .map((y) => {
        const r = yearMap.get(y);
        if (!r) return null;
        const mult = totalPrem > 0 ? (r.total_surrender_value / totalPrem).toFixed(1) : "-";
        return `Y${y}: $${this.formatShort(r.total_surrender_value)} (${mult}x)`;
      })
      .filter(Boolean)
      .join("    ");

    s.addText(`📈 ${milestoneText}`, {
      x: 0.4, y: 4.0, w: 9.2, h: 0.7,
      fontSize: 12, fontFace: "Arial", color: "444444",
      lineSpacingMultiple: 1.3,
    });

    // Source note
    s.addText("* 以上數據包含保證及非保證部分，非保證部分由保險公司投資回報決定", {
      x: 0.4, y: 4.8, w: 9.2, h: 0.4,
      fontSize: 9, fontFace: "Arial", color: "999999",
    });
  }

  // ─── Slide 4: 关键数据表 ──────────────────────────
  private addKeyTableSlide(): void {
    const s = this.pptx.addSlide();
    s.background = { fill: "FFFFFF" };

    s.addShape(this.pptx.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.7, fill: { color: "1A1A2E" },
    });
    s.addText("關鍵年度利益演示", {
      x: 0.4, y: 0.1, w: 6, h: 0.5,
      fontSize: 20, fontFace: "Arial", color: "FFFFFF", bold: true,
    });

    const keyYears = [1, 3, 5, 7, 10, 15, 20, 25, 30];
    const yearMap = new Map<number, YearlyBenefitRow>();
    for (const row of this.data.benefit_illustration) {
      yearMap.set(row.policy_year, row);
    }

    const avail = keyYears.filter((y) => yearMap.has(y));
    if (!avail.length) {
      s.addText("無數據", { x: 1, y: 2, w: 8, h: 0.5, fontSize: 14, color: "999999" });
      return;
    }

    const totalPrem = Math.max(...this.data.benefit_illustration.map((r) => r.total_premium_paid));
    const hdr = {
      fontSize: 11, fontFace: "Arial", bold: true,
      color: "FFFFFF", fill: { color: "1A1A2E" },
      align: "center" as const, valign: "middle" as const,
    };
    const cell = {
      fontSize: 11, fontFace: "Arial",
      align: "center" as const, valign: "middle" as const,
    };

    const rows = [
      [
        { text: "年度", options: hdr },
        { text: "已繳保費", options: hdr },
        { text: "保證金額", options: hdr },
        { text: "非保證", options: hdr },
        { text: "退保總額", options: hdr },
        { text: "總額/保費", options: hdr },
      ],
      ...avail.map((year) => {
        const r = yearMap.get(year)!;
        const nonG = r.reversionary_bonus + r.terminal_dividend;
        const mult = totalPrem > 0 ? (r.total_surrender_value / totalPrem).toFixed(1) : "-";
        return [
          { text: `Y${year}`, options: { ...cell, bold: true, color: "1A1A2E" } },
          { text: `$${this.formatShort(r.total_premium_paid)}`, options: { ...cell, color: "666666" } },
          { text: `$${this.formatShort(r.guaranteed_cash_value)}`, options: { ...cell, color: "1A73E8" } },
          { text: `$${this.formatShort(nonG)}`, options: { ...cell, color: "E37400" } },
          { text: `$${this.formatShort(r.total_surrender_value)}`, options: { ...cell, bold: true, color: "0D7C3F" } },
          { text: `${mult}x`, options: { ...cell, color: "0D7C3F" } },
        ];
      }),
    ];

    s.addTable(rows, {
      x: 0.3, y: 0.9, w: 9.4,
      colW: [1.0, 1.6, 1.6, 1.6, 1.8, 1.2],
      rowH: 0.35,
      border: { type: "solid", pt: 0.5, color: "E0E0E0" },
      autoPage: false,
    });

    // Color legend
    s.addText("🔵 保證金額  🟠 非保證金額（復歸紅利+終期分紅）  🟢 退保發還總額", {
      x: 0.4, y: 4.6, w: 9.2, h: 0.35,
      fontSize: 10, fontFace: "Arial", color: "888888",
    });
  }

  // ─── Slide 5: 翻倍倍数分析 ────────────────────────
  private addMultiplesSlide(): void {
    const s = this.pptx.addSlide();
    s.background = { fill: "FFFFFF" };

    s.addShape(this.pptx.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.7, fill: { color: "1A1A2E" },
    });
    s.addText("財富增長倍數", {
      x: 0.4, y: 0.1, w: 6, h: 0.5,
      fontSize: 20, fontFace: "Arial", color: "FFFFFF", bold: true,
    });

    const allYears = this.data.benefit_illustration;
    const totalPrem = Math.max(...allYears.map((r) => r.total_premium_paid));
    if (totalPrem === 0) return;

    // Years 1-30 for the chart
    const chartData = allYears.filter((r) => r.policy_year >= 1 && r.policy_year <= 30);
    if (chartData.length < 2) return;

    const labels = chartData.map((r) => `${r.policy_year}`);
    const multiples = chartData.map((r) => parseFloat((r.total_surrender_value / totalPrem).toFixed(2)));

    s.addChart(this.pptx.ChartType.bar, [
      { name: "倍數", labels, values: multiples },
    ], {
      x: 0.3, y: 0.85, w: 9.4, h: 3.2,
      barGrouping: "clustered",
      barDir: "col",
      chartColors: ["1A73E8"],
      catAxisLabelFontSize: 8,
      valAxisLabelFontSize: 9,
      valAxisLabelFormat: "0.0x",
      showLegend: false,
      showValue: true,
      dataLabelFormatCode: "0.0x",
      dataLabelFontSize: 8,
    });

    // Key multiples text
    const milestones = chartData
      .filter((r) => [5, 10, 15, 20, 25, 30].includes(r.policy_year))
      .map(
        (r) =>
          `Y${r.policy_year}: ${(r.total_surrender_value / totalPrem).toFixed(1)}x ($${this.formatShort(r.total_surrender_value)})`
      )
      .join("  →  ");

    s.addText(`📊 投入 ${this.formatShort(totalPrem)}   →   ${milestones}`, {
      x: 0.4, y: 4.2, w: 9.2, h: 0.7,
      fontSize: 12, fontFace: "Arial", color: "444444",
    });

    const lastRow = allYears[allYears.length - 1];
    const finalMult = totalPrem > 0 ? (lastRow?.total_surrender_value ?? 0) / totalPrem : 0;
    const finalVal = lastRow?.total_surrender_value ?? 0;

    // Create a highlight box for the final multiple
    s.addShape(this.pptx.ShapeType.roundRect, {
      x: 6.5, y: 4.4, w: 3.0, h: 0.8,
      fill: { color: "E8F5E9" },
      rectRadius: 6,
    });
    s.addText(`💰 期末 $${this.formatShort(totalPrem)} → $${this.formatShort(finalVal)} (${finalMult.toFixed(1)}x)`, {
      x: 6.6, y: 4.5, w: 2.8, h: 0.6,
      fontSize: 11, fontFace: "Arial", color: "0D7C3F", bold: true, align: "center",
    });
  }

  // ─── Slide 6: 回本分析 ────────────────────────────
  private addBreakevenSlide(): void {
    const s = this.pptx.addSlide();
    s.background = { fill: "FFFFFF" };

    s.addShape(this.pptx.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.7, fill: { color: "1A1A2E" },
    });
    s.addText("回本分析與現金流", {
      x: 0.4, y: 0.1, w: 6, h: 0.5,
      fontSize: 20, fontFace: "Arial", color: "FFFFFF", bold: true,
    });

    const allYears = this.data.benefit_illustration;
    const yearMap = new Map(allYears.map((r) => [r.policy_year, r]));
    const totalPrem = Math.max(...allYears.map((r) => r.total_premium_paid));

    // Find breakeven
    let breakeven: number | null = null;
    let breakevenRow: YearlyBenefitRow | null = null;
    for (const r of allYears) {
      if (r.total_surrender_value >= r.total_premium_paid && r.policy_year > 2) {
        breakeven = r.policy_year;
        breakevenRow = r;
        break;
      }
    }

    // Chart: premium vs total surrender value
    const chartYears = allYears.filter((r) => r.policy_year <= 30);
    if (chartYears.length >= 2) {
      const labels = chartYears.map((r) => `Y${r.policy_year}`);
      const premiumLine = chartYears.map((r) => r.total_premium_paid);
      const totalLine = chartYears.map((r) => r.total_surrender_value);

      s.addChart(this.pptx.ChartType.line, [
        { name: "已繳保費", labels, values: premiumLine },
        { name: "退保總額", labels, values: totalLine },
      ], {
        x: 0.3, y: 0.85, w: 5.5, h: 3.5,
        lineSize: [2, 3],
        chartColors: ["E37400", "1A73E8"],
        catAxisLabelFontSize: 7,
        valAxisLabelFontSize: 8,
        valAxisLabelFormat: "#,##0",
        showLegend: true,
        legendPos: "b",
        legendFontSize: 9,
        showMarker: true,
        markerSize: [3, 5],
      });
    }

    // Right side: breakeven analysis
    const lastRow = allYears[allYears.length - 1];
    const finalValue = lastRow?.total_surrender_value ?? 0;
    const finalMultiple = totalPrem > 0 ? finalValue / totalPrem : 0;

    s.addShape(this.pptx.ShapeType.roundRect, {
      x: 6.0, y: 0.95, w: 3.6, h: 3.5,
      fill: { color: "F8F9FA" },
      rectRadius: 8,
    });

    let analysisContent = "";
    if (breakeven && breakevenRow) {
      analysisContent += `**回本年度**\nY${breakeven}\n\n`;
      analysisContent += `保單第${breakeven}年，退保總額\n$${this.formatShort(breakevenRow.total_surrender_value)}\n超過已繳保費。\n\n`;
    }
    analysisContent += `**投入與回報對比**\n`;
    analysisContent += `總投入: $${this.formatShort(totalPrem)}\n`;
    analysisContent += `期末總值: $${this.formatShort(finalValue)}\n`;
    analysisContent += `增長倍數: ${finalMultiple.toFixed(1)}x`;

    s.addText(analysisContent, {
      x: 6.2, y: 1.1, w: 3.2, h: 3.2,
      fontSize: 13, fontFace: "Arial", color: "333333",
      lineSpacingMultiple: 1.6, valign: "top",
    });

    // Bottom insight
    const si = this.data.sales_insights;
    if (si?.suggested_narrative) {
      s.addText(`💡 ${si.suggested_narrative}`, {
        x: 0.4, y: 4.6, w: 9.2, h: 0.5,
        fontSize: 12, fontFace: "Arial", color: this.config.accentColor,
      });
    }
  }

  // ─── Slide 7: Closing ─────────────────────────────
  private addClosingSlide(): void {
    const s = this.pptx.addSlide();
    s.background = { fill: this.config.brandColor };

    s.addText("謝謝", {
      x: 0.5, y: 1.5, w: 9, h: 1.0,
      fontSize: 42, fontFace: "Arial", color: "FFFFFF", bold: true, align: "center",
    });

    const name = this.config.customerName || this.data.insured.name || "尊貴客戶";
    s.addText(`期待為${name}提供專業服務`, {
      x: 0.5, y: 2.6, w: 9, h: 0.6,
      fontSize: 18, fontFace: "Arial", color: "90CAF9", align: "center",
    });

    s.addShape(this.pptx.ShapeType.rect, {
      x: 4.2, y: 3.5, w: 1.6, h: 0.04, fill: { color: this.config.accentColor },
    });

    const disclaimers = [
      "本文件僅供參考，不構成要約或建議。",
      "非保證金額並非保證，實際可能高於或低於預期。",
      `數據來源: ${this.data.product_name} 官方計劃書。`,
      `生成日期: ${new Date().toISOString().split("T")[0]}`,
    ];

    s.addText(disclaimers.join("\n\n"), {
      x: 0.5, y: 3.8, w: 9, h: 1.2,
      fontSize: 10, fontFace: "Arial", color: "667788",
      align: "center", lineSpacingMultiple: 1.4,
    });
  }

  // ─── Helpers ───────────────────────────────────────
  protected formatShort(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return n.toLocaleString("en-US");
    return n.toString();
  }
}

export async function generateSavingsPpt(
  data: SavingsPlanExtraction,
  outputPath: string,
  config?: Partial<PptConfig>
): Promise<void> {
  const gen = new SavingsPlanPptGenerator(data, config);
  await gen.generate(outputPath);
}
