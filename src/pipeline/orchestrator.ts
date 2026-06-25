import fs from "fs";
import path from "path";
import { getTenantConfig } from "../config/tenants.ts";
import { ChartAgent } from "./chart-agent.ts";
import { ImageAgent } from "./image-agent.ts";
import { OutlineAgent } from "./outline-agent.ts";
import { PresentationAgent } from "./presentation-agent.ts";
import type { PipelineRequest } from "./types.ts";
import { normalizeSavingsPlan } from "../savings/savings-normalizer.ts";
import { FormalDeckValidationError, validateFormalSavingsPlan } from "../savings/formal-deck-validator.ts";
import { extractSavingsTables } from "../extraction/savings-table-parser.ts";
import { validateDeckQuality } from "./deck-quality.ts";
import { normalizeCiPlan } from "../ci/ci-normalizer.ts";
import { validateFormalCiPlan } from "../ci/formal-ci-validator.ts";
import { normalizeIulPlan } from "../iul/iul-normalizer.ts";
import { validateFormalIulPlan } from "../iul/formal-iul-validator.ts";
import { planBundle, type NormalizedProductPlan } from "../bundles/bundle-planner.ts";
import { validateTemplateRequirements } from "./template-requirements.ts";
import { validateCompanyEvidence } from "./company-evidence-validator.ts";
import { loadBundleCatalog } from "../config/catalog-loader.ts";
import { evaluateBundleGate } from "../bundles/bundle-gate.ts";
import { hasBundleRenderer, runBundleRenderer } from "../bundles/bundle-renderer-registry.ts";

export class MultiAgentPipeline {
  private outlineAgent = new OutlineAgent();
  private chartAgent = new ChartAgent();
  private imageAgent = new ImageAgent();
  private presentationAgent = new PresentationAgent();

  async run(req: PipelineRequest) {
    const tenant = getTenantConfig(req.tenantId);
    const outDir = path.resolve("outputs", `${req.outputStem || req.sessionId}_pipeline`);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const savings = req.extractions.find((item) => item.planType === "savings");
    if (savings) {
      if (savings.pdfPath) {
        const tables = await extractSavingsTables(savings.pdfPath);
        if (tables.benefit_illustration.length >= 20) savings.data.benefit_illustration = tables.benefit_illustration;
        if (tables.withdrawal_illustration.length) savings.data.withdrawal_illustration = tables.withdrawal_illustration;
      }
      req.normalizedSavings = normalizeSavingsPlan(savings.data, { pdfPath: savings.pdfPath, parser: "fitz-table-v1+llm-json" });
    }
    const ci = req.extractions.find((item) => item.planType === "ci");
    if (ci) req.normalizedCi = normalizeCiPlan(ci.data, { pdfPath: ci.pdfPath, parser: "llm-json" });
    const iul = req.extractions.find((item) => item.planType === "iul");
    if (iul) req.normalizedIul = normalizeIulPlan(iul.data, { pdfPath: iul.pdfPath, parser: "llm-json" });

    const normalizedProducts: NormalizedProductPlan[] = [
      ...(req.normalizedSavings ? [req.normalizedSavings] : []),
      ...(req.normalizedCi ? [req.normalizedCi] : []),
      ...(req.normalizedIul ? [req.normalizedIul] : []),
    ];
    const qaIssues = [
      ...(req.normalizedSavings ? validateFormalSavingsPlan(req.normalizedSavings) : []),
      ...(req.normalizedCi ? validateFormalCiPlan(req.normalizedCi) : []),
      ...(req.normalizedIul ? validateFormalIulPlan(req.normalizedIul) : []),
      ...validateCompanyEvidence({
        companyId: req.companyContext?.companyId,
        evidenceFiles: req.companyContext?.evidenceFiles,
      }),
    ];
    let bundlePlan;
    try {
      bundlePlan = normalizedProducts.length ? planBundle(normalizedProducts) : undefined;
    } catch (error: any) {
      qaIssues.push({ code: "BUNDLE_CONFIG_MISSING", level: "error", message: error.message });
    }
    const bundleConfig = bundlePlan
      ? loadBundleCatalog().find((bundle) => bundle.id === bundlePlan.bundleId)
      : undefined;
    qaIssues.push(...evaluateBundleGate({
      bundleConfig,
      bundleId: bundlePlan?.bundleId,
    }));
    const blockingIssues = qaIssues.filter((issue) => issue.level === "error");
    if (blockingIssues.length) throw new FormalDeckValidationError(blockingIssues);

    const outline = await this.outlineAgent.run(req, tenant);
    const templateIssues = validateTemplateRequirements(req, outline);
    qaIssues.push(...templateIssues);
    const templateBlocking = templateIssues.filter((issue) => issue.level === "error");
    if (templateBlocking.length) throw new FormalDeckValidationError(templateBlocking);
    const chartArtifact = await this.chartAgent.run(req, outline);
    const imageArtifact = await this.imageAgent.run(req, tenant, outline);
    const qualityIssues = validateDeckQuality(req, outline, chartArtifact, imageArtifact);
    qaIssues.push(...qualityIssues);
    const qualityBlocking = qualityIssues.filter((issue) => issue.level === "error");
    if (qualityBlocking.length) throw new FormalDeckValidationError(qualityBlocking);
    const deck = bundlePlan && hasBundleRenderer(bundlePlan.bundleId)
      ? await runBundleRenderer(bundlePlan.bundleId, {
        req,
        outDir,
        outline,
        images: imageArtifact,
        charts: chartArtifact,
        tenant,
      })
      : await this.presentationAgent.run(req, tenant, outline, imageArtifact, chartArtifact);

    const manifest = {
      request: req,
      tenant,
      outline,
      chartArtifact,
      imageArtifact,
      deck,
      bundlePlan,
      qa: { issues: qaIssues, exportApproved: blockingIssues.length === 0 },
      generatedAt: new Date().toISOString(),
    };
    const manifestPath = path.join(outDir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    fs.writeFileSync(path.join(outDir, "qa-report.json"), JSON.stringify(manifest.qa, null, 2), "utf8");
    if (req.normalizedSavings) {
      fs.writeFileSync(path.join(outDir, "normalized-savings.json"), JSON.stringify(req.normalizedSavings, null, 2), "utf8");
      fs.writeFileSync(path.join(outDir, "source-ledger.json"), JSON.stringify({
        source: req.normalizedSavings.source,
        benefitRows: req.normalizedSavings.benefitRows.map((row) => ({ policyYear: row.policyYear, sourcePage: row.sourcePage })),
        withdrawalRows: req.normalizedSavings.withdrawalRows.map((row) => ({ policyYear: row.policyYear, sourcePage: row.sourcePage })),
        images: imageArtifact.images,
        companyEvidence: req.companyContext?.evidenceFiles || [],
      }, null, 2), "utf8");
    }

    return { manifestPath, outDir, deck };
  }
}
