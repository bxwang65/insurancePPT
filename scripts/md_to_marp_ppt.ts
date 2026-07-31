import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const ROOT = "/Users/soldier/free-code/packages/insurance-ppt";

function cleanLine(line: string): string {
  const raw = line.trim();
  if (!raw) return "";
  if (raw.startsWith(">")) return "";
  if (raw.includes("视觉风格") || raw.includes("图表类型")) return "";
  if (raw.includes("叙事文案")) return "";
  if (raw === "undefined") return "";
  return raw.trim();
}

function parseSlides(md: string): Array<{ title: string; body: string[] }> {
  const sections = md.split(/\n---\n/g);
  const slides: Array<{ title: string; body: string[] }> = [];

  for (const sec of sections) {
    const m = sec.match(/^##\s+第\s+(.+?)\s+页:\s+(.+)$/m);
    if (!m) continue;
    const title = m[2].trim();
    if (!title || title === "undefined") continue;
    const lines = sec
      .split("\n")
      .map((l) => cleanLine(l))
      .filter((l) =>
        l &&
        !l.startsWith("## 第 ") &&
        !l.startsWith("# 保险计划书") &&
        !l.startsWith("自动生成时间:") &&
        !l.startsWith("产品类型:")
      );
    slides.push({ title, body: lines.slice(0, 14) });
  }
  return slides;
}

function toMarp(slides: Array<{ title: string; body: string[] }>, customer = "家庭资产配置"): string {
  const header = `---
marp: true
theme: insurance
paginate: true
size: 16:9
---

<!--
_class: cover
-->

# ${customer}
## 家庭资产配置定制方案
`;

  const body = slides.map((s) => {
    const lines = s.body
      .filter((l) => !l.includes("视觉风格") && !l.includes("图表类型"))
      .map((l) => {
        if (l.startsWith("•")) return `- ${l.slice(1).trim()}`;
        return l;
      });
    return `---\n\n## ${s.title}\n\n${lines.join("\n\n")}\n`;
  }).join("\n");

  return `${header}\n${body}`;
}

function ensureTheme(themePath: string): void {
  const css = `/* @theme insurance */
@import 'default';

section {
  font-family: 'Avenir Next', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: linear-gradient(145deg, #0b1b2b 0%, #102e46 55%, #0f3d5f 100%);
  color: #f4f7fb;
  padding: 52px 62px;
}

h1, h2 {
  color: #f9d07c;
  letter-spacing: 0.02em;
}

h2 {
  font-size: 40px;
  line-height: 1.2;
  margin-bottom: 18px;
}

section.cover h1 {
  font-size: 58px;
  margin-bottom: 10px;
}

section.cover h2 {
  color: #d6e8ff;
  font-size: 30px;
}

p, li {
  font-size: 23px;
  line-height: 1.38;
}

ul { margin-top: 8px; }

strong { color: #7ee1c3; }
`;
  fs.writeFileSync(themePath, css, "utf8");
}

async function run() {
  const input = process.argv[2];
  const output = process.argv[3];
  const customer = process.argv[4] || "家庭资产配置";
  if (!input || !output) {
    console.error("Usage: bun run scripts/md_to_marp_ppt.ts <input.md> <output.pptx> [customer]");
    process.exit(1);
  }

  const md = fs.readFileSync(input, "utf8");
  const slides = parseSlides(md);
  if (!slides.length) {
    console.error("No valid slides parsed from markdown");
    process.exit(1);
  }

  const marpMdPath = input.replace(/\.md$/i, ".marp.md");
  const themePath = path.join(ROOT, "scripts", "insurance-theme.css");
  ensureTheme(themePath);
  fs.writeFileSync(marpMdPath, toMarp(slides, customer), "utf8");

  await new Promise<void>((resolve, reject) => {
    const p = spawn("npx", [
      "@marp-team/marp-cli@latest",
      marpMdPath,
      "--pptx",
      "--theme-set", themePath,
      "--theme", "insurance",
      "-o", output,
    ], { stdio: "inherit", cwd: ROOT });
    p.on("error", reject);
    p.on("close", (code) => code === 0 ? resolve() : reject(new Error(`marp-cli exit ${code}`)));
  });

  console.log(JSON.stringify({ marpMdPath, output, slideCount: slides.length + 1 }, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
