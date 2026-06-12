import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import {
  hasCiCloneRenderer,
  hasIulCloneRenderer,
  hasSavingsCloneRenderer,
  runCiCloneRenderer,
  runIulCloneRenderer,
  runSavingsCloneRenderer,
} from "../templates/clone-renderer-registry.ts";
import type { ChartArtifact, DeckArtifact, ImageArtifact, OutlineArtifact, PipelineRequest, TenantBrandConfig } from "./types.ts";
import { findTemplateConfig } from "../config/template-catalog.ts";
import { assertFormalOutputClean } from "./formal-output-guard.ts";

function esc(s: string): string { return s.replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function rel(fromDir: string, absPath: string): string { return path.relative(fromDir, absPath).replace(/\\/g, "/"); }
function fmt(n: number): string { return (n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 }); }

function getSavings(req: PipelineRequest): any | null {
  return req.normalizedSavings || null;
}

function decadeRows(s: any, withWithdraw: boolean) {
  const insuredAge = Number(s?.insured?.age || 1);
  const base = (s?.benefitRows || []) as any[];
  const w = (s?.withdrawalRows || []) as any[];
  const byYear = new Map<number, any>(base.map((r: any) => [Number(r.policyYear), r]));
  const src = withWithdraw && w.length ? w : base.map((r: any) => ({
    age: r.age || insuredAge + Number(r.policyYear || 0), policy_year: r.policyYear,
    total_premium_paid: r.totalPremiumPaid, annual_withdrawal: 0, cumulative_withdrawal: 0,
    surrender_value_after: r.totalSurrenderValue,
  }));
  const out: any[] = [];
  for (const r of src) {
    const py = Number(r.policy_year ?? r.policyYear ?? 0);
    if (!(py === 1 || py % 10 === 0 || py >= 120)) continue;
    const b = byYear.get(py);
    const paid = Number(r.total_premium_paid ?? r.totalPremiumPaid ?? b?.totalPremiumPaid ?? 0);
    const val = Number(r.surrender_value_after ?? r.surrenderValueAfter ?? r.total_surrender_value ?? r.totalSurrenderValue ?? 0);
    const years = Math.max(py, 1);
    const simple = ((val / Math.max(paid, 1) - 1) / years) * 100;
    const cagr = (Math.pow(val / Math.max(paid, 1), 1 / years) - 1) * 100;
    out.push({
      age: Number(r.age || insuredAge + py),
      policy_year: py,
      total_premium_paid: paid,
      annual_withdrawal: Number(r.annual_withdrawal ?? r.annualWithdrawal ?? 0),
      cumulative_withdrawal: Number(r.cumulative_withdrawal ?? r.cumulativeWithdrawal ?? 0),
      surrender_value_after: val,
      simple_rate: simple,
      cagr_rate: cagr,
    });
  }
  return out.slice(0, 15);
}

function firstHit(rows: any[], mul: number): number | null {
  for (const r of rows) {
    if (Number(r.total_premium_paid || 0) > 0 && Number(r.surrender_value_after || 0) >= Number(r.total_premium_paid || 0) * mul) return Number(r.policy_year || 0);
  }
  return null;
}

function firstWithdrawInfo(s: any): { year: number | null; age: number | null } {
  const wr = (s?.withdrawalRows || []) as any[];
  for (const r of wr) {
    if (Number(r?.annualWithdrawal || 0) > 0) return { year: Number(r.policyYear || 0), age: Number(r.age || 0) };
  }
  return { year: null, age: null };
}

function multipleAtYear(s: any, y: number): number | null {
  const row = (s?.benefitRows || []).find((r: any) => Number(r.policyYear) === y);
  if (!row) return null;
  const paid = Number(row.totalPremiumPaid || 0);
  const val = Number(row.totalSurrenderValue || 0);
  if (paid <= 0) return null;
  return Number((val / paid).toFixed(2));
}

function renderTable(rows: any[]): string {
  const trs = rows.map((r) => `<tr><td>${r.age}</td><td>${r.policy_year}</td><td>${fmt(r.total_premium_paid)}</td><td>${fmt(r.annual_withdrawal)}</td><td>${fmt(r.cumulative_withdrawal)}</td><td>${fmt(r.surrender_value_after)}</td><td>${(r.simple_rate||0).toFixed(2)}%</td><td>${(r.cagr_rate||0).toFixed(2)}%</td></tr>`).join("");
  return `<table class=\"data-table\"><thead><tr><th>年龄</th><th>保单年度</th><th>已交总保费</th><th>领取金额</th><th>累计领取</th><th>退保现金价值</th><th>单利</th><th>复利</th></tr></thead><tbody>${trs}</tbody></table>`;
}

