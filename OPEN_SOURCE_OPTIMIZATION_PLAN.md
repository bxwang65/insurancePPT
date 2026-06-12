# Open Source Optimization Plan

## Target Problems
- Official proposal PDFs are not deeply understood (especially table semantics).
- Sales-angle extraction is weak (cannot prioritize conversion-critical facts).
- PPT output quality is inconsistent and often visually noisy.

## High-Score Repositories Reviewed
- `datalab-to/marker` (35.5k stars, GPL-3.0): strong PDF-to-JSON/Markdown with layout + table quality.
- `jsvine/pdfplumber` (10.3k stars): robust rule-based table extraction + debugging.
- `Unstructured-IO/unstructured` (Apache-2.0): production-oriented document ETL framework.
- `marp-team/marp-cli` (3.6k stars): high-quality markdown-driven slide flow with PPTX export.
- `gitbrent/PptxGenJS` (popular JS PPTX engine): relevant for template/fallback branch.

## Integration Strategy (Pragmatic)
1. Extraction quality uplift (short-term)
- Keep current Gemini schema extraction as primary.
- Add deterministic table-snippet injection (already implemented in `pdf-preprocessor`) to improve LLM focus on benefit tables.

2. Extraction quality uplift (mid-term)
- Add optional `marker` pipeline mode:
  - Convert PDF -> Markdown/JSON with structure.
  - Feed normalized table blocks into current schema prompt.
  - Use for hard PDFs where pure OCR prompt fails.

3. Sales-angle understanding
- Add a dedicated sales-scoring rubric:
  - customer fit
  - breakeven clarity
  - long-term multiple
  - liquidity story
  - risk caveat wording quality

4. PPT quality
- Enforce no-emoji and typography normalization in generator.
- Introduce strict slide tokens (spacing scale, font scale, card style) and test against 10+ official cases.

## Current Status
- Implemented:
  - Async-safe preprocessor + key table snippet injection.
  - Emoji/noisy symbol sanitization in Python generator.
  - Batch evaluator script for official case folder (`eval:cases`).
- Next:
  - Add optional marker pipeline.
  - Add auto visual QA checks for generated decks.

