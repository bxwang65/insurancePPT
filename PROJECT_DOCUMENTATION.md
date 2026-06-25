# 保险计划书 AI 助手 — 项目完整文档

## 一、项目概述

### 核心定位
将 PDF 保险计划书转换为专业销售演示文稿的 AI 工具，支持储蓄险、重疾险、万用寿险（IUL）三种产品类型。

### 核心价值
保险顾问上传一份或多份 PDF 计划书，系统自动完成：AI 数据提取 → 销售叙事规划 → 专业 PPT 生成，全流程闭环，无需人工干预。

### 用户需求背景
- 保险顾问需要快速为客户制作方案对比 PPT
- 手工从 PDF 复制数据既慢又容易出错
- 需要专业、高端、有感染力的销售叙事，而非数据堆砌
- 先生（储蓄险）+ 小姐（重疾险）联合方案是典型场景

---

## 二、设计逻辑

### 三层架构
```
提取层 (Extraction)    →  规划层 (Planning)    →  生成层 (Generation)
  PDF → 结构化 JSON        JSON → ContentPlan     ContentPlan → PPT
```

**提取层 (orchestrator.ts)**
- 接收上传 PDF，调用 Gemini 2.5 Flash OCR + 语义理解
- 按产品类型（savings/ci/iul）匹配 Schema 验证数据
- 基于 SHA256(fileBuffer) 做缓存，同一文件不重复付费 API
- 输出：结构化 JSON（含逐年利益演示、保证/非保证金额、受保人信息）

**规划层 (content-planner.ts)**
- 接收提取层 JSON，调用 LLM（DeepSeek/MiniMax）生成 ContentPlan
- ContentPlan = 故事线（overallNarrative）+ 多页 SlidePlan[]
- 每页 SlidePlan 含：title / narrativeText（30字内）/ visualType / chartType / layout / dataHighlights
- 内置规则 fallback，LLM 失败时保证仍有输出
- 用户意图识别（回本/对比/传承/收益），差异化叙事方向

**生成层 (composition-engine.ts + pptx-generator.ts)**
- 接收 ContentPlan，驱动 7 页固定模板
- 7 页结构：封面 → 概览 → 财富增长 → 关键数据表 → 倍数分析 → 回本分析 → 结束
- TypeScript PptxGenJS 实现，可直接 bun run
- Python 侧（ppt_generator.py）提供 Gamma 风格 alternative path

### 状态机
```
created → parsing → parsed → chatting → generating → done
                      ↘ parsed ↗
```

---

## 三、关键设计决策

### 缓存机制
- 基于 `SHA256(fileBuffer)` 命名缓存文件，避免重复 API 调用
- 缓存路径：`.cache/insurance-ppt/<hash>.json`
- 仅当用户显式上传 PDF 时才触发解析

### 无认证模式
- 服务器检测 `GEMINI_API_KEY` 是否配置
- 若未配置，`requireApiKey()` 返回 `null`，所有 API 开放
- 若配置了 `GEMINI_API_KEY`，则要求 `X-API-Key` Header
- 本项目部署环境无 API_KEY，全程无认证调用

### 两套生成方案并行
| 方案 | 技术栈 | 特点 |
|------|--------|------|
| PptxGenJS（主） | TypeScript + Bun | 直接内存生成，无需子进程 |
| hybrid_generator.py（备） | Playwright + python-pptx | HTML 截图 + PPTX 嵌入 |
| ppt_generator.py（备） | Python + matplotlib | Gamma 风格图表 + python-pptx |

### 设计系统参考
整合了两个 GitHub 开源项目的设计规范（而非直接部署）：
- **shadcn/ui（115k stars）** → OKLCH 配色系统 + 语义化 CSS 变量
- **ai-atelie（5 stars, MIT）** → anti-ai-slop 反机器感规则 + typography 字体层级规范

核心规则：
- 品牌色上限：单屏 ≤ 2 处金色 `#C8963E`
- ALL CAPS 必须 `letter-spacing: 0.06em+`
- 图表配色：保证=`#4FC3F7` / 非保证=`#C8963E` / 总值=`#00D4AA`

---

## 四、产品支持

| 产品类型 | Schema | 关键指标 |
|----------|--------|---------|
| 储蓄险 (savings) | savings-plan.ts | 回本年份、翻倍倍数、IRR、提取方案 |
| 重疾险 (ci) | critical-illness.ts | 保额、年缴、每天成本、保障项目列表 |
| 万用寿险 (iul) | iul.ts | 身故保障、杠杆倍数、指数账户利率 |

---

## 五、PPT 风格

| 风格 | 主色 | 特点 |
|------|------|------|
| modern（默认） | `#0A1628` 深蓝 + `#C8963E` 金线 | 专业高端 |
| fresh | `#18898D` 青绿 | 清新自然 |
| minimal | 暗红 + 黑 | 简洁有力 |
| warm | 棕色 + 橙 | 温暖亲切 |

---

## 六、开发目录结构