function chartHint(title: string): string {
  if (/现金流/.test(title)) return "先看现金流方向，再看峰值年份，最后落到提款节奏是否匹配家庭支出。";
  if (/构成|保证|非保证/.test(title)) return "先看保证底盘，再看非保证弹性，明确长期收益主要来源。";
  if (/增长|回本|价值/.test(title)) return "先看回本区间，再看20年/30年关键点，评估资金效率。";
  return "先看趋势，再看关键年份，再讲可执行结论。";
}

function buildMarp(req: PipelineRequest, tenant: TenantBrandConfig, outline: OutlineArtifact, images: ImageArtifact, charts: ChartArtifact): string {
  const imageMap = new Map(images.images.map((x) => [x.slideId, x.pathOrUrl]));
  const chartByKind = new Map<string, string[]>();
  for (const a of charts.assets) { if (!chartByKind.has(a.kind)) chartByKind.set(a.kind, []); chartByKind.get(a.kind)!.push(a.path); }
  const takeChart = (kind: string): string => {
    const arr = chartByKind.get(kind); if (arr && arr.length) return arr.shift()!;
    for (const v of chartByKind.values()) if (v.length) return v.shift()!;
    return "";
  };

  const sdata = getSavings(req);
  const header = `---\nmarp: true\ntheme: pipeline-brand\npaginate: true\nsize: 16:9\n---\n\n<!-- _class: cover -->\n# ${req.customerName}\n## 家庭资产配置定制方案\n### ${esc(sdata?.productName || "长期财富与家庭保障规划")}\n`;

  const body = outline.slides.filter((s) => s.pageType !== "cover").map((s) => {
    if (s.pageType === "timeline") {
      const source = (sdata?.withdrawalRows || []).length ? sdata.withdrawalRows : [];
      const ages = /二/.test(s.title) ? [45, 60, 65, 80] : [10, 20, 30, 45];
      const cards = ages.map((a) => {
        const r = source.find((x: any) => Number(x.age) === a);
        if (!r) return `<div class="mile"><h3>${a}岁</h3><p>暂无数据</p></div>`;
        return `<div class="mile"><h3>${a}岁</h3><p>保单第${Number(r.policyYear)}年</p><p>年提领 US$${fmt(Number(r.annualWithdrawal||0))}</p><p>累计提领 US$${fmt(Number(r.cumulativeWithdrawal||0))}</p><p>剩余价值 US$${fmt(Number(r.surrenderValueAfter||0))}</p></div>`;
      }).join("");
      return `---\n\n## ${esc(s.title)}\n\n<div class="timeline-row">${cards}</div>\n`;
    }

    if (s.pageType === "table") {
      const withW = /提领/.test(s.title) && !/不提领/.test(s.title);
      const rows = decadeRows(sdata, withW);
      const d2 = firstHit(rows, 2); const d3 = firstHit(rows, 3);
      return `---\n\n## ${esc(s.title)}\n\n<div class=\"table-full\">${renderTable(rows)}</div>\n<div class=\"metrics-bar\"><span>缴费方式：10万美金 × 5年</span><span>约第${d2 || "-"}年达到2倍</span><span>约第${d3 || "-"}年达到3倍</span><span>单利/复利用于观察阶段性效率</span></div>\n`;
    }

    let imgAbs = imageMap.get(s.id) || "";
    if (s.pageType === "chart") {
      const kind = s.chartIntent === "cashflow" ? "cashflow" : s.chartIntent === "stacked" ? "stacked" : "growth";
      imgAbs = takeChart(kind) || imgAbs;
    }
    const img = imgAbs ? rel(path.dirname(outline.markdownPath), imgAbs) : "";
    const bullets = s.bullets.slice(0, 5).map((b) => `<li>${esc(b)}</li>`).join("");
    let hint = s.pageType === "chart" ? chartHint(s.title) : "";
    if (s.id === "scenario") {
      const f = firstWithdrawInfo(sdata);
      const by18 = (sdata?.withdrawalRows || []).find((r: any) => Number(r.age) === 18);
      const by21 = (sdata?.withdrawalRows || []).find((r: any) => Number(r.age) === 21);
      hint = `开始提领：保单第${f.year || "-"}年（约${f.age || "-"}岁）` +
        `；18岁累计提领：US$${fmt(Number(by18?.cumulativeWithdrawal||0))}` +
        `；21岁累计提领：US$${fmt(Number(by21?.cumulativeWithdrawal||0))}`;
    }
    if (s.id === "chart-growth") {
      const m20 = req.savingsMetrics?.multiple20 ?? multipleAtYear(sdata, 20);
      const m30 = req.savingsMetrics?.multiple30 ?? multipleAtYear(sdata, 30);
      hint = `不提领20年：约本金${m20 ?? "-"}倍；不提领30年：约本金${m30 ?? "-"}倍。`;
    }
    return `---\n\n## ${esc(s.title)}\n\n<div class=\"split\">\n  <div class=\"media\">${img ? `<img src=\"${img}\" />` : ""}</div>\n  <div class=\"panel\"><ul>${bullets}</ul>${hint ? `<p class=\"hint\">${hint}</p>` : ""}</div>\n</div>\n`;
  }).join("\n");

  return `${header}\n${body}`;
}

