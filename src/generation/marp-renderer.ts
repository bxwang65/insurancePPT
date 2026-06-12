import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { OutlineGenerator } from "../chat/outline-generator.ts";

interface RenderInput {
  extractions: { pdfName: string; planType: "savings" | "ci" | "iul"; data: unknown }[];
  customerName: string;
  companyInfo?: string;
  outputPath: string;
  format: "pptx" | "pdf";
  quality?: "standard" | "high";
}

type PageType = "timeline" | "compare" | "relation" | "conclusion" | "analysis";
type ChartAsset = { planType: string; productName: string; path: string; kind?: string };
interface VisualLibrary {
  brand?: { primaryLogo?: string; secondaryLogo?: string };
  whitelistImages?: Record<string, string>;
}

function isMetaLine(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  if (t.startsWith(">")) return true;
  if (t.startsWith("**视觉风格**") || t.includes("视觉风格")) return true;
  if (t.startsWith("**叙事文案**") || t.includes("叙事文案")) return true;
  if (t.startsWith("**图表类型**") || t.includes("图表类型")) return true;
  if (t === "undefined" || t.startsWith("第 undefined 页")) return true;
  return false;
}

function parseSlides(markdown: string): Array<{ title: string; body: string[] }> {
  const sections = markdown.split(/\n---\n/g);
  const out: Array<{ title: string; body: string[] }> = [];
  for (const sec of sections) {
    const m = sec.match(/^##\s+第\s+\d+\s+页:\s+(.+)$/m);
    if (!m) continue;
    const title = m[1].trim();
    if (!title || title === "undefined") continue;
    const lines = sec.split("\n")
      .filter((l) => !l.trim().startsWith("## 第 "))
      .map((l) => l.trim())
      .filter((l) => !isMetaLine(l))
      .map((l) => l.replace(/^•\s*/, "- ").replace(/^>\s*/, ""));
    const deduped: string[] = [];
    for (const l of lines) if (deduped[deduped.length - 1] !== l) deduped.push(l);
    out.push({ title, body: deduped.slice(0, 12) });
  }
  return out;
}

function loadVisualLibrary(root: string): VisualLibrary {
  const fallback: VisualLibrary = {
    brand: { primaryLogo: "", secondaryLogo: "" },
    whitelistImages: {
      family: "https://images.unsplash.com/photo-1511895426328-dc8714191300?auto=format&fit=crop&w=1600&q=80",
      skyline: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1600&q=80",
      finance: "https://images.unsplash.com/photo-1526628953301-3e589a6a8b74?auto=format&fit=crop&w=1600&q=80",
      handshake: "https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=1600&q=80",
      shield: "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1600&q=80"
    }
  };
  try {
    const p = path.join(root, "references", "visual-library.json");
    if (!fs.existsSync(p)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as VisualLibrary;
    return {
      brand: { ...fallback.brand, ...(parsed.brand || {}) },
      whitelistImages: { ...(fallback.whitelistImages || {}), ...(parsed.whitelistImages || {}) }
    };
  } catch {
    return fallback;
  }
}

function pickVisualByTitle(title: string, lib: VisualLibrary): string {
  const m = lib.whitelistImages || {};
  if (/家庭|传承|子女|教育/.test(title)) return m.family || "";
  if (/公司|机构|对比|生态/.test(title)) return m.skyline || "";
  if (/风险|保障|防线|重疾/.test(title)) return m.shield || "";
  if (/建议|策略|配置|增长|回本|价值|轨迹|数字/.test(title)) return m.finance || "";
  return m.handshake || "";
}

function classifyPage(title: string, lines: string[]): PageType {
  const text = `${title} ${lines.join(" ")}`;
  if (/时间|阶段|路线|里程碑|周期/.test(text)) return "timeline";
  if (/对比|比较|方案A|方案B|CTF|AIA/.test(text)) return "compare";
  if (/家庭|关系|父|母|子|结构|防线/.test(text)) return "relation";
  if (/结论|建议|下一步|行动|感谢/.test(text)) return "conclusion";
  return "analysis";
}

async function buildChartAssets(extractions: RenderInput["extractions"], root: string, stem: string): Promise<ChartAsset[]> {
  const assetsDir = path.join(root, "outputs", `${stem}_assets`);
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  const payload = JSON.stringify({ extractions });
  const script = path.join(root, "scripts", "generate_chart_assets.py");
  return await new Promise<ChartAsset[]>((resolve, reject) => {
    const p = spawn("python3.11", [script, "--data", payload, "--out-dir", assetsDir], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => { out += d.toString(); });
    p.stderr.on("data", (d) => { err += d.toString(); });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`chart assets failed: ${err}`));
      try {
        const parsed = JSON.parse(out.trim());
        resolve(Array.isArray(parsed.assets) ? parsed.assets : []);
      } catch (e: any) {
        reject(new Error(`chart assets parse failed: ${e.message}`));
      }
    });
  });
}

