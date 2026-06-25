import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import type { OutlineArtifact, PipelineRequest } from "./types.ts";

export interface ChartAsset {
  kind: string;
  path: string;
  productName?: string;
}

export interface ChartArtifact {
  assetsDir: string;
  assets: ChartAsset[];
}

export class ChartAgent {
  async run(req: PipelineRequest, _outline: OutlineArtifact): Promise<ChartArtifact> {
    const outDir = path.resolve("outputs", `${req.outputStem || req.sessionId}_pipeline`);
    const assetsDir = path.join(outDir, "charts");
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    const script = path.resolve("scripts", "generate_chart_assets.py");
    const payload = JSON.stringify({ extractions: req.extractions });

    const assets = await new Promise<ChartAsset[]>((resolve, reject) => {
      const p = spawn("python3.11", [script, "--data", payload, "--out-dir", assetsDir], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => out += d.toString());
      p.stderr.on("data", (d) => err += d.toString());
      p.on("error", reject);
      p.on("close", (code) => {
        if (code !== 0) return reject(new Error(err || `chart agent exit ${code}`));
        try {
          const parsed = JSON.parse(out.trim());
          resolve(Array.isArray(parsed.assets) ? parsed.assets : []);
        } catch (e: any) {
          reject(new Error(`chart parse failed: ${e.message}`));
        }
      });
    });

    return { assetsDir, assets };
  }
}
