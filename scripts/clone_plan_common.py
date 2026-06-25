from __future__ import annotations

from typing import Any


def target(action: str, element_id: str) -> dict[str, str]:
    return {"action": action, "sourceElementId": element_id}


def build_slide_entry(
    *,
    output: int,
    source: int,
    role: str,
    source_targets: list[tuple[str, str]],
    rewrites: list[tuple[str, str]],
    replacements: list[tuple[str, str]],
    deletions: list[tuple[str, str]] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    frame_targets = [target(action, element_id) for action, element_id in source_targets]
    frame = {
        "outputSlide": output,
        "sourceSlide": source,
        "narrativeRole": role,
        "reuseMode": "duplicate-slide",
        "editTargets": frame_targets,
    }
    edit = {
        "outputSlide": output,
        "textRewrites": [{"shapeId": element_id, "text": text} for element_id, text in rewrites],
        "imageReplacements": [{"imageId": element_id, "path": image_path, "fit": "cover"} for element_id, image_path in replacements],
        "deletions": [{"kind": kind, "id": element_id} for kind, element_id in (deletions or [])],
    }
    return frame, edit
