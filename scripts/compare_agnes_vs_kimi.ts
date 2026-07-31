/**
 * Agnes vs Kimi PDF 解析对比脚本
 * 用同一份 PDF 分别调两个 provider, 对比: 字段完整度 / 解析耗时 / token
 *
 * 用法: bun run scripts/compare_agnes_vs_kimi.ts <pdf-path>
 */
import fs from "fs"
import { OpenAIExtractor } from "../src/extraction/openai-extractor"
import { SAVINGS_PLAN_SYSTEM_PROMPT } from "../src/extraction/prompts"

async function runOne(pdfPath: string, provider: "kimi" | "agnes"): Promise<any> {
  const apiKey = provider === "kimi" ? process.env.KIMI_API_KEY! : process.env.AGNES_API_KEY!
  const ext = new OpenAIExtractor({ apiKey, provider, timeout: 180_000 })
  const t0 = Date.now()
  try {
    const r = await ext.extractJSON(pdfPath, SAVINGS_PLAN_SYSTEM_PROMPT)
    return {
      provider,
      ok: true,
      data: r.data,
      usage: r.usage,
      durationMs: r.durationMs,
      wallMs: Date.now() - t0,
      productName: r.data?.product_name || "(empty)",
      biLen: Array.isArray(r.data?.benefit_illustration) ? r.data.benefit_illustration.length : 0,
    }
  } catch (e: any) {
    return { provider, ok: false, error: e.message, wallMs: Date.now() - t0 }
  }
}

const pdfPath = process.argv[2]
if (!pdfPath) { console.error("Usage: bun run scripts/compare_agnes_vs_kimi.ts <pdf>"); process.exit(1) }
if (!fs.existsSync(pdfPath)) { console.error("PDF not found:", pdfPath); process.exit(1) }

console.log(`📄 PDF: ${pdfPath}`)
console.log(`📦 Size: ${(fs.statSync(pdfPath).size / 1024).toFixed(1)} KB\n`)

const [kimiRes, agnesRes] = await Promise.all([
  runOne(pdfPath, "kimi"),
  runOne(pdfPath, "agnes"),
])

for (const r of [kimiRes, agnesRes]) {
  console.log(`=== ${r.provider.toUpperCase()} ===`)
  if (!r.ok) { console.log(`✗ FAILED: ${r.error}  (${r.wallMs}ms)\n`); continue }
  console.log(`✓ OK  (${r.wallMs}ms, LLM=${r.durationMs}ms)`)
  console.log(`  product_name: ${r.productName}`)
  console.log(`  benefit_illustration rows: ${r.biLen}`)
  if (r.usage) {
    console.log(`  tokens: prompt=${r.usage.promptTokens}, completion=${r.usage.completionTokens}, total=${r.usage.totalTokens}`)
  }
  if (r.data?.policy) {
    console.log(`  policy.annual_premium: ${r.data.policy.annual_premium}`)
    console.log(`  policy.premium_payment_period: ${r.data.policy.premium_payment_period}`)
  }
  if (r.data?.insured) {
    console.log(`  insured: age=${r.data.insured.age}, gender=${r.data.insured.gender}`)
  }
  console.log()
}

// 简单一致度对比
if (kimiRes.ok && agnesRes.ok) {
  const sameName = kimiRes.data?.product_name === agnesRes.data?.product_name
  const sameRows = kimiRes.biLen === agnesRes.biLen
  const samePremium = kimiRes.data?.policy?.annual_premium === agnesRes.data?.policy?.annual_premium
  console.log("=== 一致度 ===")
  console.log(`  product_name 一致: ${sameName ? "✓" : "✗"}`)
  console.log(`  benefit_illustration 行数一致: ${sameRows ? "✓" : "✗"}`)
  console.log(`  annual_premium 一致: ${samePremium ? "✓" : "✗"}`)
}
