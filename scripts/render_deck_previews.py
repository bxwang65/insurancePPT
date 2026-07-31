#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

import fitz


def ensure_pdf(source: Path, output_dir: Path, soffice_bin: str) -> Path:
    if source.suffix.lower() == ".pdf":
        return source
    subprocess.run(
        [soffice_bin, "--headless", "--convert-to", "pdf", "--outdir", str(output_dir), str(source)],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return output_dir / f"{source.stem}.pdf"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--soffice", default="/opt/homebrew/bin/soffice")
    parser.add_argument("--scale", type=float, default=1.3)
    args = parser.parse_args()

    source = Path(args.input).resolve()
    out_dir = Path(args.output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf = ensure_pdf(source, out_dir, args.soffice)
    doc = fitz.open(str(pdf))
    previews = []
    for idx, page in enumerate(doc, 1):
      pix = page.get_pixmap(matrix=fitz.Matrix(args.scale, args.scale), alpha=False)
      out = out_dir / f"slide_{idx:02d}.png"
      pix.save(str(out))
      previews.append(str(out))

    print("\n".join(previews))


if __name__ == "__main__":
    main()
