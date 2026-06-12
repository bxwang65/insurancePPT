# 保险计划书 → PPT 生成系统

## 项目概述

从PDF计划书中提取数据，生成专业PPTX演示文稿。支持3种产品类型、20+产品。所有数据提取基于 PyMuPDF (fitz) 精确位置解析，确保数据可回溯至官方计划书页码。

## 目录结构

```
insurance-ppt/
├── scripts/                    # Python 数据提取脚本
│   ├── extract_savings_tables.py  # 核心解析器 (产品路由 + 位置解析)
│   └── extract_age.py             # 年龄提取 (多格式兼容)
├── src/
│   ├── api/server.ts           # Bun HTTP 服务 (15+ API端点)
│   ├── extraction/             # 提取管线
│   │   ├── orchestrator.ts     # 提取编排器 (签名->LLM->fitz覆盖)
│   │   ├── fast-path.ts        # 签名快速路径
│   │   ├── fast-path-adapter.ts# 签名数据 → Schema 转换
│   │   ├── savings-table-parser.ts  # 调用 extract_savings_tables.py
│   │   ├── signatures/
│   │   │   ├── registry.ts     # 产品签名注册表 (20+产品)
│   │   │   ├── matcher.ts      # 签名匹配器 (文本+产品代码)
│   │   │   └── types.ts        # 签名类型定义
│   │   └── gemini-client.ts    # LLM客户端
│   ├── schemas/                # Zod 校验 Schema
│   │   ├── savings-plan.ts     # 储蓄险
│   │   ├── critical-illness.ts # 重疾险
│   │   └── iul.ts              # IUL寿险
│   ├── generation/             # PPT生成
│   │   └── pptx-generator.ts   # 生成编排
│   ├── pipelines/              # 流水线
│   ├── bundles/                # 产品组合
│   ├── savings/                # 储蓄险归一化/校验
│   ├── ci/                     # 重疾险归一化/校验
│   └── iul/                    # IUL归一化/校验
├── public/
│   ├── index.html              # 前端UI
│   ├── js/screens/             # 前端页面
│   │   ├── upload.js           # 上传页
│   │   ├── parsing.js          # 解析页
│   │   ├── generate.js         # 生成页
│   │   └── result.js           # 结果页
│   └── assets/library/         # 品牌资产
│       └── companies/          # 各公司 logo/封面/展示图
├── sessions/                   # 运行时对话 session
├── docs/
│   ├── ARCHITECTURE.md         # 本文档
│   ├── WORKFLOW.md             # 新产品接入流程
│   └── PRODUCT_SIGNATURES.md   # 签名注册状态
└── .cache/insurance-ppt/       # 提取缓存 (每5分钟自动清理)
```

## 数据提取架构 (三层)

```
PDF → ①签名快速路径 → ②LLM兜底 → ③fitz覆盖
                              ↓
                     最终数据以③为准
```

### 第一层：签名快速路径
- 读取PDF前2页文本
- 匹配 `registry.ts` 中的签名 (`titleKeywords` + `firstPageMustContain`)
- 命中后走签名提取器 (Python `extract_first_n_pages.py`)
- 提取摘要、退保表、提领表数据

### 第二层：LLM兜底
- 无签名匹配时走 LLM (DeepSeek/Gemini)
- 支持 savings / ci / iul 三种schema

### 第三层：fitz 精确覆盖 (核心)
- `extract_savings_tables.py` 基于 PyMuPDF (`get_text("dict")`) 位置解析
- 按产品类型路由 → 只跑该产品的专用解析器
- 无匹配时跑通用+兜底
- **始终覆盖签名数据和LLM数据** (2025-06-12修复)

## 数据流

```
用户上传 → POST /api/upload → session创建
        → POST /api/parse  → ExtractionOrchestrator.extractPlan()
                             → ① tryFastExtraction (签名)
                             → ② LLM (无签名时)
                             → ③ spawnSync Python fitz覆盖
        → POST /api/generate-enhanced/{sessionId}
                             → 构建noWithdraw/withdraw字典
                             → spawn pptx_renderer.py
        → PPTX 下载
```

## 产品解析器路由

Python `extract_savings_tables.py` 的主流程:

```python
doc_type = _identify_doc_type(全文文本)  # 识别产品类型

for each page:
    跳过悲观/乐观/不同投资回报情景页
    CI解析(全类型通用)
    
    if doc_type == "pru":       _run_pru()     # 保诚
    elif "ctf":                 _run_ctf()      # 周大福
    elif "cpic":                _run_cpic()     # 太平洋
    elif "aia-huanyu":          _run_aia_huanyu() # 友邦环宇盈活
    elif "chinalife":           _run_chinalife() # 中国人寿
    elif "china-taiping":       _run_taiping()  # 中国太平
    elif "axa":                 _run_axa()      # 安盛
    elif "xinanyi":             _run_xinanyi()  # 鑫安逸
    elif "cfyh":                _run_cfyh()     # 财富盈活
    elif "qihang":              _run_qihang()   # 启航创富
    elif "hongzhi":             _run_hongzhi()  # 宏挚传承/家传承
    elif "jiangxin":            _run_jiangxin() # 匠心飞越
    else:                       _run_fallback_all() # 通用+兜底
    
    dedupe(base)  # 对不重复年份
```

## 已注册产品清单

