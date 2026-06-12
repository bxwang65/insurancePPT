# Fast Path Acceleration — CHANGELOG

> 实施日期: 2026-06-03
> 影响范围: PDF 提取 + 数据规范化 + PPTX 渲染全链路
> 实施依据: 借鉴兄弟包 `insurance-deck` 的 Hermes 思路

## 一、性能提升

| 路径 | 旧 | 新 | 加速 |
|---|---|---|---|
| 单公司储蓄险提取 | 30s+ (Gemini) | 1.4s (pdfplumber) | **21x** |
| 端到端 PPTX (fast) | 3 分钟 (8.5MB 模板克隆) | 1.6s (36.7KB python-pptx) | **113x** |
| PPTX 体积 | 8.5MB | 36.7KB | **230x 缩小** |

## 二、新增模块

### 1. 签名注册表 (`src/extraction/signatures/`)
- `types.ts` — `PdfSignature` / `PdfSignatureMatch` 类型
- `registry.ts` — 6 个手动签名 (CTF MW2IUA / AIA HUANYU5 / AIA WE2 / PRU CAESARS / Manulife SPARK / FWD ATAR)
- `registry-auto.ts` — 自动从 `config/products/` + `config/companies/` 生成 4 个兜底签名
- `matcher.ts` — 评分匹配 (title 60% + firstPage 30% + code 10%)
- `index.ts` — 统一导出

### 2. PDF 提取器 (`src/extraction/`)
- `pdf-first-pages.ts` — Python `extract_first_n_pages.py` 封装
- `signature-extractor.ts` — Python `extract_savings_by_signature.py` 封装
- `fast-path.ts` — `tryFastExtraction(pdfPath)` 统一入口
- `fast-path-adapter.ts` — 转 SavingsPlanExtraction 兼容 JSON
- 集成到 `orchestrator.ts` — 缓存未命中后立即试签名，命中且 ≥20 行 → 跳过 LLM

### 3. 交叉验证 (`src/savings/cross-validator.ts`)
- `crossValidateSavings(plan, signatureId)` — 校验 5/5 关键数字
- 集成到 `formal-deck-validator.ts`

### 4. 统一数据契约 (`src/render/normalized-deck.ts`)
- `DeckContract` — 跨 renderer (PPTX/HTML/PDF/JSON) 共享数据结构
- 强制包含: `pdfHash` + `sourcePage` 源追溯
- 71.1KB 端到端产出

### 5. 极速 PPTX 渲染器 (`src/render/fast-pptx.ts` + `scripts/fast_pptx_renderer.py`)
- python-pptx 原生, 6 页 (封面/公司/增长/提领/KPI/结束)
- 3 套主题: deepblue / caramel / chinese
- 36.7KB 输出, 110ms 渲染

### 6. CLI 工具 (`scripts/cli_fast_pptx.ts`)
- 用法: `bun scripts/cli_fast_pptx.ts <pdf> --out OUT --theme deepblue`
- 1.5s 出片, 优雅失败

### 7. Tokens 集中 (`src/tokens/index.ts`)
- COLORS / FONTS / SPACING / TYPOGRAPHY / RADII
- 所有未来渲染器 import 此处

### 8. 公司知识库扩展
- `config/companies/manulife.json` / `fwd.json` 补完整 highlight
- `config/products/manulife/spark-savings.json` / `fwd/atar-savings.json` 补产品配置

## 三、签名注册清单

| 签名 | 公司 | 产品 | crossCheckBaseline |
|---|---|---|---|
| ctf-mw2iua-v1 | 周大福 | 匠心传承2尊尚版 | Y5/7/10/20/30 = 234795/514498/638233/1366345/2782754 |
| aia-huanyu5-v1 | 友邦 | 环宇盈活 5年缴 | Y7 年提35000, Y20 累计 525006 |
| aia-we2-v1 | 友邦 | 财富挚2 | (待 PDF 验证后补) |
| pru-caesars-v1 | 保诚 | 隽富多元货币 | (待 PDF 验证后补) |
| manulife-spark-v1 | 宏利 | 丰誉传承 | (待 PDF 验证后补) |
| fwd-atar-v1 | 富卫 | 盈聚天下 | (待 PDF 验证后补) |
| auto-* (4 个) | 自动生成 | 默认 fallback | 无 |

## 四、测试矩阵

| 测试 | 命令 | 结果 |
|---|---|---|
| 签名匹配 | `bun run test:pdf-signatures` | PASS (1.0 conf) |
| 专用提取 | `bun run test:signature-extractor` | PASS (1.4s, 80+127 行) |
| Fast 集成 | `bun run test:fast-path` | PASS (1.4s) |
| 交叉验证 | `bun run test:cross-validate` | PASS (5/5 100%) |
| DeckContract | `bun run test:deck-contract` | PASS (71.1KB) |
| 签名覆盖 | `bun run test:signature-coverage` | PASS (10 sigs) |
| 极速 PPTX | `bun run test:fast-pptx` | PASS (1.5s, 36.7KB) |
| 全套 | `bun run test:all-fast` | 7/7 PASS (6.7s) |
| 5x 稳定性 | `bun run scripts/test_stability_loop.ts` | PASS (avg 1.6s, 0 体积差) |
| 既有回归 (12 项) | clone-status / export-readiness / company-* / bundle-gate | 全 PASS |

## 五、明日 (2026-06-04) 计划

- [ ] 用 Manulife PDF 验证 `manulife-spark-v1` 签名: 若置信度 < 0.7 → 调整 titleKeywords + pageTargets
- [ ] 用 FWD PDF 验证 `fwd-atar-v1` 签名: 同上
- [ ] 命中后补 crossCheckBaseline (需要先跑一次提取, 取 Y20/Y30 真实值)
- [ ] 失败时把这两个签名的 titleKeywords/pageTargets 写到 insight 报告

## 六、文件清单

```
src/
  extraction/
    signatures/            (新) 4 个文件
      types.ts
      registry.ts
      registry-auto.ts
      matcher.ts
      index.ts
    pdf-first-pages.ts     (新)
    signature-extractor.ts (新)
    fast-path.ts           (新)
    fast-path-adapter.ts   (新)
    orchestrator.ts        (改) 注入 fast path
  savings/
    cross-validator.ts     (新)
    formal-deck-validator.ts (改) 集成 cross-check
    savings-normalizer.ts  (改) 透传 signatureId
  render/
    normalized-deck.ts     (新) DeckContract
    fast-pptx.ts           (新) TS 封装
    index.ts               (新)
  tokens/
    index.ts               (新) 设计 tokens

config/
  companies/manulife.json  (改) 补 highlights
  companies/fwd.json       (改) 补 highlights
  products/manulife/spark-savings.json  (新)
  products/fwd/atar-savings.json        (新)

scripts/
  extract_first_n_pages.py        (新) PDF 文本快速提取
  extract_savings_by_signature.py (新) 专用签名提取器 (CTF/AIA/通用)
  fast_pptx_renderer.py            (新) python-pptx 极速渲染
  cli_fast_pptx.ts                 (新) CLI 入口
  test_*.ts                        (新) 7 个新测试
```
