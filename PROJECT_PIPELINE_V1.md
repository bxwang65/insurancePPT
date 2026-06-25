# Multi-Agent Pipeline V1

## Goal
把当前“单次计划书生成”升级为可多公司、多用户复用的流水线：
- `OutlineAgent`：从提取数据生成结构化大纲
- `ImageAgent`：按页意图绑定配图素材
- `PresentationAgent`：按品牌主题渲染 Marp -> PPT/PDF

## Entry
- CLI: `bun run pipeline --session <id> --tenant <tenantId> --user <userId> --customer <name> --format both`
- Default demo:
  - `bun run pipeline --session 01907ac5 --tenant ctf --user u001 --customer "Boxie 家庭"`

## New Files
- `src/pipeline/types.ts`
- `src/config/tenants.ts`
- `src/pipeline/outline-agent.ts`
- `src/pipeline/image-agent.ts`
- `src/pipeline/presentation-agent.ts`
- `src/pipeline/orchestrator.ts`
- `scripts/run_pipeline.ts`

## Multi-Tenant Extension
在 `src/config/tenants.ts` 添加租户配置即可：
- 品牌色
- 字体
- 公司文案与评级
- 配图白名单

## Output Contract
每次运行输出目录：`outputs/<session>_<tenant>_<user>_pipeline/`
- `outline.md`
- `assets/*`
- `deck.marp.md`
- `deck.pptx` / `deck.pdf`
- `manifest.json`

## Next Step
V2建议：把 `ImageAgent` 从“白名单图库”升级为“image model 生成 + 品牌审查 + 人审回退”。
