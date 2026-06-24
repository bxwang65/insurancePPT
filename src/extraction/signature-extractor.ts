/**
 * 签名驱动的 PDF 提取器（TS 封装）
 *
 * 用法:
 *   const result = await extractBySignature(pdfPath, signature);
 *   → { ok, summary, paid_total, no_withdraw, withdraw, diagnostics }
 */
import { spawn } from "child_process";
import path from "path";
import type { PdfSignature } from "./signatures/types.ts";

// 储蓄险用 savings 提取器, 重疾/万用寿险用 ci 提取器
const SCRIPT_BY_TYPE = {
  savings: path.resolve(import.meta.dir, "../../scripts/extract_savings_by_signature.py"),
  ci: path.resolve(import.meta.dir, "../../scripts/extract_ci_by_signature.py"),
  iul: path.resolve(import.meta.dir, "../../scripts/extract_iul_stub.py"),
} as const;

export interface SignatureExtractionResult {
  ok: boolean;
  summary: {
    insured_name?: string;
    insured_age?: number;
    insured_gender?: string;
    product_name?: string;
    product_code?: string;
    currency?: string;
    annual_premium?: number;
    annual_premium_with_levy?: number;
    payment_years?: number;
    coverage_period?: string;
    premium_total?: number;
  };
  paid_total: number;
  no_withdraw: Record<string, {
    Y: number; Age: number; Paid: number; Guar_CV: number;
    Rev: number; Term: number; Total: number;
    Mult?: number; IRR?: number; Simple?: number;
  }>;
  withdraw: Record<string, {
    Y: number; Age: number; Paid: number; Annual_WD: number; Cum_WD: number;
    Guar_CV: number; Rev: number; Term: number; Total: number;
    Total_Received?: number; Mult?: number; IRR?: number; Simple?: number;
  }>;
  diagnostics: { warnings: string[]; parser: string; noWithdrawRows: number; withdrawRows: number };
  error?: string;
}

export async function extractBySignature(pdfPath: string, sig: PdfSignature): Promise<SignatureExtractionResult> {
  // 关键: 按 plan type 选 Python 脚本
  const script = (SCRIPT_BY_TYPE as any)[sig.planType] || SCRIPT_BY_TYPE.savings;
  const args = [
    script,
    "--pdf", pdfPath,
    "--signature", sig.id,
    "--page-summary", String(sig.pageTargets.summary || 1),
  ];
  // 关键: 按 plan type 选 page arg
  // savings 路径: Python 内部 .split(",") 支持逗号串
  // ci/iul 路径: Python argparse nargs="*" 需多 arg
  if (sig.planType === "savings") {
    if (sig.pageTargets.noWithdraw?.length) args.push("--pages-no-withdraw", sig.pageTargets.noWithdraw.join(","));
    if (sig.pageTargets.withdraw?.length) args.push("--pages-withdraw", sig.pageTargets.withdraw.join(","));
    if (sig.pageTargets.withdrawRemainder?.length) args.push("--pages-withdraw-remainder", sig.pageTargets.withdrawRemainder.join(","));
  } else if (sig.planType === "ci" || sig.planType === "iul") {
    if (sig.pageTargets.coverage?.length) {
      for (const p of sig.pageTargets.coverage) args.push("--pages-coverage", String(p));
    }
    if (sig.pageTargets.premiumTable?.length) {
      for (const p of sig.pageTargets.premiumTable) args.push("--pages-premium-table", String(p));
    }
  }
  // 关键: --company 必填 (savings 路径) — 之前缺失导致所有 savings fast-path 失败
  if (sig.planType === "savings" && sig.companyId) {
    args.push("--company", sig.companyId);
  }

  return await new Promise<SignatureExtractionResult>((resolve, reject) => {
    const proc = spawn("python3.11", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        return reject(new Error(`signature-extractor exited ${code}: ${stderr}`));
      }
      try {
        const result = JSON.parse(stdout.trim()) as SignatureExtractionResult;
        resolve(result);
      } catch (e: any) {
        reject(new Error(`signature-extractor output parse failed: ${e.message}; stdout=${stdout.slice(0, 200)}`));
      }
    });
  });
}
