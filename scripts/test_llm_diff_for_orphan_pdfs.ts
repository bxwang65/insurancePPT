/**
 * Kimi vs MiniMax 对比 — 限定签名不命中的 7 份 PDF
 * 每份并发跑两个 provider, 对比: 字段完整度 / 数据准确度 / 解析耗时
 */
import fs from "fs";
import { OpenAIExtractor } from "../src/extraction/openai-extractor";
import { SAVINGS_PLAN_SYSTEM_PROMPT, IUL_SYSTEM_PROMPT } from "../src/extraction/prompts";

type Provider = "kimi" | "minimax";

async function runOne(pdfPath: string, provider: Provider, timeoutMs = 600_000): Promise<any> {
  const apiKey = provider === "kimi" ? process.env.KIMI_API_KEY! : process.env.MINIMAX_API_KEY!;
  const ext = new OpenAIExtractor({ apiKey, provider, timeout: timeoutMs });
  const t0 = Date.now();
  try {
    const r = await ext.extractJSON(pdfPath, SAVINGS_PLAN_SYSTEM_PROMPT);
    return {
      provider,
      ok: true,
      data: r.data,
      usage: r.usage,
      durationMs: r.durationMs,
      wallMs: Date.now() - t0,
      productName: r.data?.product_name || "(empty)",
      biLen: Array.isArray(r.data?.benefit_illustration) ? r.data.benefit_illustration.length : 0,
      wdLen: Array.isArray(r.data?.withdrawal_illustration) ? r.data.withdrawal_illustration.length : 0,
      annualPremium: r.data?.policy?.annual_premium,
      paymentPeriod: r.data?.policy?.premium_payment_period,
      currency: r.data?.policy?.currency,
      insuredAge: r.data?.insured?.age,
      insuredGender: r.data?.insured?.gender,
      row0: (r.data?.benefit_illustration as any[])?.[0],
    };
  } catch (e: any) {
    return { provider, ok: false, error: e.message.substring(0, 300), wallMs: Date.now() - t0 };
  }
}

const PDF_DIR = "/tmp/test_pdfs";
const TARGETS = [
  "愛伴航保險計劃2.pdf",
  "愛伴航保險計劃2(1).pdf",
  "愛伴航保險計劃2(2).pdf",
  "環宇盈活儲蓄保險計劃.pdf",
  "環宇盈活儲蓄保險計劃(1).pdf",
  "TA_GIUL3+M-46-N-CN-USD-S2m-5x+(coi)(SC).pdf",
  "B0F85256951A427E876B6610ACD5E4C6.pdf",
];

for (const name of TARGETS) {
  const path = `${PDF_DIR}/${name}`;
  if (!fs.existsSync(path)) { console.error(`Missing: ${name}`); continue; }

  console.log(`\n${"=".repeat(80)}`);
  console.log(`📄 ${name}  (${(fs.statSync(path).size / 1024).toFixed(1)} KB)`);
  console.log(`${"=".repeat(80)}`);

  const [kimi, minimax] = await Promise.all([
    runOne(path, "kimi"),
    runOne(path, "minimax"),
  ]);

  for (const r of [kimi, minimax]) {
    console.log(`\n--- ${r.provider.toUpperCase()} ---`);
    if (!r.ok) { console.log(`✗ FAILED (${r.wallMs}ms): ${r.error}`); continue; }
    console.log(`✓ OK  wall=${r.wallMs}ms  llm=${r.durationMs}ms`);
    console.log(`  product_name:        ${r.productName}`);
    console.log(`  currency:            ${r.currency}`);
    console.log(`  insured:             age=${r.insuredAge}, gender=${r.insuredGender}`);
    console.log(`  annual_premium:      ${r.annualPremium}`);
    console.log(`  payment_period:      ${r.paymentPeriod}`);
    console.log(`  benefit_illustration rows: ${r.biLen}`);
    console.log(`  withdrawal_illustration rows: ${r.wdLen}`);
    if (r.usage) {
      console.log(`  tokens:              prompt=${r.usage.promptTokens}  comp=${r.usage.completionTokens}  total=${r.usage.totalTokens}`);
    }
    if (r.row0) {
      console.log(`  row[0]:              ${JSON.stringify(r.row0)}`);
    }
  }

  if (kimi.ok && minimax.ok) {
    console.log(`\n--- 一致度 ---`);
    console.log(`  product_name:        ${kimi.productName === minimax.productName ? "✓" : "✗"}`);
    console.log(`  annual_premium:      ${kimi.annualPremium === minimax.annualPremium ? "✓" : "✗"}`);
    console.log(`  payment_period:      ${kimi.paymentPeriod === minimax.paymentPeriod ? "✓" : "✗"}`);
    console.log(`  bi rows:             ${kimi.biLen === minimax.biLen ? "✓" : "✗"}  (kimi=${kimi.biLen}, minimax=${minimax.biLen})`);
    console.log(`  insured.age:         ${kimi.insuredAge === minimax.insuredAge ? "✓" : "✗"}`);
  }
}