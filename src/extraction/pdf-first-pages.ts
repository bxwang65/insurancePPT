/**
 * 提取 PDF 前 N 页文本（用于签名预检）
 */
import { spawn } from "child_process";
import path from "path";

export interface FirstPagesSnapshot {
  totalPages: number;
  firstPagesText: string;
  sampledPages: number;
}

export async function getFirstPagesSnapshot(pdfPath: string, pages = 2): Promise<FirstPagesSnapshot> {
  const script = path.resolve(import.meta.dir, "../../scripts/extract_first_n_pages.py");
  return await new Promise<FirstPagesSnapshot>((resolve, reject) => {
    const proc = spawn("python3.11", [script, pdfPath, "--pages", String(pages)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      // MuPDF 非致命错误(如 syntax error)会写入 stderr, 但 stdout 仍有有效 JSON
      if (stdout.trim()) {
        try {
          resolve(JSON.parse(stdout.trim()) as FirstPagesSnapshot);
          return;
        } catch (_) { /* stdout 无效, 走下面的报错 */ }
      }
      if (code !== 0) return reject(new Error(`first-pages extract failed: exit ${code}; ${stderr}`));
      reject(new Error(`first-pages extract failed: no output`));
    });
  });
}
