import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const ROOT = path.resolve(import.meta.dir, "../..");
const DEFAULT_PYTHON = "python3.11";
const DEFAULT_SOFFICE = process.env.SOFFICE_BIN || "/opt/homebrew/bin/soffice";

export interface PreviewArtifact {
  previewRelativePaths: string[];
  previewAbsolutePaths: string[];
  previewPdfRelativePath?: string;
  previewPdfAbsolutePath?: string;
  slideCount: number;
}

export function generateDeckPreviews(params: {
  sourcePath: string;
  ownerDownloadDir: string;
  relativePrefix: string;
}): PreviewArtifact {
  const previewDir = path.join(params.ownerDownloadDir, `${params.relativePrefix}_preview`);
  fs.rmSync(previewDir, { recursive: true, force: true });
  fs.mkdirSync(previewDir, { recursive: true });

  const proc = spawnSync(DEFAULT_PYTHON, [
    path.join(ROOT, "scripts/render_deck_previews.py"),
    "--input",
    params.sourcePath,
    "--output-dir",
    previewDir,
    "--soffice",
    DEFAULT_SOFFICE,
  ], { encoding: "utf8" });

  if (proc.status !== 0) {
    throw new Error(`render_deck_previews.py exited ${proc.status}: ${proc.stderr || proc.stdout}`);
  }

  const previewAbsolutePaths = (proc.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.endsWith(".png"));
  const slideCount = previewAbsolutePaths.length;
  const previewRelativePaths = previewAbsolutePaths.map((abs) => path.join(path.basename(previewDir), path.basename(abs)));

  const pdfAbsolute = path.join(previewDir, `${path.parse(params.sourcePath).name}.pdf`);
  const hasPdf = fs.existsSync(pdfAbsolute);

  return {
    previewAbsolutePaths,
    previewRelativePaths,
    previewPdfAbsolutePath: hasPdf ? pdfAbsolute : undefined,
    previewPdfRelativePath: hasPdf ? path.join(path.basename(previewDir), path.basename(pdfAbsolute)) : undefined,
    slideCount,
  };
}
