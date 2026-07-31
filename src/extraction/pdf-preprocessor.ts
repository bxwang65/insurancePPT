import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { resolveExtractionPython } from "./python-runtime.ts";

export interface PageInfo {
  pageNum: number;
  text: string;
  hasWithdrawalColumns: boolean;
  hasTableHeaders: boolean;
}

export interface PreprocessResult {
  totalPages: number;
  pages: PageInfo[];
  fullText: string;
  hasWithdrawalScenario: boolean;
  withdrawalPages: number[];
  baseTablePages: number[];
  detectedWithdrawalYear: number | null;
  detectedWithdrawalAmount: number | null;
  tableSnippet: string;
}

const PYTHON_SCRIPT = path.resolve(import.meta.dir, "../../scripts/pdf_extract.py");

/**
 * Use Python fitz (PyMuPDF) to extract and analyze PDF text.
 * Provides deterministic, rule-based detection before AI processing.
 */
export class PdfPreprocessor {
  async preprocess(pdfPath: string): Promise<PreprocessResult> {
    if (!fs.existsSync(PYTHON_SCRIPT)) throw new Error(`Missing PDF parser: ${PYTHON_SCRIPT}`);
    const python = resolveExtractionPython();
    return await new Promise<PreprocessResult>((resolve, reject) => {
      const pyProcess = spawn(python, [PYTHON_SCRIPT, pdfPath], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      pyProcess.stdout.on("data", (d) => { stdout += d.toString(); });
      pyProcess.stderr.on("data", (d) => { stderr += d.toString(); });
      pyProcess.on("error", reject);
      pyProcess.on("close", (code) => {
        if (code !== 0) {
          return reject(new Error(`python3.11 preprocess failed: exit ${code}; ${stderr}`));
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as PreprocessResult;
          resolve(parsed);
        } catch (e: any) {
          reject(new Error(`preprocess output parse failed: ${e.message}`));
        }
      });
    });
  }
}
