import type { BundleCatalogEntry } from "../config/catalog-loader.ts";
import type { FormalDeckIssue } from "../savings/formal-deck-validator.ts";
import { hasBundleRenderer } from "./bundle-renderer-registry.ts";

export function evaluateBundleGate(params: {
  bundleConfig?: BundleCatalogEntry;
  bundleId?: string;
}): FormalDeckIssue[] {
  const issues: FormalDeckIssue[] = [];
  const status = params.bundleConfig?.status || "active";
  const bundleId = params.bundleId || params.bundleConfig?.id || "unknown";
  if (status !== "active") {
    issues.push({
      code: `BUNDLE_STATUS_${status.toUpperCase()}`,
      level: "error",
      message: `组合方案 ${bundleId} 状态为 ${status}，已阻断正式导出。`,
    });
    return issues;
  }
  if (params.bundleConfig?.templateFamily === "bundle" && !hasBundleRenderer(bundleId)) {
    issues.push({
      code: "BUNDLE_RENDERER_NOT_IMPLEMENTED",
      level: "error",
      message: `组合方案 ${bundleId} 尚未接入正式模板渲染器，已阻断导出。`,
    });
  }
  return issues;
}

