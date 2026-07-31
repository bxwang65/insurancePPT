#!/usr/bin/env python3
"""Inventory the user-provided PPTX templates without mutating their layouts."""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path


TEMPLATES = {
    "broker": "财富保障方案——券商风 .pptx",
    "business": "财富保障方案——商务风 .pptx",
    "minimal": "财富保障方案——简洁风 .pptx",
    "chinese": "财富保障方案——中国风 .pptx",
    "ink": "财富保障方案——水墨风 .pptx",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inventory_template(template_id: str, path: Path, root: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
    slide_count = sum(
        1
        for name in names
        if name.startswith("ppt/slides/slide") and name.endswith(".xml") and "/_rels/" not in name
    )
    media = [name for name in names if name.startswith("ppt/media/") and not name.endswith("/")]
    return {
        "id": template_id,
        "sourceRoot": str(root),
        "relativePath": path.relative_to(root).as_posix(),
        "fileName": path.name,
        "sha256": sha256(path),
        "sizeBytes": path.stat().st_size,
        "modifiedAt": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
        "slideCount": slide_count,
        "mediaCount": len(media),
        "status": "indexed",
        "mutationMode": "artifact-tool-exact-clone-edit",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/Users/soldier/Downloads")
    parser.add_argument("--out", default="data/template-asset-index.json")
    args = parser.parse_args()
    root = Path(args.root).expanduser().resolve()
    out = Path(args.out).expanduser().resolve()
    assets = []
    for template_id, filename in TEMPLATES.items():
        path = root / filename
        if not path.is_file():
            raise SystemExit(f"Template not found: {path}")
        assets.append(inventory_template(template_id, path, root))
    manifest = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "assets": assets,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Indexed {len(assets)} templates -> {out}")
    for asset in assets:
        print(f"  {asset['id']}: {asset['slideCount']} slides, {asset['mediaCount']} media, {asset['sha256'][:12]}")


if __name__ == "__main__":
    main()
