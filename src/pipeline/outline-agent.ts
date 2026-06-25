import fs from "fs";
import path from "path";
import { OutlineGenerator } from "../chat/outline-generator.ts";
import type { OutlineArtifact, OutlineSlide, PipelineRequest, TenantBrandConfig } from "./types.ts";

function parseSlides(markdown: string): OutlineSlide[] {
  const blocks = markdown.split(/\n---\n/g);
  const slides: OutlineSlide[] = [];
  let i = 1;
  let coverAssigned = false;
  let companyAssigned = false;
  let tableCount = 0;
  for (const b of blocks) {
    const m = b.match(/^##\s+第\s+\d+\s+页:\s+(.+)$/m) || b.match(/^##\s+(.+)$/m);
    if (!m) continue;
    const title = m[1].trim();
    // 跳过 OutlineGenerator 偶发产出的 "undefined" 占位页 (formal-output-guard 会拒绝)
    if (!title || /^undefined$/i.test(title) || /^第\s*undefined\s*页/.test(title)) continue;
    const lines = b.split("\n").map((x) => x.trim()).filter((x) =>
      x &&
      !x.startsWith("##") &&
      !x.startsWith("**视觉") &&
      !x.startsWith("**图表") &&
      !x.startsWith("**叙事") &&
      !x.includes("视觉风格") &&
      !x.includes("图表类型") &&
      !x.includes("叙事文案") &&
      !x.includes("Gamma") &&
      !x.includes("Stitch")
    );
    const text = `${title} ${lines.join(" ")}`;
    const pageType: OutlineSlide["pageType"] = /封面/.test(title) ? "cover"
      : /公司|机构|评级/.test(text) ? "company"
      : /时间|阶段|里程碑/.test(text) ? "timeline"
      : /图|曲线|趋势|现金流|构成/.test(text) ? "chart"
      : /表/.test(text) ? "table"
      : /建议|结论|执行/.test(text) ? "conclusion"
      : "narrative";
    const visualIntent: OutlineSlide["visualIntent"] = /教育|子女|升学/.test(text) ? "education"
      : /退休|养老|60岁/.test(text) ? "retire"
      : /公司|机构|评级/.test(text) ? "company"
      : /保障|风险/.test(text) ? "shield"
      : /现金流|财富|收益/.test(text) ? "finance"
      : "family";
    const chartIntent: OutlineSlide["chartIntent"] | undefined = /构成|保证|非保证/.test(text) ? "stacked"
      : /现金流|提领/.test(text) ? "cashflow"
      : /增长|回本|曲线|价值/.test(text) ? "growth"
      : undefined;

    // 语义 ID: 验证器 (deck-quality.ts) 要求 cover / company / table-nowithdraw
    // 保持解析简单: 按 pageType 分配语义 ID, 同类型第二张自动加后缀
    let semanticId = `s${i++}`;
    if (pageType === "cover" && !coverAssigned) {
      semanticId = "cover";
      coverAssigned = true;
    } else if (pageType === "company" && !companyAssigned) {
      semanticId = "company";
      companyAssigned = true;
    } else if (pageType === "table") {
      tableCount++;
      semanticId = tableCount === 1 ? "table-nowithdraw" : `table-withdraw${tableCount > 2 ? "-" + tableCount : ""}`;
    }

    slides.push({
      id: semanticId,
      pageType,
      title,
      bullets: lines
        .slice(0, 8)
        .map((x) => x.replace(/^•\s*/, "").replace(/^-\s*/, "").replace(/\*\*/g, "").trim())
        .filter((x) => x.length > 0 && x.length < 80),
      chartIntent,
      visualIntent,
    });
  }
  return slides;
}

export class OutlineAgent {
  async run(req: PipelineRequest, tenant: TenantBrandConfig): Promise<OutlineArtifact> {
    const savings = req.normalizedSavings;
    if (savings) {
      const outDir = path.resolve("outputs", `${req.outputStem || req.sessionId}_pipeline`);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const markdownPath = path.join(outDir, "outline.md");
      const insuredAge = Number(savings?.insured?.age || 30);
      const productName = String(req.savingsMetrics?.productName || savings.productName || "");
      const companyName = req.companyContext?.companyName || tenant.companyName;
      const scenarioTitle = insuredAge < 18 ? "教育金方案（按年龄自动分流）" : "养老金方案（按年龄自动分流）";
      const scenarioBullets = insuredAge < 18
        ? ["目标：18-21岁教育金", "输出：起提年份、累计提领、剩余现金价值"]
        : ["目标：60岁后养老金", "输出：起提年份、累计提领、剩余现金价值"];

      const slides: OutlineSlide[] = [
        { id: "cover", pageType: "cover", title: `${req.customerName} 家庭资产配置方案`, bullets: [productName], visualIntent: "family" },
        {
          id: "company",
          pageType: "company",
          title: "公司介绍与资质",
          bullets: [
            companyName,
            tenant.companyIntro || "公司资料来自内部知识库，正式展示前需通过来源校验。",
            ...(tenant.companyRating || []),
            ...(req.companyContext?.evidenceFiles?.slice(0, 1).map((p) => `内部资料索引：${path.basename(p).slice(0, 28)}`) || [])
          ],
          visualIntent: "company",
        },
        { id: "scenario", pageType: "narrative", title: scenarioTitle, bullets: scenarioBullets, visualIntent: insuredAge < 18 ? "education" : "retire" },
        { id: "chart-growth", pageType: "chart", title: "价值增长曲线（默认展示到保单80年）", bullets: ["不提领20/30年相对本金倍数", "长期增长趋势"], chartIntent: "growth", visualIntent: "finance" },
        { id: "chart-stacked", pageType: "chart", title: "保证/非保证构成（默认展示到保单80年）", bullets: ["保证底盘与弹性贡献"], chartIntent: "stacked", visualIntent: "finance" },
        { id: "timeline-a", pageType: "timeline", title: "里程碑一：前中期资金规划", bullets: ["横向里程碑：年龄/年度/金额"], visualIntent: "finance" },
        { id: "timeline-b", pageType: "timeline", title: "里程碑二：中后期与养老规划", bullets: ["横向里程碑：年龄/年度/金额"], visualIntent: "retire" },
        { id: "table-nowithdraw", pageType: "table", title: "不提领方案数据表（每10年）", bullets: ["含单利复利"], visualIntent: "finance" },
        { id: "closing", pageType: "conclusion", title: "结束语与祝愿", bullets: ["祝愿家庭资产稳健增长、代际传承顺利", "本方案用于沟通理解，最终权益以保险公司正式文件为准"], visualIntent: "family" },
        { id: "action", pageType: "conclusion", title: "下一步行动建议", bullets: ["建议尽快与您的保险经纪人预约时间完成产品对比与方案确认", "我们已为您准备好完整的对比表与提领演示"], visualIntent: "shield" },
      ];
      if (savings.withdrawalRows.length) {
        slides.splice(7, 0, { id: "table-withdraw", pageType: "table", title: "提领方案数据表（每10年）", bullets: ["含单利复利"], visualIntent: "finance" });
      }
      fs.writeFileSync(markdownPath, slides.map((s) => `## ${s.title}\n${s.bullets.map((b) => `- ${b}`).join("\n")}`).join("\n\n---\n\n"), "utf8");
      return { markdownPath, slides };
    }

    const og = new OutlineGenerator(process.env.DEEPSEEK_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || "");
    const md = await og.generate({
      extractions: req.extractions,
      customerName: req.customerName,
      companyInfo: tenant.companyIntro,
      enhanceWithAI: false,
    });

    const outDir = path.resolve("outputs", `${req.outputStem || req.sessionId}_pipeline`);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const markdownPath = path.join(outDir, "outline.md");
    fs.writeFileSync(markdownPath, md, "utf8");

    let slides = parseSlides(md);
    if (tenant.companyIntro && !slides.some((s) => s.id === "company")) {
      slides.splice(1, 0, {
        id: "company",
        pageType: "company",
        title: `${tenant.companyName} 公司介绍与资质`,
        bullets: tenant.companyRating || [tenant.companyIntro],
        visualIntent: "company",
      });
    }

    // Mandatory pages for savings / IUL:
    //  - 验证器要求 cover / company / table-nowithdraw / ≥2 chart pages
    //  - savings 多补一张 table-withdraw 做提领/不提领对比
    const hasNowithdraw = slides.some((s) => s.id === "table-nowithdraw");
    const hasWithdraw = slides.some((s) => s.id === "table-withdraw");
    const hasSavings = req.extractions.some((e) => e.planType === "savings");
    const hasIul = req.extractions.some((e) => e.planType === "iul");
    const chartSlideCount = slides.filter((s) => s.pageType === "chart").length;
    if (!hasNowithdraw) {
      slides.push({
        id: "table-nowithdraw",
        pageType: "table",
        title: "不提领方案数据表（每10年）",
        bullets: ["含单利复利，便于长期价值对比"],
        visualIntent: "finance",
      });
    }
    if (hasSavings && !hasWithdraw) {
      slides.push({
        id: "table-withdraw",
        pageType: "table",
        title: "提领方案数据表（每10年）",
        bullets: ["展示年龄、保单年度、已交总保费、领取金额、累计领取、退保现金价值、单利、复利"],
        visualIntent: "finance",
      });
    }
    // IUL: OutlineGenerator 模板不带 chart / compare pages, 验证器要求补齐
    if (hasIul) {
      const idx = slides.findIndex((s) => s.id === "table-nowithdraw");
      const insertAt = idx >= 0 ? idx : slides.length;
      const haveCompare = slides.some((s) => s.pageType === "compare");
      const haveChart = slides.filter((s) => s.pageType === "chart").length;
      const need: OutlineSlide[] = [];
      if (chartSlideCount + haveChart < 2) {
        need.push({ id: "chart-iul-1", pageType: "chart", title: "已缴总保费 vs 身故赔偿保额", bullets: ["保费累计曲线", "身故保额锁定"], chartIntent: "growth", visualIntent: "finance" });
        need.push({ id: "chart-iul-2", pageType: "chart", title: "账户价值增长曲线（保证 vs 非保证）", bullets: ["保底0% vs 指数增长", "复利效果"], chartIntent: "stacked", visualIntent: "finance" });
      }
      if (!haveCompare) {
        need.push({ id: "compare-iul", pageType: "compare", title: "传统寿险 vs IUL 指数账户", bullets: ["传统: 固定利率", "IUL: 指数策略 + 保底0%"], visualIntent: "shield" });
      }
      if (need.length) slides.splice(insertAt, 0, ...need);
    }

    return { markdownPath, slides };
  }
}
