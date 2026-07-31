/**
 * 回归测试: Sunlife IUL 趸交 PDF 提取正确性
 *
 * 背景: Sunlife 趸交 PDF (49岁, USD 412,700) 第 7-9 页有"Premium Breakdown"英文表,
 *  旧版 extractor 会因 header 含 "Account" 通过过滤, 且出现在中文表之后触发 last-wins dedup,
 *  导致错误覆盖, 输出"13年缴" + 总保费 5,365,100 (= 412,700 × 13).
 *
 * 修复 (Layer 1+2):
 *  - 严格过滤: 只接受含"保单年度"且 ≤ 3 行的中文利益表
 *  - 自动识别缴费年期: planned_premium > 0 的年度数
 *  - summary.annual_premium 用首个非零 planned_premium
 *
 * 跑法: bun run scripts/test_sunlife_iul_lumpsum.ts
 */
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import assert from "node:assert/strict";

const LUMPSUM_PDF = "/Users/soldier/Downloads/SLS_SBIUL2_F-49-N-CN-USD-S3m-1x__coi__SC_.pdf";
const TEN_YEAR_PDF = "/Users/soldier/Downloads/SLS_SBIUL2+F-37-N-CN-USD-S3m-10x+(coi)(SC)首年2倍TP.pdf";
// 脚本与本测试同目录, 但 path.resolve 基于 cwd, 用 import.meta.dir 更稳
const EXTRACTOR = path.resolve(import.meta.dir, "extract_sunlife_iul.py");

interface ExtractedRow {
  policy_year: number;
  age: number;
  planned_premium: number;
  account_value_gross: number;
  account_value_less_fee: number;
  guaranteed_value: number;
  surrender_value: number;
  sum_insured: number;
  death_benefit: number;
  source_page?: number;
  cumulative_premium_paid: number;
}

interface ExtractedSummary {
  insured_age: number;
  insured_gender: string;
  annual_premium: number;
  sum_insured: number;
  index_accounts: unknown[];
  payment_term_years: number;
  payment_term_label: string;
  total_premium_paid: number;
}

async function runExtractor(pdfPath: string): Promise<{ benefit_illustration: ExtractedRow[]; summary: ExtractedSummary }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [EXTRACTOR, pdfPath]);
    let out = "";
    let err = "";
    proc.stdout.on("data", (chunk) => (out += chunk));
    proc.stderr.on("data", (chunk) => (err += chunk));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`extractor exit ${code}: ${err}`));
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error(`parse fail: ${(e as Error).message}\nstdout: ${out.slice(0, 500)}\nstderr: ${err}`));
      }
    });
  });
}

async function testLumpsum() {
  console.log("\n========== 趸交 PDF 测试 (49岁, USD 412,700) ==========");
  assert.ok(fs.existsSync(LUMPSUM_PDF), `PDF missing: ${LUMPSUM_PDF}`);
  const result = await runExtractor(LUMPSUM_PDF);
  const { summary, benefit_illustration } = result;

  // ── 关键断言: 自动识别缴费年期 ──
  assert.equal(summary.payment_term_years, 1, `payment_term_years should be 1 (趸交), got ${summary.payment_term_years}`);
  assert.equal(summary.payment_term_label, "趸交", `payment_term_label should be "趸交", got "${summary.payment_term_label}"`);

  // ── 关键断言: 总保费 = 412,700 (单年, 不是 5,365,100) ──
  assert.equal(summary.annual_premium, 412700, `annual_premium should be 412700, got ${summary.annual_premium}`);
  assert.equal(summary.total_premium_paid, 412700, `total_premium_paid should be 412700, got ${summary.total_premium_paid}`);

  // ── 关键断言: 年龄正确 (49岁 + 1 = 50) ──
  assert.equal(summary.insured_age, 49, `insured_age should be 49, got ${summary.insured_age}`);
  const y1 = benefit_illustration[0];
  assert.equal(y1.age, 50, `Y1 age should be 50 (49+1), got ${y1.age}`);

  // ── 关键断言: Y1 保费 = 412,700 (趸交全部) ──
  assert.equal(y1.planned_premium, 412700, `Y1 planned_premium should be 412700, got ${y1.planned_premium}`);
  assert.equal(y1.cumulative_premium_paid, 412700, `Y1 cumulative_premium_paid should be 412700, got ${y1.cumulative_premium_paid}`);

  // ── 关键断言: 退保价值是真值 (336697), 不是英文表污染 (33) ──
  assert.ok(y1.surrender_value > 100000, `Y1 surrender_value should be > 100000 (real non-guaranteed value), got ${y1.surrender_value} (可能英文 Premium Breakdown 表污染)`);

  // ── 关键断言: 身故赔偿 = 3,000,000 (保额), 不是英文表 Surrender Charge (55715) ──
  assert.equal(y1.sum_insured, 3000000, `Y1 sum_insured should be 3,000,000, got ${y1.sum_insured}`);
  assert.equal(y1.death_benefit, 3000000, `Y1 death_benefit should be 3,000,000, got ${y1.death_benefit}`);

  // ── 关键断言: Y2 起保费=0 (趸交特征) ──
  const y2 = benefit_illustration[1];
  assert.equal(y2.planned_premium, 0, `Y2 planned_premium should be 0 (趸交), got ${y2.planned_premium}`);
  assert.equal(y2.cumulative_premium_paid, 412700, `Y2 cumulative should still be 412700, got ${y2.cumulative_premium_paid}`);

  console.log(`  ✓ payment_term_years=1 / payment_term_label="趸交"`);
  console.log(`  ✓ annual_premium=412700 (single premium)`);
  console.log(`  ✓ total_premium_paid=412700 (not 5,365,100 = 412700×13)`);
  console.log(`  ✓ Y1 age=50 (49+1), planned_premium=412700, surrender=${y1.surrender_value.toLocaleString()}`);
  console.log(`  ✓ Y1 sum_insured=3,000,000, death_benefit=3,000,000 (not 55,715 / 33)`);
  console.log(`  ✓ Y2 planned_premium=0 (趸交特征)`);
  console.log(`  ✓ Rows: ${benefit_illustration.length}`);
}

