/**
 * 提取 PDF 前 N 页文本（用于签名预检）
 */
import { spawn } from "child_process";
import path from "path";
import { resolveExtractionPython } from "./python-runtime.ts";

export interface FirstPagesSnapshot {
  totalPages: number;
  firstPagesText: string;
  sampledPages: number;
}

export async function getFirstPagesSnapshot(pdfPath: string, pages = 2): Promise<FirstPagesSnapshot> {
  const script = path.resolve(import.meta.dir, "../../scripts/extract_first_n_pages.py");
  const python = resolveExtractionPython();
  return await new Promise<FirstPagesSnapshot>((resolve, reject) => {
    const proc = spawn(python, [script, pdfPath, "--pages", String(pages)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      // 关键: PyMuPDF 错误会写到 stdout, 污染 JSON 输出
      // 例: "MuPDF error: syntax error: cannot find ExtGState resource 'KSPE38'"
      // 策略: 取 stdout 中第一个 '{' 到末尾, 忽略前缀的 MuPDF warnings
      const trimmed = stdout.trim();
      const jsonStart = trimmed.indexOf("{");
      const cleanedJson = jsonStart >= 0 ? trimmed.substring(jsonStart) : trimmed;
      if (cleanedJson.trim()) {
        try {
          resolve(JSON.parse(cleanedJson.trim()) as FirstPagesSnapshot);
          return;
        } catch (e) {
          console.warn(`[pdf-first-pages] stdout 非 JSON: ${e?.message}; first100=${cleanedJson.substring(0, 100)}`);
        }
      }
      if (code !== 0) return reject(new Error(`first-pages extract failed: exit ${code}; ${stderr}`));
      // [diag] 把 stderr 一并带上, 排查 "no output" 真因
      reject(new Error(`first-pages extract failed: no output (stderr: ${stderr.slice(0, 300)})`));
    });
  });
}
