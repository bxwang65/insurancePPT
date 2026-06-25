import assert from "node:assert/strict";
import { evaluateBundleGate } from "../src/bundles/bundle-gate.ts";

const plannedIssues = evaluateBundleGate({
  bundleId: "savings-ci",
  bundleConfig: {
    id: "savings-ci",
    displayName: "储蓄险+重疾险",
    products: ["savings", "ci"],
    templateFamily: "bundle",
    status: "planned",
    modules: [],
  },
});
assert.ok(plannedIssues.some((issue) => issue.code === "BUNDLE_STATUS_PLANNED"));

const activeBundleNoRenderer = evaluateBundleGate({
  bundleId: "nonexistent-bundle",
  bundleConfig: {
    id: "nonexistent-bundle",
    displayName: "储蓄险+重疾险+IUL",
    products: ["savings", "ci", "iul"],
    templateFamily: "bundle",
    status: "active",
    modules: [],
  },
});
assert.ok(activeBundleNoRenderer.some((issue) => issue.code === "BUNDLE_RENDERER_NOT_IMPLEMENTED"));

const activeSingle = evaluateBundleGate({
  bundleId: "ci-single",
  bundleConfig: {
    id: "ci-single",
    displayName: "单一重疾险",
    products: ["ci"],
    templateFamily: "ci",
    status: "active",
    modules: [],
  },
});
assert.equal(activeSingle.length, 0);

console.log(JSON.stringify({
  status: "ok",
  plannedBlocked: true,
  activeBundleRendererBlocked: true,
  activeSinglePass: true,
}, null, 2));
