/**
 * 极速 PPTX 渲染器 (绕过模板克隆, 直接 python-pptx)
 * 目标: 5 秒内出片, 100KB 内输出
 */
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import type { DeckContract } from "./normalized-deck.ts";

const SCRIPT = path.resolve(import.meta.dir, "../../scripts/fast_pptx_renderer.py");

export type FastTheme = "caramel" | "deepblue" | "chinese";

export async function renderFastPptx(deck: DeckContract, options: {
  outputPath: string;
  theme?: FastTheme;
}): Promise<{ ok: boolean; path: string; size: number; slides: number; durationMs: number }> {
  const t0 = Date.now();
  const theme = options.theme || "deepblue";
  // 写 deck 到临时 JSON
  const tmpJson = `/tmp/fast_deck_${Date.now()}.json`;
  fs.writeFileSync(tmpJson, JSON.stringify(deck, null, 2), "utf8");

  return await new Promise((resolve, reject) => {
    const proc = spawn("python3.11", [SCRIPT, "--deck-json", tmpJson, "--output", options.outputPath, "--theme", theme], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      // 清理临时文件
      try { fs.unlinkSync(tmpJson); } catch {}
      if (code !== 0) return reject(new Error(`fast-pptx exited ${code}: ${stderr}`));
      try {
        const r = JSON.parse(stdout.trim());
        resolve({ ...r, durationMs: Date.now() - t0 });
      } catch (e: any) {
        reject(new Error(`fast-pptx output parse failed: ${e.message}`));
      }
    });
  });
}
