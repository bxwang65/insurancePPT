import fs from "fs";
import { execFileSync } from "child_process";

let cachedFitzPython: string | null = null;

const CANDIDATES = [
  process.env.FITZ_PYTHON,
  process.env.EXTRACTION_PYTHON,
  process.env.PRESENTATIONS_PYTHON,
  process.env.PPT_POSTPROCESS_PYTHON,
  "/Users/soldier/hermes-agent/.venv/bin/python",
  "/opt/homebrew/bin/python3.11",
  "/usr/bin/python3",
  "python3.11",
  "python3",
].filter(Boolean) as string[];

function isUsablePython(python: string): boolean {
  try {
    if (python.includes("/") && !fs.existsSync(python)) return false;
    execFileSync(
      python,
      ["-c", "import fitz, pdfplumber, pptx; print('ok')"],
      { stdio: ["ignore", "pipe", "ignore"], timeout: 8000, encoding: "utf-8" },
    );
    return true;
  } catch {
    return false;
  }
}

export function resolveExtractionPython(): string {
  if (cachedFitzPython) return cachedFitzPython;
  for (const candidate of CANDIDATES) {
    if (isUsablePython(candidate)) {
      cachedFitzPython = candidate;
      return candidate;
    }
  }
  throw new Error(
    `No usable extraction python found. Tried: ${CANDIDATES.join(", ")}. Need fitz + pdfplumber + python-pptx.`,
  );
}
