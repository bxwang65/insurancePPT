import assert from "node:assert/strict";
import { buildExportReadinessMatrix } from "../src/config/export-readiness.ts";

const matrix = buildExportReadinessMatrix();
const savings = matrix.productReadiness.find((x) => x.planType === "savings");
const ci = matrix.productReadiness.find((x) => x.planType === "ci");
const iul = matrix.productReadiness.find((x) => x.planType === "iul");

assert.ok(savings);
assert.ok(ci);
assert.ok(iul);
assert.equal(savings!.formalReady, true);
assert.equal(ci!.formalReady, true);
assert.equal(iul!.formalReady, true);

const bundleCi = matrix.bundleReadiness.find((x) => x.bundleId === "savings-ci");
const bundleIul = matrix.bundleReadiness.find((x) => x.bundleId === "savings-ci-iul");
const bundleCiSingle = matrix.bundleReadiness.find((x) => x.bundleId === "ci-single");
const bundleIulSingle = matrix.bundleReadiness.find((x) => x.bundleId === "iul-single");
assert.ok(bundleCi);
assert.ok(bundleIul);
assert.ok(bundleCiSingle);
assert.ok(bundleIulSingle);
assert.equal(bundleCi!.formalReady, true);
assert.equal(bundleIul!.formalReady, true);
assert.equal(bundleCiSingle!.formalReady, true);
assert.equal(bundleIulSingle!.formalReady, true);
assert.equal(bundleCi!.reasons.length, 0);
assert.equal(bundleIul!.reasons.length, 0);
assert.equal(bundleCiSingle!.reasons.length, 0);
assert.equal(bundleIulSingle!.reasons.length, 0);

console.log(JSON.stringify({
  status: "ok",
  products: matrix.productReadiness,
  bundles: matrix.bundleReadiness.map((b) => ({ id: b.bundleId, formalReady: b.formalReady, reasons: b.reasons })),
}, null, 2));