async function testTenYearRegression() {
  console.log("\n========== 10年交 PDF 回归测试 (37岁, USD 58,020×10) ==========");
  assert.ok(fs.existsSync(TEN_YEAR_PDF), `PDF missing: ${TEN_YEAR_PDF}`);
  const result = await runExtractor(TEN_YEAR_PDF);
  const { summary, benefit_illustration } = result;

  // ── 回归: 10年交应该识别为 10年 ──
  assert.equal(summary.payment_term_years, 10, `payment_term_years should be 10, got ${summary.payment_term_years}`);
  assert.equal(summary.payment_term_label, "10年", `payment_term_label should be "10年", got "${summary.payment_term_label}"`);

  // ── 回归: 总保费 = 58020 (Y1, 首年2倍) + 25700*9 (Y2-10) = 289,320 ──
  assert.equal(summary.annual_premium, 58020, `annual_premium (Y1) should be 58020 (首年2倍), got ${summary.annual_premium}`);
  assert.equal(summary.total_premium_paid, 289320, `total_premium_paid should be 289320 (58020+25700*9), got ${summary.total_premium_paid}`);

  // ── 回归: Y1 年龄 = 37 ──
  assert.equal(summary.insured_age, 37, `insured_age should be 37, got ${summary.insured_age}`);
  const y1 = benefit_illustration[0];
  assert.equal(y1.age, 38, `Y1 age should be 38 (37+1), got ${y1.age}`);

  // ── 回归: Y2-10 保费 = 25,700 (单年) ──
  for (let i = 1; i < 10; i++) {
    const row = benefit_illustration[i];
    assert.equal(row.planned_premium, 25700, `Y${i + 1} planned_premium should be 25700, got ${row.planned_premium}`);
  }

  // ── 回归: Y11 起保费 = 0 ──
  const y11 = benefit_illustration[10];
  assert.equal(y11.planned_premium, 0, `Y11 planned_premium should be 0 (缴费期满), got ${y11.planned_premium}`);

  console.log(`  ✓ payment_term_years=10 / payment_term_label="10年"`);
  console.log(`  ✓ total_premium_paid=289,320 (= 58020 + 25700×9)`);
  console.log(`  ✓ Y1 age=38, Y2-10 premium=25,700, Y11+ premium=0`);
  console.log(`  ✓ Rows: ${benefit_illustration.length}`);
}

async function main() {
  let passed = 0;
  let failed = 0;
  for (const test of [testLumpsum, testTenYearRegression]) {
    try {
      await test();
      passed++;
    } catch (e) {
      failed++;
      console.error(`\n✗ ${test.name} FAIL: ${(e as Error).message}`);
    }
  }
  console.log(`\n========== ${passed} passed, ${failed} failed ==========`);
  process.exit(failed > 0 ? 1 : 0);
}

main();