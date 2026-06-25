# Google Stitch 提示词包

把 5 个 Screen 的 HTML 提示词复制粘贴到 Google Stitch, 就能生成对应的前端页面。

## 文件清单（按使用顺序）

| # | 文件 | 用途 | 状态机阶段 |
|---|------|------|----------|
| 0 | `00-DESIGN-SYSTEM.md` | 设计系统基线（每个 Screen 提示词都引用它） | — |
| 1 | `01-SCREEN-UPLOAD.md` | 上传页 / 落地页 | created |
| 2 | `02-SCREEN-PARSING.md` | 解析进度页 | parsing |
| 3 | `03-SCREEN-CHAT.md` | 解析摘要 + AI 对话页 | parsed/chatting |
| 4 | `04-SCREEN-GENERATE.md` | 风格 + 公司选择页 | 生成前 |
| 5 | `05-SCREEN-RESULT.md` | 完成 + 下载页 | done |
| 6 | `06-INTEGRATION-GUIDE.md` | 整合说明（对接后端 API） | — |

## 使用流程

1. 打开 `00-DESIGN-SYSTEM.md`, 把它复制到 Stitch 的"项目级 design system" 设置里 (如果有)
2. 依次复制 `01` 到 `05` 到 Stitch prompt 输入框, 每个生成一个独立 HTML
3. 下载所有 HTML 文件到本地, 按 `06-INTEGRATION-GUIDE.md` 的步骤整合

## 重要约定

- 每个 Screen 提示词开头都引用了 00-DESIGN-SYSTEM.md, 复制时**整段一起复制**
- 不要把多个 Screen 合并到一个 prompt, 输出会超长且风格走样
- 生成后用文件提供的"验收清单"逐项检查
- 后端代码 (`src/api/server.ts`) 完全不动, 整合只改 `public/`

## 项目背景

`insurance-ppt` 是一个将 PDF 保险计划书转换为专业销售 PPT 的 AI 工具, 支持
储蓄险/重疾险/万用寿险三种类型, 后端用 Bun + TypeScript, 前端原本是一个单页
HTML 玻璃态风格。这次重构把前端拆成 5 个屏, 用 Apple 浅色风替换旧版黑底蓝紫。