```
insurance-ppt/
├── README.md
├── package.json
├── tsconfig.json
│
├── src/                          # TypeScript 源码
│   ├── api/
│   │   └── server.ts             # HTTP 服务器（24,817字节），路由/会话管理
│   ├── extraction/
│   │   ├── orchestrator.ts       # 提取编排器（201行），Schema 验证/多类型支持/缓存
│   │   ├── gemini-client.ts      # Gemini 2.5 Flash API 封装
│   │   ├── pdf-preprocessor.ts   # PDF 预处理器（pymupdf 文本提取）
│   │   └── prompts.ts            # 各产品类型的 Prompt 模板
│   ├── schemas/
│   │   ├── common.ts            # 共享 Schema（受保人、保单、年度利益行）
│   │   ├── savings-plan.ts       # 储蓄险 Schema + 验证逻辑
│   │   ├── critical-illness.ts   # 重疾险 Schema
│   │   └── iul.ts               # IUL Schema
│   ├── chat/
│   │   ├── chat-engine.ts       # 对话引擎
│   │   ├── interpretation-engine.ts # AI 解读引擎（JSON → 销售洞察）
│   │   └── outline-generator.ts # PPT 大纲生成器（183行），生成 15 页 Markdown
│   ├── templates/
│   │   └── markdown-templates.ts # Markdown 模板引擎
│   ├── planning/
│   │   └── content-planner.ts    # LLM 驱动内容规划（673行），SlidePlan 类型定义
│   ├── generation/
│   │   ├── pptx-generator.ts     # PptxGenJS 实现，7 页固定模板（543行）
│   │   ├── composition-engine.ts # 多产品综合方案生成器（25,601字节）
│   │   └── image-gen.ts          # 图片生成
│   ├── lib/
│   │   └── llm-client.ts        # LLM 客户端封装（13,183字节），支持 DeepSeek/MiniMax
│   └── cli.ts                   # CLI 工具（155行）
│
├── scripts/                      # Python 生成脚本
│   ├── ppt_generator.py         # Gamma/Google Stitch 风格（1,338行，55,404字节）
│   ├── hybrid_generator.py      # Playwright + python-pptx 混合流水线
│   ├── slide_renderer.py         # Playwright 截图表格页 HTML → PNG
│   ├── template24_engine.py      # 深海蓝主题模板引擎
│   ├── ppt_styles.py            # 配色方案
│   ├── pdf_extract.py           # PDF 提取
│   ├── llm_caller.js            # ⚠️ 未实现
│   ├── ralph_loop.py            # 20 次循环稳定性测试脚本（176行）
│   ├── wiki_knowledge.py
│   ├── jxcc_generator.py
│   └── jxcc_data.json / test_data_123.json
│
├── references/
│   └── insurance-ppt-design-system.md # 整合 shadcn/ui + ai-atelie 设计规范（4,870字节）
│
├── sessions/                     # 会话数据（JSON，每次上传生成新 session）
│   └── <sessionId>.json         # 每次上传的完整提取 + 状态数据
│
├── uploads/                     # 用户上传的 PDF 文件
│   └── <sessionId>_<hash>_<原始文件名>
│
├── public/
│   ├── index.html               # Web UI（Apple 毛玻璃风格）
│   └── downloads/              # 生成的 PPT 文件
│
└── outputs/                    # 最终输出副本
```

---

## 七、API 端点

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/upload` | 上传 PDF（支持多文件） |
| POST | `/api/parse/:sessionId` | AI 解析计划书 |
| POST | `/api/chat/:sessionId` | 对话咨询 |
| POST | `/api/generate/:sessionId` | 生成 PPT（style 参数：modern/fresh/minimal/warm） |
| POST | `/api/company-info` | 查询公司介绍 |

---

## 八、验证结果

### Ralph Loop 20 次循环稳定性测试
- **通过率**：20/20（100%）
- **Parse 耗时**：avg=30.5s | min=22.4s | max=40.0s
- **Gen 耗时**：avg=0.3s（极稳定）
- **PPT 大小**：376KB（完全一致）

### 先生 + 小姐联合方案
- **先生**：匠心传承储蓄计划2尊尚版，5年缴，USD 100,000/年，128年数据
- **小姐**：守护家倍198，10年缴，USD 4,949/年，68年数据
- **输出**：15 页 Markdown 大纲 + 综合方案.pptx（689KB）
- **Session ID**：120cdf4a

---

## 九、已知问题

1. **两套生成方案各自为战** — PptxGenJS 和 hybrid_generator.py 没有统一入口
2. **llm_caller.js 未实现** — hybrid_generator.py 的 LLM 调用层缺失
3. **content-planner.ts LLM 叙事未在生产路径验证** — 规则 fallback 在工作，但真正的 LLM 叙事能力尚待加强
4. **小姐被识别为 savings 而非 ci** — planType 判断有误（实际为 ci 计划但返回 savings）
5. **pdf-preprocessor.ts async/await 错误** — line 120 附近存在 bug

---

## 十、快速启动

```bash
cd /Users/soldier/free-code/packages/insurance-ppt
bun install
bun run src/api/server.ts
# 打开 http://localhost:3000
```