function slideBodyByType(lines: string[], title: string, lib: VisualLibrary, pageType: PageType, chartPath?: string): string {
  const text = lines.slice(0, 8).join("<br/>");
  const visual = chartPath
    ? `<img src="${chartPath}" style="width:100%; border-radius:14px; border:1px solid rgba(10,30,55,.15);" />`
    : `<img src="${pickVisualByTitle(title, lib)}" style="width:100%; border-radius:14px; border:1px solid rgba(10,30,55,.15);" />`;

  if (pageType === "timeline") {
    const points = lines.slice(0, 5).map((x, i) => `<div class="tl-item"><span class="tl-dot">${i + 1}</span><span>${x}</span></div>`).join("");
    return `<div class="timeline-box">${points}</div>`;
  }
  if (pageType === "compare") {
    const left = lines.filter((x) => /A|方案A|CTF|周大福/.test(x)).slice(0, 4);
    const right = lines.filter((x) => /B|方案B|AIA|友邦/.test(x)).slice(0, 4);
    const l = (left.length ? left : lines.slice(0, 4)).join("<br/>");
    const r = (right.length ? right : lines.slice(4, 8)).join("<br/>");
    return `<div class="compare"><div class="cmp-card gold"><h3>方案A</h3><p>${l}</p></div><div class="cmp-card blue"><h3>方案B</h3><p>${r}</p></div></div>`;
  }
  return `<div class="cols"><div class="col left"><p>${text}</p></div><div class="col right">${visual}</div></div>`;
}

function buildMarpMarkdown(customerName: string, slides: Array<{ title: string; body: string[] }>, assets: ChartAsset[], quality: "standard" | "high", lib: VisualLibrary): string {
  const header = `---
marp: true
theme: insurance
paginate: true
size: 16:9
---

<!-- _class: cover -->
# ${customerName}
## 家庭资产配置定制方案
`;

  const byKind = new Map<string, ChartAsset[]>();
  for (const a of assets) {
    const k = a.kind || "growth";
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(a);
  }
  const takeChart = (kinds: string[]): ChartAsset | null => {
    for (const k of kinds) {
      const arr = byKind.get(k);
      if (arr && arr.length) return arr.shift()!;
    }
    for (const arr of byKind.values()) if (arr.length) return arr.shift()!;
    return null;
  };

  let textStreak = 0;
  const total = slides.length;
  const minChartSlides = quality === "high" ? Math.ceil(total * 0.3) : 0;
  const maxChartSlides = quality === "high" ? Math.ceil(total * 0.5) : total;
  let usedCharts = 0;

  const body = slides.map((s, i) => {
    const pageType = classifyPage(s.title, s.body);
    const shouldPreferChart = quality === "high" && (
      textStreak >= 2 ||
      (usedCharts < minChartSlides && (total - i) <= (minChartSlides - usedCharts + 1))
    );
    const canUseChart = assets.length > 0 && usedCharts < maxChartSlides;
    const useChart = canUseChart && (shouldPreferChart || /增长|回本|对比|价值|轨迹|关键数字/.test(s.title));

    if (useChart) {
      const kinds = pageType === "compare" ? ["radar", "stacked"] : pageType === "timeline" ? ["cashflow", "growth"] : ["growth", "stacked", "radar", "cashflow"];
      const a = takeChart(kinds);
      usedCharts++;
      textStreak = 0;
      const chartPath = a?.path ? a.path.replace(/\\/g, "/") : undefined;
      return `---\n\n## ${s.title}\n\n${slideBodyByType(s.body, s.title, lib, pageType, chartPath)}\n`;
    }

    textStreak++;
    return `---\n\n## ${s.title}\n\n${slideBodyByType(s.body, s.title, lib, pageType)}\n`;
  }).join("\n");

  return `${header}\n${body}`;
}

