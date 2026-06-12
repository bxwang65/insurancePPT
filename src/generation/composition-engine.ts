// @ts-nocheck
// Legacy fallback generator. Formal API exports no longer call this module.
import PptxGenJS from "pptxgenjs";
import fs from "fs";
import type { SavingsPlanExtraction, YearlyBenefitRow } from "../schemas/savings-plan.ts";
import type { CiPlanExtraction } from "../schemas/critical-illness.ts";
import type { IulExtraction } from "../schemas/iul.ts";

type PlanData = SavingsPlanExtraction | CiPlanExtraction | IulExtraction;

interface CompositionInput {
  extractions: { pdfName: string; planType: string; data: PlanData }[];
  customerName?: string;
  brandColor?: string;
  accentColor?: string;
  companyInfo?: string;
  title?: string;
  /** Path to AI-generated cover image */
  coverImagePath?: string;
}

export class CompositionEngine {
  protected pptx: PptxGenJS;
  protected input: CompositionInput;
  protected brand: string;
  protected accent: string;
  protected lightBg: string;

  constructor(input: CompositionInput) {
    this.pptx = new PptxGenJS();
    this.pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 }); // 16:9 HD
    this.pptx.layout = "WIDE";
    this.input = input;
    this.brand = input.brandColor || "0A1628";
    this.accent = input.accentColor || "1A73E8";
    this.lightBg = "F0F4FF";
  }

  async generate(outputPath: string): Promise<void> {
    const types = this.input.extractions.map((e) => e.planType);
    const hasAll = new Set(types).size > 1;

    this.addCover();

    if (this.input.companyInfo) this.addCompanyIntro();

    if (hasAll) this.addOverview();

    if (types.includes("ci")) {
      for (const e of this.input.extractions) {
        if (e.planType === "ci") this.addCiSlides(e.data as CiPlanExtraction);
      }
    }
    if (types.includes("iul")) {
      for (const e of this.input.extractions) {
        if (e.planType === "iul") this.addIulSlides(e.data as IulExtraction);
      }
    }
    if (types.includes("savings")) {
      for (const e of this.input.extractions) {
        if (e.planType === "savings") this.addSavingsSlides(e.data as SavingsPlanExtraction);
      }
    }

    this.addClosing();
    await this.pptx.writeFile({ fileName: outputPath });
  }

  // ─── Slide helpers ────────────────────────────────
  protected addSlideHeader(slide: any, title: string, subtitle?: string): void {
    // Top bar
    slide.addShape(this.pptx.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 0.08, fill: { color: this.accent },
    });
    // Header background
    slide.addShape(this.pptx.ShapeType.rect, {
      x: 0, y: 0.08, w: 13.33, h: 0.85, fill: { color: this.brand },
    });
    // Title text
    slide.addText(title, {
      x: 0.6, y: 0.15, w: 10, h: 0.65,
      fontSize: 22, fontFace: "Arial", color: "FFFFFF", bold: true,
    });
    // Left accent bar
    slide.addShape(this.pptx.ShapeType.rect, {
      x: 0.3, y: 1.1, w: 0.05, h: 5.8, fill: { color: this.accent, transparency: 70 },
    });
    if (subtitle) {
      slide.addText(subtitle, {
        x: 0.6, y: 0.85, w: 10, h: 0.3,
        fontSize: 10, fontFace: "Arial", color: "90CAF9",
      });
    }
  }

  protected addCard(slide: any, x: number, y: number, w: number, h: number, color: string = "FFFFFF"): void {
    slide.addShape(this.pptx.ShapeType.roundRect, {
      x, y, w, h, fill: { color }, rectRadius: 6,
      shadow: { type: "outer", blur: 4, offset: 2, color: "000000", opacity: 0.08 },
    });
  }

  protected fmt(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return n.toLocaleString("en-US");
    return n.toString();
  }

  // ─── Cover ────────────────────────────────────────
  private addCover(): void {
    const s = this.pptx.addSlide();

    // Use AI-generated cover image if available
    if (this.input.coverImagePath && fs.existsSync(this.input.coverImagePath)) {
      s.background = { data: fs.readFileSync(this.input.coverImagePath).buffer as ArrayBuffer };
    } else {
      s.background = { fill: this.brand };
      // Decorative circles as fallback
      s.addShape(this.pptx.ShapeType.ellipse, {
        x: 9.5, y: -2, w: 6, h: 6, fill: { color: "FFFFFF", transparency: 95 },
      });
      s.addShape(this.pptx.ShapeType.ellipse, {
        x: -2, y: 4, w: 5, h: 5, fill: { color: "FFFFFF", transparency: 95 },
      });
    }

    const name = this.input.customerName || "尊貴客戶";
    const title = this.input.title || "家庭保障與財富方案";

    s.addText(name, {
      x: 0.8, y: 1.5, w: 11, h: 1.0,
      fontSize: 42, fontFace: "Arial", color: "FFFFFF", bold: true,
    });
    s.addText(title, {
      x: 0.8, y: 2.6, w: 11, h: 0.7,
      fontSize: 24, fontFace: "Arial", color: "90CAF9",
    });

    // Accent line
    s.addShape(this.pptx.ShapeType.rect, {
      x: 0.8, y: 3.4, w: 3, h: 0.04, fill: { color: this.accent },
    });

    // Plan type badges
    const badges = [...new Set(this.input.extractions.map((e) => e.planType))];
    const badgeStr = badges.map((t) =>
      t === "ci" ? "🛡️ 危疾保障" : t === "savings" ? "💰 財富增值" : "📈 IUL 傳承"
    ).join("  |  ");
    s.addText(badgeStr, {
      x: 0.8, y: 3.7, w: 11, h: 0.4,
      fontSize: 13, fontFace: "Arial", color: "667788",
    });

    // Metric cards
    const metrics: { label: string; value: string }[] = [];
    for (const e of this.input.extractions) {
      const d = e.data;
      if (!d || !d.policy) continue;
      if (e.planType === "savings") {
        metrics.push({ label: "年繳", value: `$${this.fmt(d.policy.annual_premium)}` });
        const premArr = (d.benefit_illustration || []).map((r: any) => r?.total_premium_paid ?? 0);
        const prem = premArr.length > 0 ? Math.max(...premArr) : 0;
        metrics.push({ label: "總投入", value: `$${this.fmt(prem)}` });
      } else if (e.planType === "ci") {
        metrics.push({ label: "危疾保額", value: `$${this.fmt(d.policy.sum_insured || 0)}` });
      } else if (e.planType === "iul") {
        metrics.push({ label: "身故保障", value: `$${this.fmt(d.policy.sum_insured || 0)}` });
        const prem = d.policy.initial_premium || 0;
        const lev = prem > 0 ? ((d.policy.sum_insured || 0) / prem).toFixed(1) : "-";
        metrics.push({ label: "槓桿倍數", value: `${lev}x` });
      }
    }

    metrics.slice(0, 4).forEach((m, i) => {
      const bx = 0.8 + i * 3.0;
      this.addCard(s, bx, 4.3, 2.6, 1.3, "FFFFFF");
      s.addText(m.value, {
        x: bx, y: 4.4, w: 2.6, h: 0.7,
        fontSize: 20, fontFace: "Arial", color: this.brand, bold: true, align: "center",
      });
      s.addText(m.label, {
        x: bx, y: 5.1, w: 2.6, h: 0.4,
        fontSize: 11, fontFace: "Arial", color: "888888", align: "center",
      });
    });

    s.addText(`方案生成: ${new Date().toISOString().split("T")[0]}`, {
      x: 0.8, y: 6.8, w: 5, h: 0.3,
      fontSize: 10, fontFace: "Arial", color: "556677",
    });
  }

  // ─── Company Intro ────────────────────────────────
  private addCompanyIntro(): void {
    const s = this.pptx.addSlide();
    s.background = { fill: "FFFFFF" };
    this.addSlideHeader(s, "🏢 承保公司介紹");

    this.addCard(s, 0.6, 1.3, 12, 5.3);
    s.addText(this.input.companyInfo || "", {
      x: 1.0, y: 1.6, w: 11.3, h: 4.7,
      fontSize: 14, fontFace: "Arial", color: "444444",
      lineSpacingMultiple: 1.6, valign: "top",
    });
  }

  // ─── Overview ─────────────────────────────────────
  private addOverview(): void {
    const s = this.pptx.addSlide();
    s.background = { fill: "FFFFFF" };
    this.addSlideHeader(s, "🏛️ 綜合方案總覽", "從保障到傳承，三層架構層層遞進");

    const layers = [
      { type: "ci", icon: "🛡️", title: "風險防護層", desc: "危疾保障，抵禦健康風險" },
      { type: "savings", icon: "💰", title: "財富累積層", desc: "儲蓄增值，長期複利增長" },
      { type: "iul", icon: "📈", title: "傳承規劃層", desc: "高槓桿傳承，指數增長" },
    ];

    const avail = layers.filter((l) => this.input.extractions.some((e) => e.planType === l.type));
    avail.forEach((l, i) => {
      const by = 1.3 + i * 1.7;
      const plan = this.input.extractions.find((e) => e.planType === l.type);
      this.addCard(s, 0.6, by, 12, 1.4, i % 2 === 0 ? "F0F4FF" : "FFF8E1");
      s.addText(`${l.icon} ${l.title}`, {
        x: 1.0, y: by + 0.1, w: 4, h: 0.5,
        fontSize: 18, fontFace: "Arial", color: "1A1A2E", bold: true,
      });
      s.addText(l.desc, {
        x: 1.0, y: by + 0.6, w: 5, h: 0.4,
        fontSize: 13, fontFace: "Arial", color: "666666",
      });
      if (plan) {
        s.addText(`➜ ${plan.data.product_name}`, {
          x: 6, y: by + 0.3, w: 6, h: 0.6,
          fontSize: 14, fontFace: "Arial", color: this.accent, align: "right", valign: "middle",
        });
      }
      // Arrow connecting layers
      if (i < avail.length - 1) {
        s.addText("⬇", {
          x: 6, y: by + 1.2, w: 0.6, h: 0.4,
          fontSize: 14, fontFace: "Arial", color: "CCCCCC", align: "center",
        });
      }
    });

    s.addText("從健康保障到財富累積，再到資產傳承，構建全方位家庭安全網", {
      x: 0.6, y: 6.5, w: 12, h: 0.5,
      fontSize: 12, fontFace: "Arial", color: "999999", align: "center",
    });
  }

  // ─── CI Slides ────────────────────────────────────
  private addCiSlides(d: CiPlanExtraction): void {
    const s = this.pptx.addSlide();
    s.background = { fill: "FFFFFF" };
    this.addSlideHeader(s, "🛡️ 危疾保障範圍", `${d.product_name}`);

    const items = d.coverage_items || [];
    const half = Math.ceil(items.length / 2);
    const makeCol = (col: typeof items, cx: number) => {
      col.forEach((item, i) => {
        this.addCard(s, cx, 1.2 + i * 0.55, 6, 0.45, "F8F9FA");
        s.addText(item.name, {
          x: cx + 0.2, y: 1.22 + i * 0.55, w: 4, h: 0.4,
          fontSize: 12, fontFace: "Arial", color: "333333", valign: "middle",
        });
        if (item.amount) {
          s.addText(`$${this.fmt(item.amount)}`, {
            x: cx + 4.3, y: 1.22 + i * 0.55, w: 1.5, h: 0.4,
            fontSize: 12, fontFace: "Arial", color: this.accent, bold: true, align: "right", valign: "middle",
          });
        }
      });
    };

    makeCol(items.slice(0, half), 0.6);
    makeCol(items.slice(half), 6.8);

    // Premium & coverage summary
    const p = d.policy;
    const si = d.sales_insights;
    let summaryY = 1.2 + Math.max(half, items.length - half) * 0.55 + 0.2;
    if (summaryY < 6) {
      s.addShape(this.pptx.ShapeType.roundRect, {
        x: 0.6, y: summaryY, w: 12, h: 1.0, fill: { color: "FFF8E1" }, rectRadius: 6,
      });
      let txt = `💰 年繳保費: $${this.fmt(p.annual_premium)} | 繳費${p.premium_payment_period} | 保障至${p.coverage_period}`;
      if (d.multi_claim?.length) {
        txt += `\n🔄 多次賠付: ${d.multi_claim.slice(0, 3).map((m) => `${m.condition}(${m.claim_count}次)`).join(" | ")}`;
      }
      if (si?.key_selling_points?.length) {
        txt += `\n⭐ ${si.key_selling_points.slice(0, 2).join(" | ")}`;
      }
      s.addText(txt, {
        x: 1.0, y: summaryY + 0.1, w: 11.3, h: 0.8,
        fontSize: 12, fontFace: "Arial", color: "555555", lineSpacingMultiple: 1.4,
      });
    }
  }

  // ─── IUL Slides ───────────────────────────────────
  private addIulSlides(d: IulExtraction): void {
    // Overview
    const s1 = this.pptx.addSlide();
    s1.background = { fill: "FFFFFF" };
    this.addSlideHeader(s1, "📈 IUL 方案概覽", d.product_name);

    let ctx = `**受保人**: ${d.insured.name} | ${d.insured.age ?? "?"}歲\n`;
    ctx += `**保障金額**: $${this.fmt(d.policy.sum_insured ?? 0)}\n`;
    ctx += `**首年保費**: $${this.fmt(d.policy.initial_premium ?? 0)}\n`;
    ctx += `**繳付**: ${d.policy.premium_payment_period} | 保障${d.policy.coverage_period}\n`;
    if (d.policy.day_1_cash_value) ctx += `**首日現金價值**: $${this.fmt(d.policy.day_1_cash_value)}\n`;

    const lev = d.policy.initial_premium && d.policy.initial_premium > 0
      ? ((d.policy.sum_insured ?? 0) / d.policy.initial_premium).toFixed(1) : "-";
    ctx += `\n**🏆 槓桿比率: ${lev}x** — 僅需繳付 $${this.fmt(d.policy.initial_premium ?? 0)}，即可獲得 $${this.fmt(d.policy.sum_insured ?? 0)} 的身故保障\n`;

    if (d.index_accounts?.length) {
      ctx += `\n**指數帳戶配置**:\n${d.index_accounts.map((a) => `• ${a.name}: ${a.allocation}%${a.current_assumed_rate ? ` (利率 ${a.current_assumed_rate})` : ""}`).join("\n")}`;
    }

    if (d.sales_insights?.key_selling_points?.length) {
      ctx += `\n\n⭐ ${d.sales_insights.key_selling_points.slice(0, 3).map((p) => `• ${p}`).join("\n")}`;
    }

    this.addCard(s1, 0.6, 1.3, 12, 5.3);
    s1.addText(ctx, {
      x: 1.0, y: 1.6, w: 11.3, h: 4.7,
      fontSize: 13, fontFace: "Arial", color: "444444", lineSpacingMultiple: 1.5, valign: "top",
    });

    // Growth chart
    const s2 = this.pptx.addSlide();
    s2.background = { fill: "FFFFFF" };
    this.addSlideHeader(s2, "📈 IUL 帳戶價值增長趨勢");

    const years = d.benefit_illustration?.filter((r) => r.policy_year <= 30) || [];
    if (years.length >= 2) {
      s2.addChart(this.pptx.ChartType.line, [
        { name: "帳戶價值(非保證)", labels: years.map((r) => `Y${r.policy_year}`), values: years.map((r) => r.non_guaranteed_account_value ?? 0) },
        { name: "現金價值(非保證)", labels: years.map((r) => `Y${r.policy_year}`), values: years.map((r) => r.non_guaranteed_cash_value ?? 0) },
      ], {
        x: 0.6, y: 1.2, w: 8, h: 4.5,
        lineSize: [3, 2], chartColors: ["1A73E8", "FF8C00"],
        catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, valAxisLabelFormat: "#,##0",
        showLegend: true, legendPos: "b", legendFontSize: 10, showMarker: true, markerSize: [5, 5],
      });

      // Leverage card
      this.addCard(s2, 9.0, 1.2, 3.8, 2.5);
      s2.addText(`🛡️ **身故保障**\n$${this.fmt(d.policy.sum_insured ?? 0)}\n\n📊 **槓桿倍數**\n${lev}x`, {
        x: 9.3, y: 1.4, w: 3.2, h: 2.2,
        fontSize: 14, fontFace: "Arial", color: "333333", lineSpacingMultiple: 1.5, valign: "top",
      });

      // Key values
      const ms = [5, 10, 15, 20, 25, 30]
        .map((y) => { const r = years.find((r) => r.policy_year === y); return r ? `Y${y}: $${this.fmt(r.non_guaranteed_account_value ?? 0)}` : null; })
        .filter(Boolean).join("    ");
      this.addCard(s2, 0.6, 5.9, 12.3, 0.7);
      s2.addText(`📈 ${ms}`, { x: 1.0, y: 6.0, w: 11.6, h: 0.5, fontSize: 11, fontFace: "Arial", color: "444444" });
    }
  }

  // ─── Savings Slides ──────────────────────────────
  private addSavingsSlides(d: SavingsPlanExtraction): void {
    // Overview
    const s1 = this.pptx.addSlide();
    s1.background = { fill: "FFFFFF" };
    this.addSlideHeader(s1, "💰 儲蓄方案詳解", d.product_name);
    const si = d.sales_insights;

    let txt = `**受保人**: ${d.insured.name} | ${d.insured.age ?? "?"}歲\n`;
    txt += `**年繳保費**: $${this.fmt(d.policy.annual_premium)} | 繳費${d.policy.premium_payment_period} | 保障${d.policy.coverage_period}\n`;
    if (si?.target_customer) txt += `\n🎯 ${si.target_customer}\n`;
    if (si?.key_selling_points?.length) txt += `\n⭐ ${si.key_selling_points.slice(0, 3).map((p) => `• ${p}`).join("\n")}`;

    // Breakeven
    let be: number | null = null;
    for (const r of d.benefit_illustration) {
      if (r.total_surrender_value >= r.total_premium_paid && r.policy_year > 2) { be = r.policy_year; break; }
    }
    if (be) txt += `\n\n**📊 預期回本**: 第${be}年`;

    this.addCard(s1, 0.6, 1.3, 12, 4.5);
    s1.addText(txt, {
      x: 1.0, y: 1.6, w: 11.3, h: 4.0,
      fontSize: 13, fontFace: "Arial", color: "444444", lineSpacingMultiple: 1.5, valign: "top",
    });

    // Growth chart
    const s2 = this.pptx.addSlide();
    s2.background = { fill: "FFFFFF" };
    this.addSlideHeader(s2, "💰 財富增長軌跡");

    const cd = d.benefit_illustration.filter((r) => r.policy_year <= 30);
    if (cd.length >= 2) {
      const premLine = cd.map((r) => r.total_premium_paid);
      const totalLine = cd.map((r) => r.total_surrender_value);
      const labels = cd.map((r) => `Y${r.policy_year}`);

      s2.addChart(this.pptx.ChartType.line, [
        { name: "已繳保費", labels, values: premLine },
        { name: "退保總額", labels, values: totalLine },
      ], {
        x: 0.6, y: 1.3, w: 8.5, h: 4.5,
        lineSize: [2, 3], chartColors: ["E37400", "1A73E8"],
        catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, valAxisLabelFormat: "#,##0",
        showLegend: true, legendPos: "b", legendFontSize: 10, showMarker: true, markerSize: [4, 6],
      });

      // Breakeven card
      this.addCard(s2, 9.3, 1.3, 3.5, 2.5);
      const totalPrem = Math.max(...d.benefit_illustration.map((r) => r.total_premium_paid));
      const last = d.benefit_illustration[d.benefit_illustration.length - 1];
      s2.addText(
        `📊 **回本分析**\n\n${be ? `回本年度: **Y${be}**\n` : ""}總投入: $${this.fmt(totalPrem)}\n末期總值: $${this.fmt(last?.total_surrender_value ?? 0)}\n增長: **${totalPrem > 0 ? ((last?.total_surrender_value ?? 0) / totalPrem).toFixed(1) : "-"}x**`,
        { x: 9.5, y: 1.5, w: 3.1, h: 2.2, fontSize: 13, fontFace: "Arial", color: "333333", lineSpacingMultiple: 1.5, valign: "top" }
      );

      // Milestones
      const totalP = Math.max(...d.benefit_illustration.map((r) => r.total_premium_paid));
      const ms = [5, 10, 15, 20, 25, 30]
        .map((y) => { const r = cd.find((r) => r.policy_year === y); return r ? `Y${y}: $${this.fmt(r.total_surrender_value)} (${totalP > 0 ? (r.total_surrender_value / totalP).toFixed(1) : "-"}x)` : null; })
        .filter(Boolean).join("    ");
      this.addCard(s2, 0.6, 6.0, 12.3, 0.7);
      s2.addText(`📈 ${ms}`, { x: 1.0, y: 6.1, w: 11.6, h: 0.5, fontSize: 11, fontFace: "Arial", color: "444444" });
    }

    // Key table
    const s3 = this.pptx.addSlide();
    s3.background = { fill: "FFFFFF" };
    this.addSlideHeader(s3, "📊 關鍵年度數據");
    this.addSavingsTable(s3, d);

    // Withdrawal comparison
    if (d.withdrawal_illustration?.length) {
      this.addWithdrawalSlide(d);
    }
  }

  private addSavingsTable(s: any, d: SavingsPlanExtraction): void {
    const ky = [1, 3, 5, 7, 10, 15, 20, 25, 30];
    const ym = new Map(d.benefit_illustration.map((r) => [r.policy_year, r]));
    const avail = ky.filter((y) => ym.has(y));
    if (!avail.length) return;

    const totalPrem = Math.max(...d.benefit_illustration.map((r) => r.total_premium_paid));
    const hdr = { fontSize: 11, fontFace: "Arial", bold: true, color: "FFFFFF", fill: { color: this.brand }, align: "center" as const, valign: "middle" as const };
    const cel = { fontSize: 11, fontFace: "Arial", align: "center" as const, valign: "middle" as const };
    const celAlt = { ...cel, fill: { color: "F5F7FA" } };

    const rows = [
      [{ text: "年度", options: hdr }, { text: "已繳保費", options: hdr }, { text: "保證金額", options: hdr }, { text: "非保證", options: hdr }, { text: "退保總額", options: hdr }, { text: "倍數", options: hdr }],
      ...avail.map((y, i) => {
        const r = ym.get(y)!;
        const isAlt = i % 2 === 0;
        return [
          { text: `Y${y}`, options: { ...(isAlt ? celAlt : cel), bold: true, color: "1A1A2E" } },
          { text: `$${this.fmt(r.total_premium_paid)}`, options: { ...(isAlt ? celAlt : cel), color: "666666" } },
          { text: `$${this.fmt(r.guaranteed_cash_value)}`, options: { ...(isAlt ? celAlt : cel), color: "1A73E8" } },
          { text: `$${this.fmt(r.reversionary_bonus + r.terminal_dividend)}`, options: { ...(isAlt ? celAlt : cel), color: "E37400" } },
          { text: `$${this.fmt(r.total_surrender_value)}`, options: { ...(isAlt ? celAlt : cel), bold: true, color: "0D7C3F" } },
          { text: `${totalPrem > 0 ? (r.total_surrender_value / totalPrem).toFixed(1) : "-"}x`, options: { ...(isAlt ? celAlt : cel), color: "0D7C3F" } },
        ];
      }),
    ];

    s.addTable(rows, {
      x: 0.6, y: 1.3, w: 12.2,
      colW: [1.2, 2.2, 2.2, 2.2, 2.2, 1.5],
      rowH: 0.42,
      border: { type: "solid", pt: 0.5, color: "E0E0E0" },
      autoPage: false,
    });
  }

  private addWithdrawalSlide(d: SavingsPlanExtraction): void {
    const s = this.pptx.addSlide();
    s.background = { fill: "FFFFFF" };
    this.addSlideHeader(s, "💰 提取 vs 不提取 對比分析");

    const wd = d.withdrawal_illustration!.filter((r) => r.policy_year <= 30);
    const base = d.benefit_illustration.filter((r) => r.policy_year <= 30);
    const baseMap = new Map(base.map((r) => [r.policy_year, r]));
    const common = wd.map((r) => r.policy_year).filter((y) => baseMap.has(y));

    if (common.length >= 2) {
      s.addChart(this.pptx.ChartType.line, [
        { name: "不提取(退保總額)", labels: common.map((y) => `Y${y}`), values: common.map((y) => baseMap.get(y)!.total_surrender_value) },
        { name: "提取後剩餘", labels: common.map((y) => `Y${y}`), values: common.map((y) => wd.find((w) => w.policy_year === y)?.surrender_value_after ?? 0) },
      ], {
        x: 0.6, y: 1.3, w: 12.2, h: 3.5,
        lineSize: [3, 3], chartColors: ["1A73E8", "FF8C00"],
        catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, valAxisLabelFormat: "#,##0",
        showLegend: true, legendPos: "b", legendFontSize: 10, showMarker: true, markerSize: [5, 5],
      });

      // Comparison table
      const wy = [5, 10, 15, 20].filter((y) => common.includes(y));
      const hdr = { fontSize: 10, fontFace: "Arial", bold: true, color: "FFFFFF", fill: { color: this.brand }, align: "center" as const };
      const cel = { fontSize: 10, fontFace: "Arial", align: "center" as const };

      const rows = [
        [{ text: "年度", options: hdr }, { text: "不提取總額", options: hdr }, { text: "提取後總額", options: hdr }, { text: "累計提取", options: hdr }, { text: "提取+剩餘", options: hdr }],
        ...wy.map((y) => {
          const bv = baseMap.get(y)?.total_surrender_value ?? 0;
          const wr = wd.find((w) => w.policy_year === y)!;
          const total = (wr.surrender_value_after ?? 0) + (wr.total_withdrawn ?? 0);
          return [
            { text: `Y${y}`, options: { ...cel, bold: true } },
            { text: `$${this.fmt(bv)}`, options: { ...cel, color: "1A73E8" } },
            { text: `$${this.fmt(wr.surrender_value_after ?? 0)}`, options: { ...cel, color: "FF8C00" } },
            { text: `$${this.fmt(wr.total_withdrawn ?? 0)}`, options: { ...cel, color: "666666" } },
            { text: `$${this.fmt(total)}`, options: { ...cel, color: "0D7C3F", bold: true } },
          ];
        }),
      ];

      s.addTable(rows, {
        x: 1.5, y: 5.0, w: 10.3, colW: [1.2, 2.3, 2.3, 2.0, 2.5], rowH: 0.4,
        border: { type: "solid", pt: 0.5, color: "E0E0E0" }, autoPage: false,
      });
    }
  }

  // ─── Closing ──────────────────────────────────────
  private addClosing(): void {
    const s = this.pptx.addSlide();
    s.background = { fill: this.brand };

    // Decorative
    s.addShape(this.pptx.ShapeType.ellipse, {
      x: 10, y: -1, w: 5, h: 5, fill: { color: "FFFFFF", transparency: 95 },
    });

    s.addText("謝謝", {
      x: 0.5, y: 2.0, w: 12, h: 1.2,
      fontSize: 48, fontFace: "Arial", color: "FFFFFF", bold: true, align: "center",
    });
    s.addText(`期待為您提供專業服務`, {
      x: 0.5, y: 3.2, w: 12, h: 0.6,
      fontSize: 20, fontFace: "Arial", color: "90CAF9", align: "center",
    });

    s.addShape(this.pptx.ShapeType.rect, {
      x: 5.7, y: 4.0, w: 2, h: 0.04, fill: { color: this.accent },
    });

    s.addText(
      "本文件僅供參考，不構成要約或建議。\n非保證金額並非保證，實際可能高於或低於預期。\n" +
      `生成日期: ${new Date().toISOString().split("T")[0]}`,
      { x: 0.5, y: 4.3, w: 12, h: 1.2, fontSize: 11, fontFace: "Arial", color: "667788", align: "center", lineSpacingMultiple: 1.5 }
    );
  }
}