function buildTheme(tenant: TenantBrandConfig, coverRel: string, preset: PipelineRequest["stylePreset"]): string {
  const p = preset || "broker";
  const primary = p === "business" ? "#17324d" : p === "minimal" ? "#1f2937" : p === "chinese" ? "#7b1e1e" : p === "ink" ? "#1f2d3d" : tenant.colors.primary;
  const secondary = p === "business" ? "#c9a86a" : p === "minimal" ? "#334155" : p === "chinese" ? "#c8a24d" : p === "ink" ? "#6b7280" : tenant.colors.secondary;
  const bgStart = p === "business" ? "#f3f6fb" : p === "minimal" ? "#f8fafc" : p === "chinese" ? "#fbf6ef" : p === "ink" ? "#f5f6f8" : tenant.colors.bgStart;
  const bgEnd = p === "business" ? "#eaf0f8" : p === "minimal" ? "#eef2f7" : p === "chinese" ? "#f2e8d9" : p === "ink" ? "#eaedf1" : tenant.colors.bgEnd;
  return `/* @theme pipeline-brand */\n@import 'default';\nsection { background: linear-gradient(145deg, ${bgStart} 0%, ${bgEnd} 100%); color: ${primary}; font-family: 'Arial Unicode MS','PingFang SC','Hiragino Sans GB',sans-serif; padding: 34px 42px; }\nsection.cover { background-image: linear-gradient(rgba(9,24,40,.72), rgba(12,40,66,.62)), url('${coverRel}'); background-size: cover; background-position: center; color:#fff; }\nh1 { color: ${secondary}; font-size: 52px; }\nh2 { color: ${primary}; font-size: 32px; letter-spacing:.02em; }\nh3 { color:${secondary}; font-size:20px; }\nsection.cover h2 { color: #e8f2ff; }\nsection.cover h3 { color:#f3d998; }\n.split { display:flex; gap:18px; align-items:stretch; }\n.media { width:56%; background:#fff; border:1.5px solid ${secondary}; border-radius:14px; padding:8px; }\n.media img { width:100%; height:100%; object-fit:cover; border-radius:10px; }\n.panel { width:44%; background:#fff; border:1.5px solid ${secondary}; border-radius:14px; padding:14px 16px; }\nli { font-size:18px; line-height:1.52; margin:7px 0; }\n.hint { margin-top:12px; font-size:15px; line-height:1.55; color:#4b6278; background:#f6f9fd; border-left:4px solid ${secondary}; padding:10px; border-radius:8px; }\n.timeline-row { position:relative; display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-top:72px; }\n.timeline-row:before { content:''; position:absolute; height:3px; left:4%; right:4%; top:-30px; background:${secondary}; }\n.mile { position:relative; background:#fff; border:1.5px solid ${secondary}; border-radius:12px; padding:14px; }\n.mile:before { content:''; position:absolute; width:16px; height:16px; border-radius:50%; background:${primary}; border:3px solid #fff; top:-47px; left:calc(50% - 10px); }\n.mile h3 { margin:0 0 8px 0; color:${primary}; font-size:24px; }\n.mile p { margin:4px 0; font-size:14px; color:#2d4762; }\n.table-full { width:100%; }\n.metrics-bar { margin-top:10px; display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }\n.metrics-bar span { background:#f6f9fd; border:1px solid #d7e3ef; border-radius:8px; padding:8px; font-size:14px; color:#23415f; text-align:center; }\n.data-table { width:100%; border-collapse:collapse; background:#fff; font-size:13px; }\n.data-table th { background:${primary}; color:#fff; padding:6px; text-align:center; }\n.data-table td { border-bottom:1px solid #e5edf5; padding:6px; text-align:center; color:#1e3b56; }\n`;
}

