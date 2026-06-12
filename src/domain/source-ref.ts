import crypto from "crypto";
import fs from "fs";

export interface SourceRef {
  pdfHash: string;
  pdfPath?: string;
  parser: string;
  signatureId?: string;
}

export function sourceRef(options: { pdfPath?: string; parser?: string }): SourceRef {
  const pdfHash = options.pdfPath && fs.existsSync(options.pdfPath)
    ? crypto.createHash("sha256").update(fs.readFileSync(options.pdfPath)).digest("hex")
    : "";
  return {
    pdfHash,
    pdfPath: options.pdfPath,
    parser: options.parser || "llm-json",
  };
}
