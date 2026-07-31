/**
 * 三 provider IUL 解析对比脚本
 * Kimi (主力) / MiniMax (备用2) / Agnes (备用3) 同一份 PDF 并发跑
 * 对比: 字段完整度 / 解析耗时 / token 用量 / 失败模式
 *
 * 用法: bun run scripts/compare_three_providers_iul.ts <pdf-path>
 */
import fs from "fs"
import { OpenAIExtractor } from "../src/extraction/openai-extractor"
import { IUL_SYSTEM_PROMPT } from "../src/extraction/prompts"

type Provider = "kimi" | "minimax" | "agnes"

async function runOne(pdfPath: string, provider: Provider, timeoutMs = 600_000): Promise<any> {
  const apiKey =
    provider === "kimi" ? process.env.KIMI_API_KEY :
    provider === "minimax" ? process.env.MINIMAX_API_KEY :
    process.env.AGNES_API_KEY
  if (!apiKey) return { provider, ok: false, error: "no api key", wallMs: 0 }
  const ext = new OpenAIExtractor({ apiKey, provider, timeout: timeoutMs })
  const t0 = Date.now()
  try {
    const r = await ext.extractJSON(pdfPath, IUL_SYSTEM_PROMPT)
    return {
      provider,
      ok: true,
      data: r.data,
      usage: r.usage,
      durationMs: r.durationMs,
      wallMs: Date.now() - t0,
      productName: r.data?.product_name || "(empty)",
      biLen: Array.isArray(r.data?.benefit_illustration) ? r.data.benefit_illustration.length : 0,
      indexAccts: Array.isArray(r.data?.index_accounts) ? r.data.index_accounts.length : 0,
      annualPremium: r.data?.policy?.annual_premium,
      paymentPeriod: r.data?.policy?.premium_payment_period,
    }
  } catch (e: any) {
    return { provider, ok: false, error: e.message.substring(0, 300), wallMs: Date.now() - t0 }
  }
}

const pdfPath = process.argv[2]
if (!pdfPath) { console.error("Usage: bun run scripts/compare_three_providers_iul.ts <pdf>"); process.exit(1) }
if (!fs.existsSync(pdfPath)) { console.error("PDF not found:", pdfPath); process.exit(1) }

console.log(`📄 PDF: ${pdfPath}`)
console.log(`📦 Size: ${(fs.statSync(pdfPath).size / 1024).toFixed(1)} KB\n`)

const t0 = Date.now()
const results = await Promise.all([
  runOne(pdfPath, "kimi"),
  runOne(pdfPath, "minimax"),
  runOne(pdfPath, "agnes"),
])
const totalWall = Date.now() - t0

for (const r of results) {
  console.log(`=== ${r.provider.toUpperCase()} ===`)
  if (!r.ok) {
    console.log(`✗ FAILED (${r.wallMs}ms): ${r.error}\n`)
    continue
  }
  console.log(`✓ OK  wall=${r.wallMs}ms  llm=${r.durationMs}ms`)
  console.log(`  product_name:        ${r.productName}`)
  console.log(`  bi rows:             ${r.biLen}`)
  console.log(`  index_accounts:      ${r.indexAccts}`)
  console.log(`  annual_premium:      ${r.annualPremium}`)
  console.log(`  payment_period:      ${r.paymentPeriod}`)
  if (r.usage) {
    console.log(`  tokens:              prompt=${r.usage.promptTokens}  comp=${r.usage.completionTokens}  total=${r.usage.totalTokens}`)
  }
  console.log()
}

console.log(`⏱ 总耗时 (并发): ${totalWall}ms\n`)

// 一致度对比
const oks = results.filter(r => r.ok)
if (oks.length >= 2) {
  console.log("=== 一致度 ===")
  const names = new Set(oks.map(r => r.productName))
  const rows = new Set(oks.map(r => r.biLen))
  console.log(`  product_name:    ${names.size === 1 ? "✓ 一致" : "✗ 差异 → " + [...names].join(" | ")}`)
  console.log(`  benefit_illust rows: ${rows.size === 1 ? "✓ 一致 (" + [...rows][0] + ")" : "✗ 差异 → " + [...rows].join(" | ")}`)
  const okMap = Object.fromEntries(oks.map(r => [r.provider, r]))
  if (okMap.kimi && okMap.minimax) {
    console.log(`  kimi vs minimax:  premium=${okMap.kimi.annualPremium === okMap.minimax.annualPremium ? "✓" : "✗"}`)
  }
  if (okMap.kimi && okMap.agnes) {
    console.log(`  kimi vs agnes:    premium=${okMap.kimi.annualPremium === okMap.agnes.annualPremium ? "✓" : "✗"}`)
  }
}