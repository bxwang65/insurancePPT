import assert from "node:assert/strict";
import { expectedCompanyIdForProduct, matchCompanyKnowledge } from "../src/config/company-kb.ts";

const productName = "「匠X・传承」储蓄寿险计划2(尊尚版)";
assert.equal(expectedCompanyIdForProduct(productName), "ctf");

const forced = matchCompanyKnowledge({ productName, forcedCompanyId: "ctf" });
assert.equal(forced.companyId, "ctf");
assert.equal(forced.matchedBy, "company_forced");
assert.ok(forced.evidenceFiles.length > 0);

const auto = matchCompanyKnowledge({ productName });
assert.equal(auto.companyId, "ctf");
assert.equal(auto.matchedBy, "product_catalog");

console.log(JSON.stringify({
  status: "ok",
  expectedCompanyId: expectedCompanyIdForProduct(productName),
  forced: { companyId: forced.companyId, matchedBy: forced.matchedBy, evidenceCount: forced.evidenceFiles.length },
  auto: { companyId: auto.companyId, matchedBy: auto.matchedBy, confidence: auto.confidence },
}, null, 2));
