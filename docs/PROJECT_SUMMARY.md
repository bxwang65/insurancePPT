# 保险计划书 PPT 生成系统 — 项目总结

## 项目核心目标

从保险计划书 PDF 中提取数据，自动生成专业级 PPTX 演示文稿。支持 3 种产品类型、5 种模板组合。

## 产品类型与模板

| 模板 | PDF产品类型 | 页数 | 状态 | 生成入口 |
|------|-----------|:----:|:----:|:--------:|
| 储蓄单产品 | 储蓄险 | 12页 | ✅ 可用 | `/api/generate-enhanced/` |
| 重疾单产品 | 危疾保障 | 10页 | ✅ 可用 | `/api/generate-enhanced/` |
| IUL单产品 | 指数型万用寿险 | 10页 | ✅ 可用 | `/api/generate-enhanced/` |
| 储蓄+重疾 | 2个PDF混合 | 20页 | ✅ 可用 | `/api/generate-enhanced/` |
| 储蓄+IUL | 2个PDF混合 | 18页 | ✅ 可用 | `/api/generate-enhanced/` |

## 近2天核心修改

### 1. 数据提取层 (TypeScript)

**文件: `src/schemas/iul.ts`**
- 新增 `numCoerce()` 预处理函数，兼容 AI 输出字符串数字（如 `"66,355"` → `66355`）
- 所有数字字段加 `z.preprocess(numCoerce, z.number())` 包装
- `premium_payment_period` 兼容数字类型（`5` → `"5年"`）

**文件: `src/schemas/critical-illness.ts`** (无改动，保持原样)

**文件: `src/extraction/openai-extractor.ts`**
- IUL字段映射 `||` → `??`（nullish coalescing，修复0值准确性问题）

**文件: `src/extraction/prompts.ts`**
- IUL prompt 字段名对齐：`cash_value` → `non_guaranteed_cash_value`

**文件: `src/api/server.ts`**
- `sanitizeForXml()` 扩展正则，增加 `\uD800-\uDFFF` 和 `\uffff` 范围
- 3处 IUL字段映射 `||` → `??`
- 封面图路径支持 `.png` 格式
- meta 增加 `_assets_dir` 和 `has_savings` 字段
- 增强生成路径支持 IUL-only/CI-only（无储蓄险时也可生成）
- `primaryData` 使用 sanitizeForXml 处理

### 2. PPTX 渲染层 (Python, insurance-deck)

**文件: `insdeck/render/pptx_renderer.py`** — 主要修改

#### 封面美化
- **储蓄/重疾**: 全屏图片 + 50%透明深蓝遮罩 + 白色22pt文字
- **IUL**: 顶部 banner 图(4.5in) + 底部深色区域 + 白色22pt文字
- 新增 `_add_overlay()` 半透明遮罩函数
- 移除封面 sparkles（从54形状→9形状）
- 封面文字排版：14pt header + 22pt 内容

#### 多公司 Header 切换
- `add_header()` 新增 `company_override` 参数
- CI/IUL 各页面函数新增 `company` 参数，传各自公司信息
- header 左上角公司名随页面产品切换
- 品牌角标随公司切换

#### 页面简化
- 篇章页（CI/IUL）：移除 sparkles（47形状→7形状）
- 尾页：移除 sparkles（70形状→10形状）
- 标题字号改为 36pt（原 22pt）
- Y轴数字格式改为百万显示 `$#,##0,, "M"`

#### 新增页面
- **收入中断风险防范**（储蓄+重疾组合专用）
- **现金流+高杠杆**（储蓄+IUL组合专用，储蓄提领→IUL保费）
- **IUL全页折线图**（新增非保证户口价值系列，3条线）

#### IUL 图表
- 新增第3条数据系列：非保证户口价值
- 颜色方案：深蓝(保费)→浅蓝(户口价值)→金色(保额)

### 3. 组合编排

- 储蓄+重疾：savings内容→CI内容→方案协同→收入中断页
- 储蓄+IUL：savings内容→方案协同→保费资金流→IUL内容
- 单产品时跳过方案协同页（`product_count >= 2` 条件）

### 4. 公司品牌配置

- 3家 IUL 公司新增封面图：全美/永明/宏利（用户提供）
- 3家公司品牌资料补全（评级/背景/业务线从用户提供的公司介绍提取）
- IUL 端口公司选择只显示这3家

## 项目目录结构

