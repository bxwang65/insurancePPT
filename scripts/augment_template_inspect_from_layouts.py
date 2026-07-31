#!/usr/bin/env python3
"""Append complete element IDs from artifact-tool layout exports to a truncated inspect file."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--layouts", required=True)
    parser.add_argument("--inspect", required=True)
    args = parser.parse_args()
    layouts = Path(args.layouts)
    inspect = Path(args.inspect)
    records: list[dict] = []
    for layout_path in sorted(layouts.glob("source-slide-*.layout.json")):
        layout = json.loads(layout_path.read_text(encoding="utf-8"))
        match = re.search(r"source-slide-(\d+)", layout_path.name)
        if not match:
            raise ValueError(f"Cannot infer source slide from {layout_path}")
        # artifact-tool layout exports expose an internal one-based index that is
        # offset from the source filename. The source filename is canonical here.
        slide = int(match.group(1))
        for element in layout.get("elements", []):
            record = {
                "kind": element.get("kind", "shape"),
                "id": str(element["id"]),
                "slide": slide,
                "name": element.get("name", ""),
                "text": element.get("text", ""),
                "bbox": element.get("bbox", []),
            }
            records.append(record)
    existing = inspect.read_text(encoding="utf-8") if inspect.exists() else ""
    with inspect.open("a", encoding="utf-8") as handle:
        if existing and not existing.endswith("\n"):
            handle.write("\n")
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"Appended {len(records)} layout element records -> {inspect}")


if __name__ == "__main__":
    main()