| ID | 公司 | 产品 | 类型 | 解析器 | 提领 |
|----|------|------|:----:|--------|:----:|
| ctf-mw2iua-v1 | CTF周大福 | 匠心传承2(尊尚版) | savings | CTF专用 | ✅ |
| ctf-hb4cila10-v1 | CTF周大福 | 守護家倍198 | ci | CI通用 | N/A |
| ctf-jiangxinfeiyue-v1 | CTF周大福 | 匠心飞越储蓄保险 | savings | `_run_jiangxin` | ✅ |
| aia-huanyu5-v1 | AIA友邦 | 环宇盈活(5年) | savings | AIA专用 | ✅ |
| aia-we2-v1 | AIA友邦 | 财富挚2 | savings | 通用 | ✅ |
| aia-cfyh-v1 | AIA友邦 | 财富盈活储蓄保险 | savings | `_run_cfyh` | ✅ |
| pru-trst-v1 | 保诚 | 信守明天多元货币 | savings | `_run_pru` | ✅ |
| manulife-spark-v1 | 宏利 | 丰誉传承 | savings | Manulife专用 | ❌ |
| manulife-lovehome-v1 | 宏利 | 宏挚家传承(旧版) | savings | Manulife专用 | ❌ |
| manulife-hongzhi-v1 | 宏利 | 宏挚传承保障计划 | savings | `_run_hongzhi` | ✅ |
| manulife-jiachuan-v1 | 宏利 | 宏挚家传承保险 | savings | `_run_hongzhi`复用 | ✅ |
| fwd-atar2-v1 | FWD富卫 | 盈聚天下II | savings | 通用 | ✅ |
| cpic-aarj31u-v1 | CPIC太平洋 | 世代悅享3 | savings | CPIC专用 | ✅ |
| yflife-bisp5-v1 | YFLife万通 | 富饶万家(5年) | savings | 通用 | ✅ |
| chinalife-c540-v1 | 中国人寿 | 傲瓏盛世(美元) | savings | CL专用 | ✅ |
| china-taiping-1121nwlp7-v1 | 中国太平 | 颐年乐享(尊享版) | savings | Taiping专用 | ✅ |
| china-taiping-xinanyi-v1 | 中国太平 | 鑫安逸储蓄保险 | savings | `_run_xinanyi` | ❌ |
| generali-qihang-v1 | 忠意人寿 | 启航创富卓越版 | savings | `_run_qihang` | ✅ (不提领仅8年) |
| axa-shengli2-v1 | 安盛 | 盛利II至尊 | savings | `_run_axa` | ✅ |

## 关键技术决策

### 1. 位置解析 (`get_text("dict")`) 而非 `find_tables()`
- `find_tables()` 有单元格截断问题 (大型合并单元格的值被截断)
- `get_text("dict")` 按坐标分组, 无截断, 支持多列布局
- 统一通过 `_positional_rows(page)` 获取位置分组行

### 2. 产品路由 (2025-06-11重构)
- 原: 所有解析器全跑 → dedupe 保留最后者 (互相污染)
- 改: 先识别文档 → 只跑该产品专用解析器 → 无匹配才全跑

### 3. fitz 始终覆盖签名数据 (2025-06-12修复)
- 原: `if ft.行数 > 签名行数 → 覆盖` (行数相等时不覆盖)
- 改: `if ft.行数 > 20/0 → 覆盖` (有数据就覆盖)

### 4. 年龄兜底 (2025-06-12实现)
- 签名提取经常不提供年龄 → 从PDF首页用正则提取
- 支持5种格式: "年齡:1" / "1歲" / "年龄:\\nVIP\\n1" / "男/1/标准" / "ANB:1"
- 独立脚本 `scripts/extract_age.py`

### 5. 跳过悲观情景页
- 所有解析器跳过含"悲觀情景"/"樂觀情景"/"不同投資回報"的页
- 保证数据来自"现时假设"(标准假设)

### 6. 产品名称以签名为准 (2025-06-12修复)
- 原: `LLM提取名 || 签名名` (LLM可能提取脚注片段)
- 改: `签名名 || LLM提取名`

### 7. 缓存自动清理
- `CACHE_VERSION` 每次关键修改升级 (当前v3)
- 定时器每5分钟清理 `.cache/` 目录

### 8. 聊天页移除 (2025-06-11)
- 聊天功能与PPT生成不联动, 已移除
- 保留 `useAiSummary` 勾选框 (AI摘要)

## 公司品牌配置

见 `server.ts` 中 `COMPANY_BRAND_PROFILES`, 每个公司需要:
- `public/assets/library/companies/{companyId}/logo.png`
- `public/assets/library/companies/{companyId}/company-hero-01.jpg` (封面图)
- 全美/永明的封面图仅用于IUL产品, 储蓄险不用 (2025-06-12修复)

## 已知限制

1. 启航创富: 不提领仅8行(页2稀疏关键年), 连续数据页混在提取页中
2. YFLife万通: 无专用解析器, 走通用路径
3. FWD富卫: 无专用解析器, 走通用路径
4. CI/IUL产品: 覆盖率有限

## 服务器

- 端口: 3000
- 运行: `bun run dev` (自动watch)
- API: REST (无框架, hand-written routing)
- 渲染: Python `insurance-deck/insdeck/render/pptx_renderer.py`
