#!/usr/bin/env bun
/**
 * Insurance PPT Generator CLI
 *
 * Usage:
 *   bun run src/cli.ts --input <pdf> [--output <pptx>] [--api-key <key>]
 *   bun run src/cli.ts extract --input <pdf> [--output <json>]
 *   bun run src/cli.ts generate --input <json> --output <pptx>
 */

import fs from "fs";
import path from "path";
import { ExtractionOrchestrator } from "./extraction/orchestrator.ts";
import { generateSavingsPpt } from "./generation/pptx-generator.ts";
import type { SavingsPlanExtraction } from "./schemas/savings-plan.ts";

const API_KEY = process.env.GEMINI_API_KEY || process.env.npm_config_gemini_api_key || "";

function printHelp(): void {
  console.log(`
保险计划书 → PPT 生成器 (Insurance Proposal to PPT Generator)

用法:
  # 完整流程: 提取 + 生成
  bun run src/cli.ts --input <计划书.pdf> [选项]

  # 仅提取数据
  bun run src/cli.ts extract --input <计划书.pdf> [--output data.json]

  # 仅生成 PPT（使用已有提取数据）
  bun run src/cli.ts generate --input data.json --output result.pptx

选项:
  --input, -i   <path>   输入 PDF 或 JSON 文件路径
  --output, -o  <path>   输出文件路径（默认为 input 文件名.pptx）
  --api-key     <key>    Gemini API key（或设置 GEMINI_API_KEY 环境变量）
  --no-cache             禁用缓存
  --help, -h             显示帮助

示例:
  bun run src/cli.ts -i 匠心傳承儲蓄計劃2尊尚版.pdf
  bun run src/cli.ts -i plan.pdf -o result.pptx
  GEMINI_API_KEY=xxx bun run src/cli.ts -i plan.pdf
`);
}

interface CliOptions {
  command: "full" | "extract" | "generate";
  input: string;
  output: string;
  apiKey: string;
  useCache: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printHelp();
    process.exit(0);
  }

  const command = args[0] === "extract" || args[0] === "generate" ? (args.shift() as "extract" | "generate") : "full";

  const getArg = (flags: string[]): string | undefined => {
    for (const flag of flags) {
      const idx = args.indexOf(flag);
      if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
    }
    return undefined;
  };

  const hasFlag = (flags: string[]): boolean => flags.some((f) => args.includes(f));

  const input = getArg(["--input", "-i"]) || "";
  const output = getArg(["--output", "-o"]) || "";
  const apiKey = getArg(["--api-key"]) || API_KEY;
  const useCache = !hasFlag(["--no-cache"]);

  return { command, input, output, apiKey, useCache };
}

async function main(): Promise<void> {
  const opts = parseArgs();

  if (!opts.input) {
    console.error("❌ 请指定输入文件: --input <path>");
    process.exit(1);
  }

  if (!fs.existsSync(opts.input)) {
    console.error(`❌ 文件不存在: ${opts.input}`);
    process.exit(1);
  }

  if (!opts.apiKey) {
    console.error("❌ 请设置 Gemini API key（--api-key 或 GEMINI_API_KEY 环境变量）");
    process.exit(1);
  }

  if (opts.command === "generate") {
    // Generate only: load JSON -> generate PPT
    const raw = JSON.parse(fs.readFileSync(opts.input, "utf-8"));
    const outputPath = opts.output || opts.input.replace(/\.json$/, ".pptx");
    console.log(`📊 生成 PPT: ${outputPath}`);
    await generateSavingsPpt(raw as SavingsPlanExtraction, outputPath);
    console.log(`✅ PPT 已生成: ${outputPath}`);
    return;
  }

  // Extract or full
  const orch = new ExtractionOrchestrator({
    apiKey: opts.apiKey,
    useCache: opts.useCache,
  });

  console.log(`📄 处理: ${path.basename(opts.input)}`);
  const result = await orch.extractPlan(opts.input, "savings");

  if (result.status === "error") {
    console.error(`❌ 提取失败: ${result.error}`);
    process.exit(1);
  }

  const statusIcon = result.status === "cached" ? "♻️" : "✅";
  console.log(`  ${statusIcon} ${result.productName} (${result.durationMs}ms)`);

  if (result.usage) {
    console.log(`  Tokens: ${result.usage.totalTokens.toLocaleString()}`);
  }

  if (opts.command === "extract" || !opts.output?.match(/\.pptx$/i)) {
    // Just save extraction to JSON
    const outputPath = opts.output || opts.input.replace(/\.pdf$/i, ".json");
    fs.writeFileSync(outputPath, JSON.stringify(result.data, null, 2));
    console.log(`💾 数据已保存: ${outputPath}`);
    return;
  }

  // Full: extract + generate PPT
  if (!result.data) {
    console.error("❌ 无提取数据");
    process.exit(1);
  }

  const pptOutput = opts.output || opts.input.replace(/\.pdf$/i, ".pptx");
  console.log(`📊 生成 PPT: ${pptOutput}`);
  if (result.planType !== "savings") throw new Error("CLI PPT generator currently supports savings plans only");
  await generateSavingsPpt(result.data as import("./schemas/savings-plan.ts").SavingsPlanExtraction, pptOutput);
  console.log(`✅ PPT 已生成: ${pptOutput}`);
}

main().catch((err) => {
  console.error("❌ 错误:", err.message);
  process.exit(1);
});
