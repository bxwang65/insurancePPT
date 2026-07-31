import { loadBundleCatalog, type BundleCatalogEntry } from "../config/catalog-loader.ts";
import type { NormalizedSavingsPlan } from "../savings/savings-normalizer.ts";
import type { NormalizedCiPlan } from "../ci/ci-normalizer.ts";
import type { NormalizedIulPlan } from "../iul/iul-normalizer.ts";

export type NormalizedProductPlan = NormalizedSavingsPlan | NormalizedCiPlan | NormalizedIulPlan;

export interface BundlePlan {
  bundleId: string;
  displayName: string;
  products: NormalizedProductPlan[];
  modules: string[];
}

export function resolveBundle(products: NormalizedProductPlan[]): BundleCatalogEntry {
  const kinds = [...new Set(products.map((product) => product.kind))].sort();
  const bundle = loadBundleCatalog().find((candidate) =>
    [...candidate.products].sort().join(",") === kinds.join(",")
  );
  if (!bundle) throw new Error(`No bundle config for products: ${kinds.join(",")}`);
  return bundle;
}

export function planBundle(products: NormalizedProductPlan[]): BundlePlan {
  const bundle = resolveBundle(products);
  return {
    bundleId: bundle.id,
    displayName: bundle.displayName,
    products,
    modules: [...bundle.modules],
  };
}
