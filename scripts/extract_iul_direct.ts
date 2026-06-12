#!/usr/bin/env bun
/**
 * Direct IUL extraction script — bypasses schema validation to preserve raw field names.
 * Usage: bun run scripts/extract_iul_direct.ts <pdfPath> [apiKey]
 */
import { OpenAIExtractor } from "../src/extraction/openai-extractor.ts";
import { IUL_SYSTEM_PROMPT } from "../src/extraction/prompts.ts";

const pdfPath = process.argv[2];
const apiKey = process.argv[3] || process.env.DEEPSEEK_API_KEY || "";

if (!pdfPath) { console.error("Usage: bun run scripts/extract_iul_direct.ts <pdfPath>"); process.exit(1); }

const ext = new OpenAIExtractor({ apiKey, provider: "deepseek" });
const result = await ext.extractJSON(pdfPath, IUL_SYSTEM_PROMPT);
const data = result.data;

// Fix field mapping: AI output account_value/cash_value/death_benefit
if (data?.benefit_illustration) {
  data.benefit_illustration = data.benefit_illustration.map((r: any) => ({
    ...r,
    non_guaranteed_account_value: r.non_guaranteed_account_value || r.account_value || 0,
    non_guaranteed_cash_value: r.non_guaranteed_cash_value || r.cash_value || 0,
    non_guaranteed_death_benefit: r.non_guaranteed_death_benefit || r.death_benefit || undefined,
  }));
}

process.stdout.write(JSON.stringify(data));
