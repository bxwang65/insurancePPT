import assert from "node:assert/strict";
import { requireSelectedCompany } from "../src/api/company-selection.ts";

assert.throws(() => requireSelectedCompany(""), /请选择公司后再生成正式版/);
assert.throws(() => requireSelectedCompany("unknown-company"), /公司选择无效/);

const company = requireSelectedCompany("aia");
assert.equal(company?.id, "aia");

console.log(JSON.stringify({
  status: "ok",
  requiresCompanySelection: true,
  invalidCompanyBlocked: true,
  validCompanyResolved: company?.id,
}, null, 2));
