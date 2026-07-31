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
        resolve(JSON.parse(stdout.trim()) as DeterministicSavingsTables);
      } catch (error) {
        reject(new Error(`savings table parser returned invalid JSON: ${String(error)}`));
      }
    });
  });
}