function ensureTheme(themePath: string, lib: VisualLibrary): void {
  const cover = (lib.whitelistImages || {}).family || "";
  const css = `/* @theme insurance */
@import 'default';

section {
  font-family: 'Avenir Next', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: #f8f7f2;
  color: #0f2841;
  padding: 44px 58px;
}

h1, h2 { color: #0f2841; letter-spacing: 0.01em; }
h2 { font-size: 40px; margin-bottom: 14px; font-weight: 800; }
section.cover {
  background-image: linear-gradient(rgba(7,22,37,.42), rgba(7,22,37,.58)), url('${cover}');
  background-size: cover;
  background-position: center;
}
section.cover h1 { font-size: 62px; color: #f3d389; text-shadow: 0 2px 12px rgba(0,0,0,.35); }
section.cover h2 { color: #f2f7ff; font-size: 30px; }

p, li { font-size: 21px; line-height: 1.4; color: #173655; }
strong { color: #b89246; }

.cols { display: flex; gap: 22px; align-items: stretch; }
.col.left, .col.right {
  width: 50%;
  background: #ffffff;
  border: 2px solid #b89246;
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 8px 24px rgba(20,34,58,.08);
}
.col.left p { font-size: 20px; line-height: 1.45; }

.timeline-box { background:#fff; border:2px solid #b89246; border-radius:14px; padding:14px 16px; }
.tl-item { display:flex; align-items:center; gap:10px; margin:10px 0; }
.tl-dot { width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; background:#0f2841; color:#f6cc73; font-weight:700; }
.compare { display:flex; gap:18px; }
.cmp-card { width:50%; background:#fff; border-radius:14px; padding:14px 16px; box-shadow:0 8px 24px rgba(20,34,58,.08); }
.cmp-card.gold { border:2px solid #b89246; }
.cmp-card.blue { border:2px solid #0f2841; }
.cmp-card h3 { margin:0 0 8px 0; }
.cmp-card p { font-size:19px; line-height:1.45; }
`;
  fs.writeFileSync(themePath, css, "utf8");
}

async function runMarp(inputPath: string, outputPath: string, format: "pptx" | "pdf", themePath: string, cwd: string): Promise<void> {
  const flag = format === "pdf" ? "--pdf" : "--pptx";
  await new Promise<void>((resolve, reject) => {
    const p = spawn("npx", [
      "@marp-team/marp-cli@latest",
      inputPath,
      flag,
      "--theme-set", themePath,
      "--theme", "insurance",
      "-o", outputPath,
    ], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => { stderr += d.toString(); });
    p.on("error", reject);
    p.on("close", (code) => code === 0 ? resolve() : reject(new Error(`marp-cli exited ${code}: ${stderr}`)));
  });
}

export async function renderSalesDeckWithMarp(input: RenderInput): Promise<{ outlinePath: string; marpPath: string }> {
  const root = path.resolve(import.meta.dir, "../../");
  const outputsDir = path.join(root, "outputs");
  if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

  const og = new OutlineGenerator(process.env.GEMINI_API_KEY || "");
  const outline = await og.generate({
    extractions: input.extractions,
    customerName: input.customerName,
    companyInfo: input.companyInfo,
    enhanceWithAI: false,
  });

  const stem = path.basename(input.outputPath, path.extname(input.outputPath));
  const outlinePath = path.join(outputsDir, `${stem}.md`);
  fs.writeFileSync(outlinePath, outline, "utf8");

  const slides = parseSlides(outline);
  if (!slides.length) throw new Error("No valid slides parsed from outline");

  const marpPath = path.join(outputsDir, `${stem}.marp.md`);
  const assets = await buildChartAssets(input.extractions, root, stem).catch(() => []);
  const visualLib = loadVisualLibrary(root);
  const marpContent = buildMarpMarkdown(input.customerName, slides, assets, input.quality || "standard", visualLib);
  fs.writeFileSync(marpPath, marpContent, "utf8");

  const themePath = path.join(root, "scripts", "insurance-theme.css");
  ensureTheme(themePath, visualLib);
  await runMarp(marpPath, input.outputPath, input.format, themePath, root);
  return { outlinePath, marpPath };
}
