import fs from "fs";
import type { ChartArtifact, ImageArtifact, OutlineArtifact, PipelineRequest } from "./types.ts";
import type { FormalDeckIssue } from "../savings/formal-deck-validator.ts";

export function validateDeckQuality(
  req: PipelineRequest,
  outline: OutlineArtifact,
  charts: ChartArtifact,
  images: ImageArtifact,
): FormalDeckIssue[] {
  const issues: FormalDeckIssue[] = [];
  const slides = outline.slides;
  const has = (id: string) => slides.some((slide) => slide.id === id);

  if (!has("cover")) issues.push({ code: "COVER_MISSING", level: "error", message: "缺少封面页" });
  if (!has("company")) issues.push({ code: "COMPANY_PAGE_MISSING", level: "error", message: "缺少公司介绍页" });
  if (!has("table-nowithdraw")) issues.push({ code: "BASE_TABLE_MISSING", level: "error", message: "缺少不提领表格页" });
  if (req.normalizedSavings?.withdrawalRows.length && !has("table-withdraw")) {
    issues.push({ code: "WITHDRAWAL_TABLE_MISSING", level: "error", message: "存在官方提领表但 PPT 缺少提领表格页" });
  }

  const chartSlides = slides.filter((slide) => slide.pageType === "chart").length;
  if (chartSlides < 2 || charts.assets.length < 2) {
    issues.push({ code: "CHART_COVERAGE_LOW", level: "error", message: "储蓄险正式版至少需要两张图表" });
  }

  for (const image of images.images) {
    if (image.source === "generated" || !fs.existsSync(image.pathOrUrl)) {
      issues.push({ code: "IMAGE_ASSET_INVALID", level: "error", message: `页面 ${image.slideId} 缺少审核通过的图片素材` });
    }
  }

  if (req.quality === "high") {
    const visualSlides = slides.filter((slide) => ["company", "narrative", "chart", "timeline"].includes(slide.pageType)).length;
    if (visualSlides / Math.max(slides.length, 1) < 0.5) {
      issues.push({ code: "VISUAL_RATIO_LOW", level: "error", message: "高质量模式要求至少 50% 页面包含图片、图表或时间轴" });
    }
  }
  return issues;
}
