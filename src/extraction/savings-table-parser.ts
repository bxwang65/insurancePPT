import { spawn } from "child_process";
import path from "path";
import { resolveExtractionPython } from "./python-runtime.ts";

export interface DeterministicSavingsTables {
  parser: "fitz-table-v1";
  pdf: string;
  total_pages: number;
  benefit_illustration: Record<string, unknown>[];
  ci_benefit_illustration: Record<string, unknown>[];
  withdrawal_illustration: Record<string, unknown>[];
  withdrawal_amounts: Record<string, unknown>[];
}

export async function extractSavingsTables(pdfPath: string): Promise<DeterministicSavingsTables> {
  const script = path.resolve(import.meta.dir, "../../scripts/extract_savings_tables.py");
  const python = resolveExtractionPython();
  return await new Promise<DeterministicSavingsTables>((resolve, reject) => {
    const proc = spawn(python, [script, pdfPath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`savings table parser exited ${code}: ${stderr}`));
      try {
        // 2026-09-13: 鲁棒解析 — 容忍 stdout 里的前导垃圾
        //   实测 (MANULIFE_GCIP, 43 页): stdout 前三行是
        //     1) "warning: The `fitz` API is deprecated ..."   ← PyMuPDF import 时自己打的
        //     2) "MuPDF error: format error: cmsOpenProfileFromMem failed"  ← libmupdf 原生 C 层
        //     3) {"parser": "fitz-table-v1", ...}              ← 真正的 JSON
        //   两条 warning 都来自原生层, Python 层的 print 拦不住
        //   (extract_savings_tables.py 的 7 处 print 已全部写 stderr, 无可改)
        //   直接 JSON.parse(stdout) 会抛 "Unexpected identifier \"warning\"" → 整个 deterministic 兜底失效
        //   策略与 signature-extractor.ts 一致: 取最后一段完整 JSON
        const jsonMatch = stdout.match(/[\{\[][\s\S]*[\}\]]\s*$/);
        const jsonStr = jsonMatch ? jsonMatch[0] : stdout.trim();
        resolve(JSON.parse(jsonStr) as DeterministicSavingsTables);
      } catch (error) {
        reject(new Error(`savings table parser returned invalid JSON: ${String(error)}; stdout=${stdout.slice(0, 200)}`));
      }
    });
  });
}
