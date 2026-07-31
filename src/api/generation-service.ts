import crypto from "crypto";
import fs from "fs";
import path from "path";
import { generationQueue } from "./generation-queue.ts";
import {
  fingerprintGenerationInputs,
  hydrateGenerationCache,
  loadGenerationCache,
  storeGenerationCache,
  type GenerationCacheArtifact,
  type GenerationCacheInputs,
} from "./generation-cache.ts";
import { loadCompanyCatalog } from "../config/catalog-loader.ts";
import { normalizeSavingsPlan } from "../savings/savings-normalizer.ts";
import { validateFormalSavingsPlan } from "../savings/formal-deck-validator.ts";
import { MultiAgentPipeline } from "../pipeline/orchestrator.ts";
import { buildDeckContract, savingsToDeckProduct, type DeckSalesInsight } from "../render/normalized-deck.ts";
import { renderFastPptx } from "../render/fast-pptx.ts";
import type { Session } from "../storage/session-store.ts";
import type { NormalizedProductPlan } from "../bundles/bundle-planner.ts";
import type { SavingsPlanExtraction } from "../schemas/savings-plan.ts";
import { normalizeCiPlan } from "../ci/ci-normalizer.ts";
import { normalizeIulPlan } from "../iul/iul-normalizer.ts";
import type { CiPlanExtraction } from "../schemas/critical-illness.ts";
import type { IulExtraction } from "../schemas/iul.ts";

export interface GenerationTargetPaths {
  pptPath: string;
  markdownPath?: string;
  pdfPath?: string;
}