```
├── insurance-ppt/                  # 主项目 (Bun + TypeScript)
│   ├── src/
│   │   ├── api/
│   │   │   └── server.ts           # HTTP服务, 所有API路由
│   │   ├── schemas/
│   │   │   ├── iul.ts              # IUL Zod schema (含numCoerce)
│   │   │   ├── critical-illness.ts # CI Zod schema
│   │   │   └── savings-plan.ts     # 储蓄险 Zod schema
│   │   ├── extraction/
│   │   │   ├── orchestrator.ts     # 提取编排 (签名fast-path/LLM)
│   │   │   ├── openai-extractor.ts # OpenAI兼容API提取器
│   │   │   ├── gemini-client.ts    # Gemini提取器
│   │   │   └── prompts.ts          # IUL/CI/储蓄提取prompt
│   │   ├── chat/
│   │   │   ├── chat-engine.ts      # 聊天引擎
│   │   │   ├── interpretation-engine.ts # 数据解读引擎
│   │   │   └── outline-generator.ts    # 大纲生成
│   │   ├── config/
│   │   │   ├── company-kb.ts       # 公司知识库匹配
│   │   │   ├── render-presets.ts   # 模板预设/公司皮肤
│   │   │   ├── catalog-loader.ts   # 目录加载器
│   │   │   └── template-catalog.ts # 模板目录
│   │   ├── bundles/
│   │   │   ├── bundle-planner.ts   # 组合方案规划
│   │   │   ├── bundle-gate.ts      # 组合出口门控
│   │   │   └── bundle-renderer-registry.ts # 组合渲染器注册
│   │   ├── pipeline/
│   │   │   ├── orchestrator.ts     # 多agent流水线
│   │   │   ├── outline-agent.ts    # 大纲agent
│   │   │   ├── presentation-agent.ts # 演示agent
│   │   │   └── types.ts            # 流水线类型定义
│   │   ├── savings/
│   │   ├── templates/
│   │   │   └── clone-renderer-registry.ts # 克隆渲染器注册
│   │   ├── generation/
│   │   │   └── composition-engine.ts # 组合引擎(legacy)
│   │   └── iul/
│   │       └── iul-normalizer.ts   # IUL数据标准化
│   ├── config/
│   │   ├── companies/              # 公司JSON配置
│   │   │   ├── transamerica.json
│   │   │   ├── sunlife.json
│   │   │   ├── manulife.json
│   │   │   ├── aia.json, ctf.json ...
│   │   ├── templates/              # 模板配置
│   │   │   ├── savings/
│   │   │   ├── ci/
│   │   │   └── iul/
│   │   └── bundles/               # 组合方案配置
│   ├── public/assets/library/
│   │   └── companies/              # 公司品牌资产
│   │       ├── aia/     (logo, brand images, corner marks)
│   │       ├── ctf/     (logo, brand images)
│   │       ├── transamerica/ (cover banner PNG)
│   │       ├── sunlife/  (cover banner PNG)
│   │       └── manulife/ (cover banner PNG)
│   └── sessions/                   # session持久化JSON
│
├── insurance-deck/                 # Python PPTX渲染引擎
│   └── insdeck/render/
│       └── pptx_renderer.py        # ★核心文件~2500行
│           ├── add_header()        # Header+公司名+角标
│           ├── add_title()         # 标题(36pt)
│           ├── add_text()          # 文本框
│           ├── render_pptx()       # 主入口
│           ├── _slide_cover()      # 封面(全屏/banner)
│           ├── _slide_company()    # 公司介绍
│           ├── _slide_features()   # 产品特点
│           ├── _slide_growth_chart() # 增长图
│           ├── _slide_compare_chart() # 对比图
│           ├── _slide_education()  # 教育金
│           ├── _slide_ci_*()       # CI页面(6个)
│           ├── _slide_iul_*()      # IUL页面(6个)
│           ├── _slide_combo_narrative() # 方案协同
│           └── _slide_ci_income_protection() # 收入中断
│
├── scripts/                        # Python辅助脚本
│
└── docs/
    ├── ci-single-product-logic.md  # CI生成逻辑说明
    └── PROJECT_SUMMARY.md          # 本文件
```

## 已知待办

### ⚠️ 架构问题（建议优先修复）

| 问题 | 说明 | 影响 |
|------|------|:----:|
| `tsc` 类型错误 | `src/api/server.ts` 中 `benefit_illustration` 访问缺少类型收窄 | 编译不通过 |
| 主链与兼容链重复 | `/api/generate/` 和 `/api/generate-enhanced/` 各有独立渲染逻辑 | 修复需改两处 |
| formal pipeline 就绪检查失败 | `export-readiness` 报告 `formalReady=false`（模板资产缺失） | 影响 `/api/generate/` 路径 |

### 功能待办

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P1 | 多公司前端联调 | 前端选择公司后传给生成API |
| P1 | 模板定稿美化 | 用户美化后发我跑差异对比 |
| P2 | Chat联动PPT | 聊天内容影响PPT生成 |
| P3 | 叙事配置化 | 将叙事逻辑提取为配置 |

### 注意事项

- 当前正式生产入口是 **`/api/generate-enhanced/`**（Python render_pptx），`/api/generate/`（formal pipeline）因模板资产缺失暂不可用
- insurance-deck Python 渲染器位于 `packages/insurance-deck/`，通过相对路径引用，部署时需确保同级存在
- 公司特化提取逻辑（signature registry）是高准确率的关键，不应被泛化清理

## 关键技术决策

1. **渲染路径**: 前端走 `/api/generate-enhanced/`，调用 Python `render_pptx()`
2. **模板策略**: 不使用模板克隆系统（依赖多、复杂），直接在Python渲染器里生成
3. **封面风格**: 储蓄/CI用全屏图+遮罩，IUL用顶部banner+底部文字
4. **公司识别**: 通过 `ci_company`/`iul_company` 字典传递公司信息，在渲染层切换
5. **字体**: 所有文字微软雅黑(FONT_HEI)，封面14pt/22pt，正文10pt，标题36pt
