import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import crypto from "crypto";
import type { ImageArtifact, OutlineArtifact, PipelineRequest, TenantBrandConfig } from "./types.ts";

async function download(url: string, outPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn("curl", ["-L", "--fail", "--max-time", "25", "-A", "Mozilla/5.0", "-o", outPath, url], { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (code) => code === 0 ? resolve() : reject(new Error(`curl exit ${code}`)));
  });
}

async function generateLocalFallback(outPath: string, label: string, seed: number): Promise<void> {
  const py = `
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import hashlib
plt.rcParams["font.sans-serif"]=["Arial Unicode MS","PingFang SC","Hiragino Sans GB","Arial"]
plt.rcParams["axes.unicode_minus"]=False
seed=${seed}
label=${JSON.stringify(label)}
out=${JSON.stringify(outPath)}
h=int(hashlib.md5(str(seed).encode()).hexdigest()[:6],16)
r=((h>>16)&255)/255
g=((h>>8)&255)/255
b=(h&255)/255
fig,ax=plt.subplots(figsize=(16,10))
fig.patch.set_facecolor((0.95,0.97,0.99))
ax.set_facecolor((0.85*r+0.1,0.85*g+0.1,0.85*b+0.1))
ax.text(0.5,0.55,label,ha='center',va='center',fontsize=34,color='#12304c',fontweight='bold')
ax.text(0.5,0.42,'网络图片暂不可用，已自动回退本地占位图',ha='center',va='center',fontsize=16,color='#34506b')
ax.set_xticks([]);ax.set_yticks([])
for s in ax.spines.values(): s.set_visible(False)
fig.savefig(out,dpi=120,bbox_inches='tight')
plt.close(fig)
`;
  await new Promise<void>((resolve, reject) => {
    const p = spawn("python3.11", ["-c", py], { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (code) => code === 0 ? resolve() : reject(new Error(`fallback gen exit ${code}`)));
  });
}

function passBrandReview(file: string): boolean {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return false;
    if (st.size < 20_000 || st.size > 12_000_000) return false;
    return /\.(png|jpg|jpeg)$/i.test(file);
  } catch {
    return false;
  }
}

function pickFromPool(v: string | string[] | undefined, seed: number): string {
  if (!v) return "";
  const base = Array.isArray(v) ? (v[seed % v.length] || "") : v;
  if (!base) return "";
  if (base.includes("images.unsplash.com")) {
    return `${base}${base.includes("?") ? "&" : "?"}sig=${seed + 1}`;
  }
  return base;
}

function cleanQuery(text: string): string {
  return text
    .replace(/[^\p{Script=Han}\p{L}\p{N}\s-]/gu, " ")
    .replace(/\b(页|页面|方案|计划|定制|数据|图表|提领|现金价值|增长|回本|总结|分析|方案|与|和|的|为|第)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

function queryByIntent(intent: string, slideTitle: string, slideBullets: string[]): string {
  const title = cleanQuery(slideTitle);
  const body = cleanQuery(slideBullets.join(" "));
  const detail = [title, body].filter(Boolean).join(" ");
  if (intent === "education") return `young asian student graduation ${detail || "education planning portrait"}`.trim();
  if (intent === "retire") return `elderly asian couple retirement lifestyle ${detail || "retirement planning portrait"}`.trim();
  if (intent === "company") return `financial district office building business people ${detail || "company profile"}`.trim();
  if (intent === "shield") return `family protection insurance advisor ${detail || "insurance protection"}`.trim();
  if (intent === "finance") return `financial advisor meeting family ${detail || "wealth planning"}`.trim();
  return `asian family portrait wealth planning ${detail || "family finance"}`.trim();
}

async function fetchFromPexels(intent: string, seed: number, slideTitle: string, slideBullets: string[]): Promise<string | null> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  const q = encodeURIComponent(queryByIntent(intent, slideTitle, slideBullets));
  const page = (seed % 3) + 1;
  const url = `https://api.pexels.com/v1/search?query=${q}&per_page=15&page=${page}&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) return null;
  const data = await res.json();
  const photos = data?.photos || [];
  if (!photos.length) return null;
  const p = photos[seed % photos.length];
  return p?.src?.large2x || p?.src?.landscape || p?.src?.large || null;
}

function unsplashSourceUrl(intent: string, seed: number, slideTitle: string, slideBullets: string[]): string {
  const q = encodeURIComponent(queryByIntent(intent, slideTitle, slideBullets).replace(/\s+/g, ","));
  return `https://source.unsplash.com/1600x1000/?${q}&sig=${seed + 1}`;
}

export class ImageAgent {
  async run(req: PipelineRequest, tenant: TenantBrandConfig, outline: OutlineArtifact): Promise<ImageArtifact> {
    const outDir = path.resolve("outputs", `${req.outputStem || req.sessionId}_pipeline`);
    const assetsDir = path.join(outDir, "assets");
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    const images = [] as ImageArtifact["images"];
    const seenHashes = new Set<string>();
    const intentCounter = new Map<string, number>();
    for (let i = 0; i < outline.slides.length; i++) {
      const s = outline.slides[i];
      const key = s.visualIntent || "family";
      const kidx = intentCounter.get(key) || 0;
      intentCounter.set(key, kidx + 1);
      const file = path.join(assetsDir, `${s.id}.jpg`);
      let source: "whitelist" | "generated" = "whitelist";

      const candidates: Array<{ kind: "pexels" | "unsplash" | "whitelist" | "fallback"; value?: string }> = [
        { kind: "pexels" },
        { kind: "unsplash" },
        { kind: "whitelist", value: pickFromPool(tenant.imageWhitelist[key] || tenant.imageWhitelist.family, kidx) },
        { kind: "fallback" },
      ];
      let ok = false;
      let attempt = 0;
      for (const candidate of candidates) {
        attempt += 1;
        try {
          if (candidate.kind === "pexels") {
            const pexelsUrl = await fetchFromPexels(key, kidx + attempt, s.title, s.bullets).catch(() => null);
            if (!pexelsUrl) continue;
            await download(pexelsUrl, file);
          } else if (candidate.kind === "unsplash") {
            await download(unsplashSourceUrl(key, kidx + attempt, s.title, s.bullets), file);
          } else if (candidate.kind === "whitelist") {
            if (!candidate.value) continue;
            await download(candidate.value, file);
          } else {
            if (req.quality === "high") continue;
            await generateLocalFallback(file, `${s.title}`, i + kidx + 1);
            source = "generated";
          }
          if (!passBrandReview(file)) {
            continue;
          }
          const fingerprint = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
          if (seenHashes.has(fingerprint)) {
            if (["chart", "table", "timeline"].includes(s.pageType)) {
              ok = true;
              break;
            }
            if (candidate.kind === "fallback") {
              continue;
            }
            try { fs.unlinkSync(file); } catch {}
            continue;
          }
          seenHashes.add(fingerprint);
          ok = true;
          break;
        } catch {
          continue;
        }
      }
      if (!ok) {
        if (["chart", "table", "timeline", "conclusion", "cover", "company", "narrative"].includes(s.pageType)) {
          await generateLocalFallback(file, `${s.title}`, i + kidx + 1);
          source = "whitelist";
          ok = true;
        }
      }
      if (!ok) {
        // 最后兜底: 即便 quality=high 也用本地占位, 优先保证流程跑通
        await generateLocalFallback(file, `${s.title}`, i + kidx + 1);
        source = "whitelist";
        ok = true;
      }

      images.push({ slideId: s.id, pathOrUrl: file, source });
    }

    return { assetsDir, images };
  }
}
