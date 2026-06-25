# 保险计划书 AI 助手

将 PDF 计划书转换为专业 PPT 的 AI 工具，支持储蓄险、重疾险、万用寿险（IUL）三种产品类型。

## 功能概览

- **上传 PDF** — 支持多份计划书同时上传，自动识别产品类型
- **AI 解析** — Gemini 2.5 Flash 提取关键数据（产品名称、保单信息、逐年利益演示）
- **销售洞察** — 自动生成目标客户画像、核心卖点、建议叙事方向
- **对话咨询** — 与 AI 保险顾问对话，询问计划书内容、对比分析、展示建议
- **PPT 生成** — 基于解析结果自动生成 15 页专业销售 PPT，支持 4 种风格

## 快速开始

```bash
cd /Users/soldier/free-code/packages/insurance-ppt
bun install
```

### 环境变量

```bash
export GEMINI_API_KEY="your-gemini-api-key"
export PORT=3000
```

### 启动服务

```bash
bun run src/api/server.ts
```

打开 http://localhost:3000 即可使用。

## 项目结构

```
src/
  api/server.ts           # HTTP 服务器（路由、会话管理）
  extraction/
    orchestrator.ts       # 提取编排器（Schema 验证、多类型支持）
    gemini-client.ts       # Gemini API 客户端
    pdf-preprocessor.ts    # PDF 预处理器（pymupdf 文本提取）
    prompts.ts             # 各产品的 Prompt 模板
  schemas/
    savings-plan.ts       # 储蓄险 Schema + 验证
    critical-illness.ts    # 重疾险 Schema
    iul.ts                 # IUL Schema
    common.ts              # 共享 Schema（受保人、保单、年度利益行）
  chat/
    chat-engine.ts         # 对话引擎（支持三种产品类型）
    interpretation-engine.ts # AI 解读引擎（计划书 JSON → 销售洞察）
    outline-generator.ts   # PPT 大纲生成器
  templates/
    markdown-templates.ts  # Markdown 模板引擎
  generation/
    pptx-generator.ts      # Python PPT 生成器（主）
    composition-engine.ts   # JS Fallback PPT 组合引擎
scripts/
  ppt_generator.py         # Gamma/Google Stitch 风格 PPT 生成
  ppt_styles.py            # 配色方案（modern/fresh/minimal/warm）
public/
  index.html               # Web UI（Apple 毛玻璃风格）
```

## API 端点

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/health` | 健康检查 | — |
| POST | `/api/upload` | 上传 PDF 文件 | 速率限制 |
| POST | `/api/parse/:sessionId` | AI 解析计划书 | X-API-Key |
| POST | `/api/chat/:sessionId` | 对话咨询 | X-API-Key |
| POST | `/api/generate/:sessionId` | 生成 PPT | X-API-Key |
| POST | `/api/company-info` | 查询公司介绍 | X-API-Key |

## 安全特性

- **命令注入防护** — `execSync` → `spawn`（数组参数，无 shell 展开）
- **API 认证** — `X-API-Key` Header（当 `GEMINI_API_KEY` 已配置）
- **速率限制** — 每 IP 每分钟 30 次请求
- **目录遍历防护** — 静态文件服务路径校验
- **会话 LRU 缓存** — 最多 100 个活跃会话，自动清理最旧会话

## 状态机

```
created → parsing → parsed → chatting → generating → done
                          ↘ parsed ↗
```

## 产品支持

| 产品类型 | Schema | 关键指标 |
|----------|--------|---------|
| 储蓄险 | SavingsPlanExtractionSchema | 回本年份、翻倍倍数、IRR |
| 重疾险 | CiPlanExtractionSchema | 保额、年缴、每天成本、保障项目 |
| 万用寿险 | IulExtractionSchema | 身故保障、杠杆倍数、指数账户利率 |

## PPT 风格

- **modern（默认）** — 深蓝 + 金色，专业高端
- **fresh** — 青绿色，清新自然
- **minimal** — 暗红 + 黑色，简洁有力
- **warm** — 棕色 + 橙色，温暖亲切