import { loadTemplateCatalog } from "../src/config/template-catalog.ts";
import { listTemplateAssets } from "../src/config/template-assets.ts";
import { hasSavingsCloneRenderer } from "../src/templates/clone-renderer-registry.ts";

type Issue = { templateId: string; issue: string };

function main() {
  const templates = loadTemplateCatalog();
  const assets = new Set(listTemplateAssets().map((a) => a.id));
  const issues: Issue[] = [];

  for (const t of templates) {
    if (!t.sourceTemplateAssetId) continue;
    if (!assets.has(t.sourceTemplateAssetId)) {
      issues.push({ templateId: t.id, issue: `missing sourceTemplateAssetId index: ${t.sourceTemplateAssetId}` });
    }
    if (t.cloneReady) {
      if (!t.cloneRenderer) {
        issues.push({ templateId: t.id, issue: "cloneReady=true but cloneRenderer is empty" });
      } else if (t.planType === "savings" && !hasSavingsCloneRenderer(t.cloneRenderer)) {
        issues.push({ templateId: t.id, issue: `unknown savings cloneRenderer: ${t.cloneRenderer}` });
      }
    }
    if (!t.cloneReady && t.cloneRenderer) {
      issues.push({ templateId: t.id, issue: "cloneReady=false but cloneRenderer set; keep config explicit" });
    }
  }

  if (issues.length) {
    console.error(JSON.stringify({ status: "failed", issueCount: issues.length, issues }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ status: "ok", templateCount: templates.length }, null, 2));
}

main();

