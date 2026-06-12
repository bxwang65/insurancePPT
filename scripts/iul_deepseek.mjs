#!/usr/bin/env node
/* Direct DeepSeek IUL extraction — no schema, no caching */
import { readFileSync } from "fs";
import { execSync } from "child_process";

const pdfPath = process.argv[2];
const apiKey = process.argv[3] || process.env.DEEPSEEK_API_KEY || "";

if (!pdfPath) { console.error("Usage: node iul_deepseek.mjs <pdfPath>"); process.exit(1); }

// Extract text via PyMuPDF
let pdfText = "";
try {
  pdfText = execSync(`python3.11 -c "import fitz; doc=fitz.open('${pdfPath.replace(/'/g, "'\\''")}'); print('\\n'.join(p.get_text() for p in doc))"`, { timeout: 30000, encoding: "utf-8" });
} catch { pdfText = "[text extraction failed]"; }
if (pdfText.length > 30000) pdfText = pdfText.substring(0, 30000) + "\n\n[...TRUNCATED...]";

const prompt = `你是一个专业的IUL（万用寿险）提取专家。

输出JSON结构：
{
  "product_name": "产品全称",
  "product_type": "iul",
  "insured": { "name": "受保人", "age": 年龄, "gender": "性别" },
  "policy": {
    "currency": "USD", "sum_insured": 保额数字, "annual_premium": 年缴保费,
    "premium_payment_period": "5年", "coverage_period": "终身"
  },
  "index_accounts": [{ "name": "账户名", "allocation": 比例 }],
  "benefit_illustration": [
    { "policy_year": 年度, "total_premium_paid": 累计保费, "account_value": 账户价值, "cash_value": 退保价值, "death_benefit": 身故赔偿 }
  ]
}

要求: benefit_illustration 每个保单年度都要提取。只输出JSON，不要markdown包裹。`;

const body = JSON.stringify({
  model: "deepseek-v4-flash",
  messages: [
    { role: "system", content: prompt },
    { role: "user", content: pdfText }
  ],
  temperature: 0.1,
  max_tokens: 32000,
});

const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body,
});
const json = await res.json();
const content = json.choices?.[0]?.message?.content || "";

// Parse JSON
const match = content.match(/\{[\s\S]*\}/);
const data = match ? JSON.parse(match[0]) : { error: "No JSON found", raw: content.slice(0, 200) };

// Fix field mapping
if (data.benefit_illustration) {
  data.benefit_illustration = data.benefit_illustration.map((r) => ({
    ...r,
    non_guaranteed_account_value: r.non_guaranteed_account_value || r.account_value || 0,
    non_guaranteed_cash_value: r.non_guaranteed_cash_value || r.cash_value || 0,
    non_guaranteed_death_benefit: r.non_guaranteed_death_benefit || r.death_benefit || undefined,
  }));
}

process.stdout.write(JSON.stringify(data));
