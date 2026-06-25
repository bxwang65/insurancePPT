import assert from "node:assert/strict";
import { matchCompanyKnowledge } from "../src/config/company-kb.ts";
import { validateCompanyEvidence } from "../src/pipeline/company-evidence-validator.ts";
import { loadCompanyKnowledgeIndex } from "../src/knowledge/company-knowledge-index.ts";

const index = loadCompanyKnowledgeIndex();
if (!index) {
  console.log(JSON.stringify({ status: "ok", skipped: true, reason: "company knowledge index not found" }, null, 2));
  process.exit(0);
}

const matched = matchCompanyKnowledge({ forcedCompanyId: "aia" });
const issues = validateCompanyEvidence({ companyId: matched.companyId, evidenceFiles: matched.evidenceFiles });
assert.equal(issues.filter((x) => x.level === "error").length, 0);

const forged = validateCompanyEvidence({
  companyId: matched.companyId,
  evidenceFiles: [...matched.evidenceFiles.slice(0, 1), "/tmp/not-indexed-company-evidence.pdf"],
});
assert.ok(forged.some((issue) => issue.code === "COMPANY_EVIDENCE_FILE_MISSING" || issue.code === "COMPANY_EVIDENCE_NOT_PUBLIC_INDEXED"));

console.log(JSON.stringify({
  status: "ok",
  matchedCompanyId: matched.companyId,
  evidenceCount: matched.evidenceFiles.length,
  guardChecks: {
    validEvidenceErrors: issues.filter((x) => x.level === "error").length,
    forgedEvidenceDetected: true,
  },
}, null, 2));

