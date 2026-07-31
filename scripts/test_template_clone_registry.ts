import assert from "node:assert/strict";
import { loadTemplateCatalog } from "../src/config/template-catalog.ts";
import { hasCiCloneRenderer, hasIulCloneRenderer, hasSavingsCloneRenderer } from "../src/templates/clone-renderer-registry.ts";

const templates = loadTemplateCatalog();
const cloneReady = templates.filter((template) => template.cloneReady);
const missing = cloneReady
  .filter((template) =>
    template.planType === "savings"
      ? !hasSavingsCloneRenderer(template.cloneRenderer)
      : template.planType === "ci"
        ? !hasCiCloneRenderer(template.cloneRenderer)
        : template.planType === "iul"
          ? !hasIulCloneRenderer(template.cloneRenderer)
          : !template.cloneRenderer)
  .map((template) => ({ id: template.id, renderer: template.cloneRenderer }));

assert.equal(missing.length, 0, `Missing clone renderer implementations: ${JSON.stringify(missing)}`);

console.log(JSON.stringify({
  status: "ok",
  cloneReadyTemplates: cloneReady.map((template) => ({ id: template.id, renderer: template.cloneRenderer })),
}, null, 2));