export interface GenerationContext {
  session: Session;
  ownerId: string;
  uiCompanyId: string;
  uiCompanyName: string;
  tenantId: string;
  style: string;
  stylePreset: string;
  quality: "standard" | "high";
  outputFormat: "pptx" | "pdf";
  templateId?: string;
  companyInfo?: string;
  targetPaths: GenerationTargetPaths;
  currentUserName?: string;
  companyEvidence: Array<{ text: string; sourceFile: string }>;
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function buildChatHash(session: Session): string {
  const recent = session.chatHistory.slice(-20).map((m) => `${m.role}:${m.content}`).join("\n");
  return sha256(recent);
}

function buildExtractionHashes(session: Session): string[] {
  return session.extractions
    .filter((entry) => entry.data)
    .map((entry) => sha256(JSON.stringify(entry.data)));
}

function buildExtractionKinds(session: Session): string[] {
  return session.extractions
    .filter((entry) => entry.data)
    .map((entry) => entry.planType);
}

function getSavingsEntry(session: Session): { entry: Session["extractions"][number]; data: SavingsPlanExtraction } | null {
  const entry = session.extractions.find((item) => item.planType === "savings" && item.data);
  if (!entry?.data) return null;
  return { entry, data: entry.data as SavingsPlanExtraction };
}

function getSavingsSignatureId(data: SavingsPlanExtraction): string | undefined {
  return (data as any)?.source?.signatureId || (data as any)?._meta?.signatureId;
}

function shouldUseHermesFastPath(session: Session, outputFormat: "pptx" | "pdf", quality: "standard" | "high"): boolean {
  if (quality === "high") return false;
  if (outputFormat !== "pptx") return false;
  if (session.extractions.length !== 1) return false;
  const savings = getSavingsEntry(session);
  if (!savings) return false;
  return Boolean(getSavingsSignatureId(savings.data));
}

function buildFastSalesInsights(normalized: ReturnType<typeof normalizeSavingsPlan>): DeckSalesInsight {
  const totalPremium = normalized.policy.contractualTotalPremium || 0;
  const rows = normalized.benefitRows;
  const y20 = rows.find((row) => row.policyYear === 20) || rows[rows.length - 1];
  const y30 = rows.find((row) => row.policyYear === 30) || rows[rows.length - 1];
  const breakeven = rows.find((row) => row.totalSurrenderValue >= totalPremium)?.policyYear;
  const targetCustomer =
    normalized.insured.age <= 12
      ? "教育金家庭"
      : normalized.insured.age >= 50
        ? "养老现金流家庭"
        : "家庭财富规划客户";
  const highlights: DeckSalesInsight["highlightNumbers"] = [];
  if (breakeven) highlights.push({ year: breakeven, label: "回本", value: breakeven, description: "本息首次超过总保费" });
  if (y20) highlights.push({ year: 20, label: "20年倍数", value: totalPremium ? y20.totalSurrenderValue / totalPremium : 0, description: "20年现金价值倍数" });
  if (y30) highlights.push({ year: 30, label: "30年倍数", value: totalPremium ? y30.totalSurrenderValue / totalPremium : 0, description: "30年现金价值倍数" });
  return {
    targetCustomer,
    keySellingPoints: [
      `${normalized.policy.payYears}年缴费`,
      breakeven ? `第${breakeven}年回本` : "长期复利增长",
      y20 ? `20年约${(y20.totalSurrenderValue / (totalPremium || 1)).toFixed(2)}倍` : "20年价值增长",
      y30 ? `30年约${(y30.totalSurrenderValue / (totalPremium || 1)).toFixed(2)}倍` : "30年价值增长",
    ],
    suggestedNarrative: normalized.insured.age <= 12
      ? "以教育金规划与长期现金价值增长为主"
      : "以家庭财富累积与现金流安排为主",
    highlightNumbers: highlights,
  };
}

function fastThemeFromStyle(stylePreset: string): "deepblue" | "caramel" | "chinese" {
  const s = stylePreset.toLowerCase();
  if (s.includes("chinese") || s.includes("ink")) return "chinese";
  if (s.includes("warm") || s.includes("caramel")) return "caramel";
  return "deepblue";
}

async function runFastSavingsGeneration(params: {
  session: Session;
  targetPptPath: string;
  outputStem: string;
  stylePreset: string;
  outputFormat: "pptx";
  companyId: string;
  companyName: string;
  companyRating?: string;
  companyEvidence: Array<{ text: string; sourceFile: string }>;
  currentUserName?: string;
}): Promise<GenerationCacheArtifact> {
  const savings = getSavingsEntry(params.session);
  if (!savings) throw new Error("No savings extraction found");

  const source = (savings.data as any).source || {};
  const signatureId = getSavingsSignatureId(savings.data);
  const normalized = normalizeSavingsPlan(savings.data, {
    pdfPath: source.pdfPath,
    parser: source.parser || "api-fast",
    signatureId: source.signatureId || signatureId,
  } as any);
  const issues = validateFormalSavingsPlan(normalized);
  const errors = issues.filter((issue) => issue.level === "error");
  if (errors.length) {
    throw new Error(`Formal savings validation failed: ${errors.map((i) => i.message).join("; ")}`);
  }

  const company = loadCompanyCatalog().find((item) => item.id === params.companyId);
  const product = savingsToDeckProduct(normalized, buildFastSalesInsights(normalized));
  const deck = buildDeckContract({
    customer: { name: params.currentUserName || normalized.insured.name || "尊贵客户", age: normalized.insured.age, gender: normalized.insured.gender },
    tenantId: params.companyId,
    stylePreset: params.stylePreset,
    quality: "standard",
    outputFormat: params.outputFormat,
    outputStem: params.outputStem,
    company: {
      id: params.companyId,
      displayName: params.companyName,
      shortEn: params.companyId.toUpperCase(),
      rating: params.companyRating,
      evidence: params.companyEvidence,
    },
    products: [product],
    meta: {
      pdfHash: normalized.source.pdfHash,
      pdfPath: normalized.source.pdfPath || source.pdfPath || "",
      parser: normalized.source.parser,
      signatureId: normalized.source.signatureId,
      productCode: source.productCode,
      extractedAt: new Date().toISOString(),
    },
    fidelity: {
      passed: errors.length === 0,
      issueCount: issues.length,
      errors: errors.length,
      warnings: issues.filter((issue) => issue.level === "warn").length,
      crossCheckPassRate: issues.some((issue) => issue.code === "CROSS_CHECK_PASS") ? 1 : 0,
    },
  });

  const renderTheme = fastThemeFromStyle(params.stylePreset);
  const rendered = await renderFastPptx(deck, {
    outputPath: params.targetPptPath,
    theme: renderTheme,
  });

  if (!fs.existsSync(rendered.path)) {
    throw new Error("Fast PPTX output missing");
  }

  return {
    mode: "fast",
    pptPath: rendered.path,
  };
}

async function runFormalGeneration(params: {
  sessionData: Session;
  targetPptPath: string;
  targetMarkdownPath?: string;
  outputStem: string;
  companyId: string;
  companyName: string;
  stylePreset: string;
  quality: "standard" | "high";
  companyContext: any;
  savingsMetrics?: any;
  extractions: NormalizedProductPlan[];
  format: "pptx" | "pdf";
  userId: string;
  customerName: string;
}): Promise<GenerationCacheArtifact> {
  const pipeline = new MultiAgentPipeline();
  const pipeResult = await pipeline.run({
    tenantId: params.companyId,
    userId: params.userId,
    sessionId: params.sessionData.id,
    customerName: params.customerName,
    outputStem: params.outputStem,
    quality: params.quality,
    format: params.format,
    stylePreset: params.stylePreset as any,
    companyContext: params.companyContext,
    savingsMetrics: params.savingsMetrics,
    extractions: (params.sessionData?.extractions || []) as any,
  });

  const built = params.format === "pdf" ? pipeResult.deck.pdfPath : pipeResult.deck.pptxPath;
  if (!built || !fs.existsSync(built)) throw new Error("Pipeline output missing");

  fs.copyFileSync(built, params.targetPptPath);
  let markdownPath: string | undefined;
  if (pipeResult.deck.marpPath && fs.existsSync(pipeResult.deck.marpPath) && params.targetMarkdownPath) {
    fs.copyFileSync(pipeResult.deck.marpPath, params.targetMarkdownPath);
    markdownPath = params.targetMarkdownPath;
  }
  return {
    mode: "formal",
    pptPath: params.targetPptPath,
    markdownPath,
    pdfPath: params.format === "pdf" ? params.targetPptPath : undefined,
  };
}

export async function generatePresentationArtifact(params: {
  session: Session;
  ownerId: string;
  companyId: string;
  companyName: string;
  companyRating?: string;
  companyEvidence: Array<{ text: string; sourceFile: string }>;
  style: string;
  stylePreset: string;
  quality: "standard" | "high";
  outputFormat: "pptx" | "pdf";
  templateId?: string;
  companyContext: any;
  savingsMetrics?: any;
  customerName: string;
  userId: string;
  outputStem: string;
  targets: GenerationTargetPaths;
}): Promise<{ artifact: GenerationCacheArtifact; cacheKey: string; cacheHit: boolean; mode: "fast" | "formal"; }> {
  const extractionHashes = buildExtractionHashes(params.session);
  const extractionKinds = buildExtractionKinds(params.session);
  const chatHash = shouldUseHermesFastPath(params.session, params.outputFormat, params.quality) ? undefined : buildChatHash(params.session);
  const inputs: GenerationCacheInputs = {
    ownerId: params.ownerId,
    companyId: params.companyId,
    stylePreset: params.stylePreset,
    quality: params.quality,
    outputFormat: params.outputFormat,
    templateId: params.templateId,
    fastPath: shouldUseHermesFastPath(params.session, params.outputFormat, params.quality),
    extractionHashes,
    extractionKinds,
    chatHash,
  };
  const cacheKey = fingerprintGenerationInputs(inputs);

  return await generationQueue.run(cacheKey, async () => {
    const cached = loadGenerationCache(cacheKey);
    if (cached) {
      const hydrated = hydrateGenerationCache(cacheKey, params.targets);
      if (!hydrated) {
        throw new Error("Cached generation manifest exists but files are missing");
      }
      return { artifact: hydrated, cacheKey, cacheHit: true, mode: hydrated.mode };
    }

    let artifact: GenerationCacheArtifact;
    const canUseFast = shouldUseHermesFastPath(params.session, params.outputFormat, params.quality);
    if (canUseFast) {
      artifact = await runFastSavingsGeneration({
        session: params.session,
        targetPptPath: params.targets.pptPath,
        outputStem: params.outputStem,
        stylePreset: params.stylePreset,
        outputFormat: "pptx",
        companyId: params.companyId,
        companyName: params.companyName,
        companyRating: params.companyRating,
        companyEvidence: params.companyEvidence,
        currentUserName: params.customerName,
      });
    } else {
      const normalizedExtractions: NormalizedProductPlan[] = params.session.extractions
        .filter((entry) => entry.data)
        .map((entry) => {
          const data = entry.data!;
          // 关键: 把 pdfPath 传进 normalize, 让它算 source.pdfHash
          const normOpts = { pdfPath: entry.pdfPath, parser: "formal-route" as const };
          if (entry.planType === "savings") return normalizeSavingsPlan(data as SavingsPlanExtraction, normOpts);
          if (entry.planType === "ci") return normalizeCiPlan(data as CiPlanExtraction, normOpts);
          return normalizeIulPlan(data as IulExtraction, normOpts);
        });
        artifact = await runFormalGeneration({
        sessionData: params.session,
        targetPptPath: params.targets.pptPath,
        targetMarkdownPath: params.targets.markdownPath,
        outputStem: params.outputStem,
        companyId: params.companyId,
        companyName: params.companyName,
        stylePreset: params.stylePreset,
        quality: params.quality,
        companyContext: params.companyContext,
        savingsMetrics: params.savingsMetrics,
        extractions: normalizedExtractions,
        format: params.outputFormat,
        userId: params.userId,
        customerName: params.customerName,
      });
    }

    storeGenerationCache(cacheKey, artifact, inputs);
    return { artifact, cacheKey, cacheHit: false, mode: artifact.mode };
  });
}
