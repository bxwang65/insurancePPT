import assert from "node:assert/strict";
import { loadTemplateCatalog } from "../src/config/template-catalog.ts";
import { listTemplateAssets } from "../src/config/template-assets.ts";
import { hasCiCloneRenderer, hasIulCloneRenderer, hasSavingsCloneRenderer } from "../src/templates/clone-renderer-registry.ts";

const templateAssets = new Set(listTemplateAssets().map((asset) => asset.id));
const templates = loadTemplateCatalog();

const status = templates.map((template) => {
  const sourceTemplateOk = !template.sourceTemplateAssetId || templateAssets.has(template.sourceTemplateAssetId);
  const rendererOk = !template.cloneReady
    ? template.cloneRenderer == null
    : template.planType === "savings"
      ? hasSavingsCloneRenderer(template.cloneRenderer)
      : template.planType === "ci"
        ? hasCiCloneRenderer(template.cloneRenderer)
        : template.planType === "iul"
          ? hasIulCloneRenderer(template.cloneRenderer)
      : Boolean(template.cloneRenderer);
  return {
    id: template.id,
    status: sourceTemplateOk && rendererOk ? "ok" : "blocked",
    sourceTemplateOk,
    rendererOk,
    cloneReady: Boolean(template.cloneReady),
  };
});

assert.ok(status.length > 0, "template catalog should not be empty");
for (const item of status) {
  if (item.cloneReady) {
    assert.equal(item.status, "ok", `cloneReady template should not be blocked: ${item.id}`);
  }
}

console.log(JSON.stringify({ status: "ok", templates: status }, null, 2));
