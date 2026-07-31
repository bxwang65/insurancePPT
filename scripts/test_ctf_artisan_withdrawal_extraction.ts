import assert from "node:assert/strict";
import fs from "fs";
import { extractSavingsTables } from "../src/extraction/savings-table-parser.ts";
import { normalizeSavingsPlan } from "../src/savings/savings-normalizer.ts";
import type { SavingsPlanExtraction } from "../src/schemas/savings-plan.ts";

const pdf = "/Users/soldier/Downloads/官方计划书案例/匠心傳承儲蓄計劃2尊尚版.pdf";
assert.ok(fs.existsSync(pdf), `fixture missing: ${pdf}`);

const tables = await extractSavingsTables(pdf);
assert.ok(tables.benefit_illustration.length >= 120, `expected benefit rows, received ${tables.benefit_illustration.length}`);
assert.ok(tables.withdrawal_illustration.length >= 120, `expected withdrawal rows, received ${tables.withdrawal_illustration.length}`);

const raw = {
  product_name: "「匠X・传承」储蓄寿险计划2(尊尚版)",
  insured: { name: "VIP 先生", age: 1, gender: "男", smoker: null },
  policy: {
    product_name: "「匠X・传承」储蓄寿险计划2(尊尚版)",
    currency: "美元",
    sum_insured: null,
    basic_sum_insured: null,
    annual_premium: 100000.04,
    premium_payment_period: "5年",
    coverage_period: "至128岁",
    total_premium_with_levy: 100012.86,
  },
  benefit_illustration: tables.benefit_illustration,
  withdrawal_illustration: tables.withdrawal_illustration,
} as SavingsPlanExtraction;

const normalized = normalizeSavingsPlan(raw, { pdfPath: pdf, parser: tables.parser });
const y6 = normalized.withdrawalRows.find((row) => row.policyYear === 6);
const y20 = normalized.withdrawalRows.find((row) => row.policyYear === 20);
const y30 = normalized.withdrawalRows.find((row) => row.policyYear === 30);

assert.equal(y6?.annualWithdrawal, 35000);
assert.equal(y6?.cumulativeWithdrawal, 35000);
assert.equal(y6?.surrenderValueAfter, 304801);
assert.equal(y20?.annualWithdrawal, 35000);
assert.equal(y20?.cumulativeWithdrawal, 525006);
assert.equal(y20?.surrenderValueAfter, 609591);
assert.equal(y30?.annualWithdrawal, 35002);
assert.equal(y30?.cumulativeWithdrawal, 875016);
assert.equal(y30?.surrenderValueAfter, 866288);

console.log(JSON.stringify({
  status: "ok",
  benefitRows: normalized.benefitRows.length,
  withdrawalRows: normalized.withdrawalRows.length,
  y6,
  y20,
  y30,
}, null, 2));
