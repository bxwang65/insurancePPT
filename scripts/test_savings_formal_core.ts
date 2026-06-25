import fs from "fs";
import { extractSavingsTables } from "../src/extraction/savings-table-parser.ts";
import { normalizeSavingsPlan } from "../src/savings/savings-normalizer.ts";
import { validateFormalSavingsPlan } from "../src/savings/formal-deck-validator.ts";
import type { SavingsPlanExtraction } from "../src/schemas/savings-plan.ts";

const pdf = process.argv[2] || "/Users/soldier/Downloads/官方计划书案例/環宇盈活儲蓄保險計劃.pdf";
if (!fs.existsSync(pdf)) throw new Error(`fixture missing: ${pdf}`);

const tables = await extractSavingsTables(pdf);
const raw = {
  product_name: "環球盈活儲蓄保險計劃",
  insured: { name: "VIP 先生", age: 1, gender: "男", smoker: null },
  policy: {
    product_name: "環球盈活儲蓄保險計劃",
    currency: "美元",
    sum_insured: 105000,
    basic_sum_insured: 1027750,
    annual_premium: 100000,
    premium_payment_period: "5年",
    coverage_period: "终身",
    total_premium_with_levy: 100012.94,
  },
  benefit_illustration: tables.benefit_illustration,
  withdrawal_illustration: tables.withdrawal_illustration,
} as SavingsPlanExtraction;

const normalized = normalizeSavingsPlan(raw, { pdfPath: pdf, parser: tables.parser });
const issues = validateFormalSavingsPlan(normalized);
const blocking = issues.filter((issue) => issue.level === "error");
const y6 = normalized.withdrawalRows.find((row) => row.policyYear === 6);
const y20 = normalized.withdrawalRows.find((row) => row.policyYear === 20);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(normalized.benefitRows.length === 99, `expected 99 benefit rows, received ${normalized.benefitRows.length}`);
assert(normalized.withdrawalRows.length === 99, `expected 99 withdrawal rows, received ${normalized.withdrawalRows.length}`);
assert(y6?.annualWithdrawal === 35000, `Y6 withdrawal mismatch: ${y6?.annualWithdrawal}`);
assert(y6?.surrenderValueAfter === 405900, `Y6 surrender mismatch: ${y6?.surrenderValueAfter}`);
assert(y20?.cumulativeWithdrawal === 525000, `Y20 cumulative mismatch: ${y20?.cumulativeWithdrawal}`);
assert(y20?.surrenderValueAfter === 479749, `Y20 surrender mismatch: ${y20?.surrenderValueAfter}`);
assert(normalized.policy.contractualTotalPremium === 500000, `contract total mismatch: ${normalized.policy.contractualTotalPremium}`);
assert(blocking.length === 0, `formal QA blocked: ${JSON.stringify(blocking)}`);

console.log(JSON.stringify({
  status: "ok",
  sourceHash: normalized.source.pdfHash,
  benefitRows: normalized.benefitRows.length,
  withdrawalRows: normalized.withdrawalRows.length,
  y6,
  y20,
  issues,
}, null, 2));