async function render(marpPath: string, themePath: string, output: string, mode: "--pptx" | "--pdf"): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn("npx", ["@marp-team/marp-cli@latest", marpPath, mode, "--allow-local-files", "--theme-set", themePath, "--theme", "pipeline-brand", "-o", output], { stdio: "inherit" });
    p.on("error", reject); p.on("close", (code) => code === 0 ? resolve() : reject(new Error(`marp exit ${code}`)));
  });
}

export class PresentationAgent {
  async run(req: PipelineRequest, tenant: TenantBrandConfig, outline: OutlineArtifact, images: ImageArtifact, charts: ChartArtifact): Promise<DeckArtifact> {
    const outDir = path.resolve("outputs", `${req.outputStem || req.sessionId}_pipeline`);
    const marpPath = path.join(outDir, "deck.marp.md");
    const themePath = path.join(outDir, "pipeline-brand.css");
    const pptxPath = path.join(outDir, "deck.pptx");
    const pdfPath = path.join(outDir, "deck.pdf");
    const coverAbs = images.images[0]?.pathOrUrl || "";
    const coverRel = coverAbs ? rel(outDir, coverAbs) : "";
    fs.writeFileSync(marpPath, buildMarp(req, tenant, outline, images, charts), "utf8");
    fs.writeFileSync(themePath, buildTheme(tenant, coverRel, req.stylePreset), "utf8");
    const format = req.format || "both";
    let pptxRenderMode: DeckArtifact["pptxRenderMode"] = "marp";
    const planType = req.normalizedSavings ? "savings" : req.normalizedCi ? "ci" : req.normalizedIul ? "iul" : "savings";
    const template = findTemplateConfig({ planType, stylePreset: req.stylePreset });
    if (template?.cloneReady && (
      (planType === "savings" && !hasSavingsCloneRenderer(template.cloneRenderer)) ||
      (planType === "ci" && !hasCiCloneRenderer(template.cloneRenderer)) ||
      (planType === "iul" && !hasIulCloneRenderer(template.cloneRenderer))
    )) {
      throw new Error(
        `Template ${template.id} is marked cloneReady but renderer ${template.cloneRenderer || "null"} is not implemented`,
      );
    }
    const canUseClone =
      Boolean(template?.cloneReady) &&
      Boolean(template?.cloneRenderer) &&
      Boolean(req.normalizedSavings || req.normalizedCi || req.normalizedIul);
    if (format === "pptx" || format === "both") {
      if (canUseClone && template?.cloneRenderer) {
        if (planType === "savings" && req.normalizedSavings) {
          await runSavingsCloneRenderer(template.cloneRenderer, {
            outDir,
            normalizedSavings: req.normalizedSavings,
            images,
            charts,
            outputPath: pptxPath,
            companyContext: req.companyContext,
          });
        } else if (planType === "ci" && req.normalizedCi) {
          await runCiCloneRenderer(template.cloneRenderer, {
            outDir,
            normalizedCi: req.normalizedCi,
            images,
            charts,
            outputPath: pptxPath,
            companyContext: req.companyContext,
          });
        } else if (planType === "iul" && req.normalizedIul) {
          await runIulCloneRenderer(template.cloneRenderer, {
            outDir,
            normalizedIul: req.normalizedIul,
            images,
            charts,
            outputPath: pptxPath,
            companyContext: req.companyContext,
          });
        } else {
          throw new Error(`Clone renderer context mismatch for planType=${planType}`);
        }
        pptxRenderMode = "artifact-tool-exact-clone-edit";
      } else {
        await render(marpPath, themePath, pptxPath, "--pptx");
        assertFormalOutputClean([marpPath]);
      }
    }
    if (format === "pdf" || format === "both") await render(marpPath, themePath, pdfPath, "--pdf");
    return {
      marpPath,
      pptxPath: fs.existsSync(pptxPath) ? pptxPath : undefined,
      pdfPath: fs.existsSync(pdfPath) ? pdfPath : undefined,
      pptxRenderMode,
    };
  }
}
