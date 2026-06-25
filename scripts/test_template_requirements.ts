import assert from "node:assert/strict";
import { validateTemplateRequirements } from "../src/pipeline/template-requirements.ts";
import type { PipelineRequest } from "../src/pipeline/types.ts";

const req = {
  stylePreset: "chinese",
  normalizedSavings: {
    kind: "savings",
    productName: "test",
    insured: { name: "n", age: 1, gender: "男" },
    policy: { currency: "USD", annualPremium: 1, annualPremiumWithLevy: null, payYears: 1, contractualTotalPremium: 1, coveragePeriod: "终身" },
    benefitRows: [],
    withdrawalRows: [],
    withdrawalProvenance: "official_extracted",
    source: { pdfHash: "x", parser: "x" },
  },
} as unknown as PipelineRequest;

const ok = validateTemplateRequirements(req, {
  markdownPath: "x",
  slides: [
    { id: "1", pageType: "cover", title: "", bullets: [] },
    { id: "2", pageType: "company", title: "", bullets: [] },
    { id: "3", pageType: "narrative", title: "", bullets: [] },
    { id: "4", pageType: "chart", title: "", bullets: [] },
    { id: "5", pageType: "chart", title: "", bullets: [] },
    { id: "6", pageType: "timeline", title: "", bullets: [] },
    { id: "7", pageType: "timeline", title: "", bullets: [] },
    { id: "8", pageType: "table", title: "", bullets: [] },
    { id: "9", pageType: "table", title: "", bullets: [] },
    { id: "10", pageType: "conclusion", title: "", bullets: [] },
  ],
});
assert.equal(ok.length, 0);

const bad = validateTemplateRequirements(req, {
  markdownPath: "x",
  slides: [
    { id: "1", pageType: "cover", title: "", bullets: [] },
    { id: "2", pageType: "company", title: "", bullets: [] },
    { id: "3", pageType: "chart", title: "", bullets: [] },
  ],
});
assert.ok(bad.some((x) => x.code === "TEMPLATE_PAGE_TYPE_MISSING"));

console.log(JSON.stringify({ status: "ok", requiredChecks: 2 }, null, 2));
