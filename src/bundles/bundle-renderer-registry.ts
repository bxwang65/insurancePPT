import type { ChartArtifact, DeckArtifact, ImageArtifact, OutlineArtifact, PipelineRequest, TenantBrandConfig } from "../pipeline/types.ts";
import { renderSavingsCiBundle } from "./savings-ci-bundle-renderer.ts";
import { renderSavingsIulBundle } from "./savings-iul-bundle-renderer.ts";
import { renderSavingsCiIulBundle } from "./savings-ci-iul-bundle-renderer.ts";

export interface BundleRendererRequest {
  req: PipelineRequest;
  outDir: string;
  outline: OutlineArtifact;
  images: ImageArtifact;
  charts: ChartArtifact;
  tenant: TenantBrandConfig;
}

type BundleRenderer = (request: BundleRendererRequest) => Promise<DeckArtifact>;

const BUNDLE_RENDERERS: Record<string, BundleRenderer> = {
  "savings-ci": renderSavingsCiBundle,
  "savings-iul": renderSavingsIulBundle,
  "savings-ci-iul": renderSavingsCiIulBundle,
};

export function hasBundleRenderer(bundleId?: string | null): boolean {
  if (!bundleId) return false;
  return Boolean(BUNDLE_RENDERERS[bundleId]);
}

export function listBundleRendererIds(): string[] {
  return Object.keys(BUNDLE_RENDERERS).sort();
}

export async function runBundleRenderer(bundleId: string, request: BundleRendererRequest): Promise<DeckArtifact> {
  const renderer = BUNDLE_RENDERERS[bundleId];
  if (!renderer) throw new Error(`Bundle renderer not found: ${bundleId}`);
  return renderer(request);
}
