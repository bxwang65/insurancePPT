// @ts-nocheck
// Legacy image generator retained for migration reference only.
/**
 * ImageGenerator — 保险PPT图片生成器
 * 
 * 注意: 此模块已废弃，图片生成已迁移到 Playwright 截图管线 (slide_renderer.py)
 * 保留此文件仅用于向后兼容。新代码应直接使用 slide_renderer.py + hybrid_generator.py
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const IMAGE_DIR = path.resolve(import.meta.dir, "../../public/images");

interface ImageGenInput {
  planTypes: string[];
  customerName?: string;
  theme?: string;
}

export class ImageGenerator {
  private cacheDir: string;

  constructor() {
    this.cacheDir = IMAGE_DIR;
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 生成封面图片
   * 方案: 使用 Playwright 渲染专业 HTML 模板截图（替代 Gemini Imagen）
   * 优势: 像素级完美、品牌配色可控、中文字体正确
   */
  async generateCoverImage(sessionId: string, input: ImageGenInput): Promise<string | null> {
    const cachePath = path.join(this.cacheDir, `${sessionId}_cover.png`);
    if (fs.existsSync(cachePath)) return cachePath;

    try {
      // 使用 slide_renderer.py 渲染封面
      const slideSpec = {
        _id: 0,
        type: "kpi_cards",
        title: input.theme || "保险计划方案",
        narrative: `为 ${input.customerName || "尊贵客户"} 精心设计的财富规划`,
        kpis: [
          {
            label: "产品类型",
            value: input.planTypes.map(t => t === "ci" ? "重疾保障" : t === "iul" ? "指数万用寿险" : "储蓄保险").join("、"),
            unit: "",
            sub: "专业定制"
          }
        ]
      };

      const result = await new Promise<string>((resolve, reject) => {
        const proc = spawn(
          process.execPath,
          [
            path.resolve(import.meta.dir, "../../scripts/slide_renderer.py"),
            "--spec", JSON.stringify(slideSpec),
            "--output-dir", this.cacheDir
          ],
          { timeout: 30000 }
        );

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", d => stdout += d.toString());
        proc.stderr.on("data", d => stderr += d.toString());

        proc.on("close", code => {
          if (code === 0 && stdout.trim()) {
            resolve(stdout.trim().split("\n")[0]);
          } else {
            reject(new Error(stderr || `exit code ${code}`));
          }
        });
        proc.on("error", reject);
      });

      // slide_renderer.py 输出完整路径，可能与cachePath不同（因为_id=0）
      // 如果渲染成功但路径不匹配，复制到cachePath
      if (result && result !== cachePath && fs.existsSync(result)) {
        fs.copyFileSync(result, cachePath);
        return cachePath;
      }
      return result || null;
    } catch (err) {
      console.error("[ImageGenerator] Playwright render failed, falling back to gradient:", err);
      // 降级：生成纯色渐变背景
      return this.generateGradientFallback(sessionId, input);
    }
  }

  /**
   * 降级方案：生成渐变背景PNG（不依赖任何API）
   */
  private async generateGradientFallback(sessionId: string, input: ImageGenInput): Promise<string | null> {
    try {
      const { createCanvas } = await import("canvas");
      const canvas = createCanvas(1280, 720);
      const ctx = canvas.getContext("2d");

      // 渐变背景
      const gradient = ctx.createLinearGradient(0, 0, 1280, 720);
      gradient.addColorStop(0, "#0A3C5F");
      gradient.addColorStop(1, "#18898D");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1280, 720);

      // 金色装饰条
      ctx.fillStyle = "#C9A027";
      ctx.fillRect(0, 0, 6, 720);

      // 标题
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 48px Heiti TC";
      ctx.fillText(input.theme || "保险计划方案", 60, 360);

      // 副标题
      ctx.font = "24px Heiti TC";
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText(`为 ${input.customerName || "尊贵客户"} 精心设计`, 60, 420);

      const buffer = canvas.toBuffer("image/png");
      const cachePath = path.join(this.cacheDir, `${sessionId}_cover.png`);
      fs.writeFileSync(cachePath, buffer);
      return cachePath;
    } catch {
      console.error("[ImageGenerator] Fallback also failed");
      return null;
    }
  }
}

