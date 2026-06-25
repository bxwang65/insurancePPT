import { loadBundleCatalog, loadProductCatalog } from "./catalog-loader.ts";
import { loadTemplateCatalog } from "./template-catalog.ts";
import { listTemplateAssets } from "./template-assets.ts";
import { hasCiCloneRenderer, hasIulCloneRenderer, hasSavingsCloneRenderer } from "../templates/clone-renderer-registry.ts";
import { hasBundleRenderer } from "../bundles/bundle-renderer-registry.ts";

type PlanType = "savings" | "ci" | "iul";

export interface ProductExportReadiness {
  planType: PlanType;
  formalReady: boolean;
  templateCount: number;
  cloneReadyCount: number;
  reasons: string[];
}

export interface BundleExportReadiness {
  bundleId: string;
  displayName: string;
  products: PlanType[];
  formalReady: boolean;
  reasons: string[];
}

export function buildExportReadinessMatrix(): {
  productReadiness: ProductExportReadiness[];
  bundleReadiness: BundleExportReadiness[];
} {
  const templates = loadTemplateCatalog();
  const templateAssets = new Set(listTemplateAssets().map((asset) => asset.id));
  const products = loadProductCatalog();
  const bundles = loadBundleCatalog();

  const planTypes: PlanType[] = ["savings", "ci", "iul"];
  const productReadiness = planTypes.map((planType) => {
    const byType = templates.filter((template) => template.planType === planType);
    const cloneReadyTemplates = byType.filter((template) => template.cloneReady);
    const reasons: string[] = [];
    if (byType.length === 0) reasons.push("TEMPLATE_MISSING");
    if (cloneReadyTemplates.length === 0) reasons.push("CLONE_TEMPLATE_NOT_READY");
    for (const template of cloneReadyTemplates) {
      if (template.sourceTemplateAssetId && !templateAssets.has(template.sourceTemplateAssetId)) {
        reasons.push(`SOURCE_TEMPLATE_ASSET_MISSING:${template.id}`);
      }
      if (!template.cloneRenderer) {
        reasons.push(`CLONE_RENDERER_MISSING:${template.id}`);
      } else if (
        (planType === "savings" && !hasSavingsCloneRenderer(template.cloneRenderer)) ||
        (planType === "ci" && !hasCiCloneRenderer(template.cloneRenderer)) ||
        (planType === "iul" && !hasIulCloneRenderer(template.cloneRenderer))
      ) {
        reasons.push(`CLONE_RENDERER_UNIMPLEMENTED:${template.cloneRenderer}`);
      }
    }

    const hasCatalog = products.some((product) => product.planType === planType);
    if (!hasCatalog) reasons.push("PRODUCT_CATALOG_MISSING");
    return {
      planType,
      formalReady: reasons.length === 0,
      templateCount: byType.length,
      cloneReadyCount: cloneReadyTemplates.length,
      reasons: [...new Set(reasons)],
    } satisfies ProductExportReadiness;
  });

  const productMap = new Map(productReadiness.map((item) => [item.planType, item]));
  const bundleReadiness = bundles.map((bundle) => {
    const reasons: string[] = [];
    for (const planType of bundle.products) {
      const status = productMap.get(planType);
      if (!status || !status.formalReady) reasons.push(`PRODUCT_NOT_READY:${planType}`);
    }
    if (bundle.status && bundle.status !== "active") reasons.push(`BUNDLE_STATUS_${bundle.status.toUpperCase()}`);
    if ((bundle.status || "active") === "active" && bundle.templateFamily === "bundle" && !hasBundleRenderer(bundle.id)) {
      reasons.push("BUNDLE_RENDERER_NOT_IMPLEMENTED");
    }
    return {
      bundleId: bundle.id,
      displayName: bundle.displayName,
      products: bundle.products,
      formalReady: reasons.length === 0,
      reasons: [...new Set(reasons)],
    } satisfies BundleExportReadiness;
  });

  return { productReadiness, bundleReadiness };
}
