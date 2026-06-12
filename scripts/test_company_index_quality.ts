import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { loadCompanyCatalog } from "../src/config/catalog-loader.ts";
import { loadCompanyKnowledgeIndex } from "../src/knowledge/company-knowledge-index.ts";

const index = loadCompanyKnowledgeIndex();
assert.ok(index, "company knowledge index missing; run: bun run index:company-kb");

const companies = loadCompanyCatalog();
const docs = index!.documents || [];
assert.ok(docs.length > 0, "company knowledge index has zero documents");

const mapped = docs.filter((d) => d.companyId !== "unmapped");
const mappedRatio = mapped.length / docs.length;
assert.ok(mappedRatio >= 0.8, `mapped ratio too low: ${mappedRatio.toFixed(2)}`);

const companyCoverage = companies.map((company) => {
  const publicDocs = docs.filter((d) => d.companyId === company.id && (d.audience || "unknown") === "public");
  return {
    companyId: company.id,
    publicDocs: publicDocs.length,
    hasPreferredDirectory: company.knowledgeDirectories.some((dir) =>
      publicDocs.some((d) => d.sourceDirectory === dir),
    ),
  };
});

const missingPublic = companyCoverage.filter((item) => item.publicDocs === 0);
assert.equal(missingPublic.length, 0, `companies missing public docs: ${missingPublic.map((x) => x.companyId).join(",")}`);

const staleFiles = docs.filter((d) => !fs.existsSync(path.join(index!.knowledgeRoot, d.relativePath)));
assert.equal(staleFiles.length, 0, `stale index entries: ${staleFiles.length}`);

console.log(JSON.stringify({
  status: "ok",
  documentCount: docs.length,
  mappedRatio: Number(mappedRatio.toFixed(4)),
  companyCoverage,
}, null, 2));
