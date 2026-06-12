import { findTemplateConfig } from "../config/template-catalog.ts";
import type { FormalDeckIssue } from "../savings/formal-deck-validator.ts";
import type { OutlineArtifact, PipelineRequest } from "./types.ts";

export function validateTemplateRequirements(req: PipelineRequest, outline: OutlineArtifact): FormalDeckIssue[] {
  const issues: FormalDeckIssue[] = [];
  const template = findTemplateConfig({
    planType: req.normalizedSavings ? "savings" : req.normalizedCi ? "ci" : req.normalizedIul ? "iul" : "savings",
    stylePreset: req.stylePreset,
  });
  if (!template?.requiredPageTypes?.length) return issues;

  const available = new Map<string, number>();
  for (const slide of outline.slides) {
    available.set(slide.pageType, (available.get(slide.pageType) || 0) + 1);
  }
  const required = new Map<string, number>();
  for (const pageType of template.requiredPageTypes) {
    required.set(pageType, (required.get(pageType) || 0) + 1);
  }
  for (const [pageType, count] of required) {
    const got = available.get(pageType) || 0;
    if (got < count) {
      issues.push({
        code: "TEMPLATE_PAGE_TYPE_MISSING",
        level: "error",
        message: `模板 ${template.id} 需要 ${count} 张 ${pageType} 页面，当前仅生成 ${got} 张`,
      });
    }
  }
  return issues;
}
