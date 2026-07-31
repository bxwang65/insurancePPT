import type { ChartArtifact, ImageArtifact, PipelineRequest } from "../pipeline/types.ts";
import type { NormalizedSavingsPlan } from "../savings/savings-normalizer.ts";
import type { NormalizedCiPlan } from "../ci/ci-normalizer.ts";
import type { NormalizedIulPlan } from "../iul/iul-normalizer.ts";
import { renderChineseSavingsClone } from "./chinese-savings-clone-renderer.ts";
import { renderBrokerSavingsClone } from "./broker-savings-clone-renderer.ts";
import { renderBusinessSavingsClone } from "./business-savings-clone-renderer.ts";
import { renderMinimalSavingsClone } from "./minimal-savings-clone-renderer.ts";
import { renderInkSavingsClone } from "./ink-savings-clone-renderer.ts";
import { renderBusinessCiClone } from "./business-ci-clone-renderer.ts";
import { renderBusinessIulClone } from "./business-iul-clone-renderer.ts";

export interface SavingsCloneRenderRequest {
  outDir: string;
  normalizedSavings: NormalizedSavingsPlan;
  images: ImageArtifact;
  charts: ChartArtifact;
  outputPath: string;
  companyContext?: PipelineRequest["companyContext"];
}

type SavingsCloneRenderer = (request: SavingsCloneRenderRequest) => Promise<string>;
export interface CiCloneRenderRequest {
  outDir: string;
  normalizedCi: NormalizedCiPlan;
  images: ImageArtifact;
  charts: ChartArtifact;
  outputPath: string;
  companyContext?: PipelineRequest["companyContext"];
}
type CiCloneRenderer = (request: CiCloneRenderRequest) => Promise<string>;
export interface IulCloneRenderRequest {
  outDir: string;
  normalizedIul: NormalizedIulPlan;
  images: ImageArtifact;
  charts: ChartArtifact;
  outputPath: string;
  companyContext?: PipelineRequest["companyContext"];
}
type IulCloneRenderer = (request: IulCloneRenderRequest) => Promise<string>;

const SAVINGS_CLONE_RENDERERS: Record<string, SavingsCloneRenderer> = {
  "savings-chinese-v1": renderChineseSavingsClone,
  "savings-broker-v1": renderBrokerSavingsClone,
  "savings-business-v1": renderBusinessSavingsClone,
  "savings-minimal-v1": renderMinimalSavingsClone,
  "savings-ink-v1": renderInkSavingsClone,
};
const CI_CLONE_RENDERERS: Record<string, CiCloneRenderer> = {
  "ci-business-v1": renderBusinessCiClone,
};
const IUL_CLONE_RENDERERS: Record<string, IulCloneRenderer> = {
  "iul-business-v1": renderBusinessIulClone,
};

export function hasSavingsCloneRenderer(rendererId?: string | null): boolean {
  if (!rendererId) return false;
  return Boolean(SAVINGS_CLONE_RENDERERS[rendererId]);
}

export function hasCiCloneRenderer(rendererId?: string | null): boolean {
  if (!rendererId) return false;
  return Boolean(CI_CLONE_RENDERERS[rendererId]);
}

export function hasIulCloneRenderer(rendererId?: string | null): boolean {
  if (!rendererId) return false;
  return Boolean(IUL_CLONE_RENDERERS[rendererId]);
}

export function listSavingsCloneRendererIds(): string[] {
  return Object.keys(SAVINGS_CLONE_RENDERERS).sort();
}
export function listCiCloneRendererIds(): string[] {
  return Object.keys(CI_CLONE_RENDERERS).sort();
}
export function listIulCloneRendererIds(): string[] {
  return Object.keys(IUL_CLONE_RENDERERS).sort();
}

export async function runSavingsCloneRenderer(
  rendererId: string,
  request: SavingsCloneRenderRequest,
): Promise<string> {
  const renderer = SAVINGS_CLONE_RENDERERS[rendererId];
  if (!renderer) throw new Error(`Savings clone renderer not found: ${rendererId}`);
  return renderer(request);
}

export async function runCiCloneRenderer(
  rendererId: string,
  request: CiCloneRenderRequest,
): Promise<string> {
  const renderer = CI_CLONE_RENDERERS[rendererId];
  if (!renderer) throw new Error(`CI clone renderer not found: ${rendererId}`);
  return renderer(request);
}

export async function runIulCloneRenderer(
  rendererId: string,
  request: IulCloneRenderRequest,
): Promise<string> {
  const renderer = IUL_CLONE_RENDERERS[rendererId];
  if (!renderer) throw new Error(`IUL clone renderer not found: ${rendererId}`);
  return renderer(request);
}
