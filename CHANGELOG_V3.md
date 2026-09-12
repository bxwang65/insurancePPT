# V3 变更日志 (CHANGELOG)

## V3.1.3 (2026-07-08) - Y41 跨页污染 + CI 公司介绍页修复

基于 V3.1.2 增量修复。核心: AIA 愛伴航 演示表 Y41 数据彻底正确 + 储蓄+CI 组合 slide 12 显示 CI 产品名.

### 问题

- AIA 愛伴航 Page 18-19 演示表 header 含"年龄"列, 旧 extractor 把 vals[0] (年龄 37-96) 当成保单年度, 导致 col_offset 错位, Y41 退保总额突然跳到 3,530 等异常值
- 折线图 Y41 身故赔偿显示 3,530 (应是 383,380)
- 储蓄+CI 组合: slide 12 重疾公司介绍页第 3 张卡片显示储蓄险产品名 (例: "财富盈活"), 应是 CI 产品名
- Slide 4 总缴保费 = USD 36,590 (= 7,318 × 5), 硬编码 × 5 不管实际 10 年缴, 应是 73,180
- Slide 6 "保障范围 (0 项)" — coverage_items 为空, count=0, 触发默认 fallback

### 修复

- **extract_aia_ci.py** — 3 处关键修复
  1. 检测 header 是否含"年龄"列 (`has_age_col = '年龄' in hdr and len(ex[0]) >= 9`)
  2. 年龄列存在时 vals[0]=年龄, vals[1]=保单年度, col_offset=1
  3. 跳过 "X岁" 年龄行 (page 3 的 8-col 表把 age 65 写成 "65岁", 实际是 Y29 重复)
  - 修复后: 3 个 aibanhang PDF 全部 64 rows (Y1-Y64), 无 Y65-Y100 重复

- **server.ts (src/api/server.ts:1367-1379)** — coverage_items 兜底
  - CI fast-path 跑完 extract_aia_ci.py 后, 补 6 项默认 coverage_items (严重疾病保障/首20年额外/早期危疾/保障还原/严重都市疾病额外/保费豁免)
  - 防 `_slide_ci_overview` 计数为 0

- **pptx_renderer.py:280** — 总缴保费 × 5 bug
  - 旧: `total_prem = (paid_total or premium * 5) if premium else 0`
  - 新: 从 `policy.premium_payment_period` 提取数字 (10年缴 → ×10, 趸交 → ×1)

- **pptx_renderer.py:482, 535** — CI 公司介绍页 product_name 修复
  - 旧: 传顶层 `meta` (储蓄产品名)
  - 新: 创建 `ci_sub_meta = {**meta, 'product_name': ci_data.summary.product_name}` (与 IUL L490/547 模式一致)
  - Slide 12 第 3 张卡片 (series_label) 现在显示 CI 产品名

### 验证 (公网 ECS ppt.gllpsce.cn)

- AIA 愛伴航 2(2) PDF: Y41 sv=332,662, death=383,380 ✓
- 折线图 68 个点, 已缴保费 7,318 → 73,180, 身故赔偿 135,000 → 1,955,530 平稳增长
- 储蓄+CI 组合: slide 12 重疾公司介绍第 3 张卡片显示 CI 产品名 ✓
- 总保费 = 73,180 ✓

### 部署

- rsync src/api + scripts → /opt/insurance-ppt (Bun PID 120543)
- rsync docker/insurance-deck/ → /opt/insurance-deck (md5 b41e1e72...)
- 清 __pycache__
- 健康检查 HTTP 200

## V3.1.2-ci-render-fix (2026-07-07) - AIA + CTF CI 渲染修复

基于 V3.1.1-ui-microtweak 增量修复。核心: AIA 愛伴航 / CTF 守X家倍198 等 CI 产品从「数据生成但 PPT 渲染崩溃」到「端到端成功」。

### 问题

- AIA 愛伴航 + CTF 守X家倍198 等 CI 产品解析时:
  - LLM 给 18 行 benefit_illustration（错）
  - `extract_aia_ci.py` Fitz 给出 94 行（正确）
  - 但 `ciResult.summary` 被丢弃
  - 导致 `policy.sum_insured = None`
  - `_slide_ci_overview` 渲染时 `int(None)` TypeError
  - 日志: `TypeError: int() argument must be a string, a bytes-like object or a number, not 'NoneType'`

### 修复

- **server.ts (src/api/server.ts:1343-1367)** — CI Fitz 路径同步 summary
  - 旧版: 仅用 `ciResult.benefit_illustration`, 丢弃 `summary`
  - 新版: 同时合并 `csm.annual_premium / csm.sum_insured / csm.insured_age / csm.insured_gender` 到 `r.data.policy` 和 `r.data.insured`（与 IUL fitz 模式一致）
  - 防护 `_slide_ci_overview` 因 `sum_insured=None` 崩溃

- **extract_aia_ci.py** — 修 regex 三处
  - 年龄 regex `r'年龄[：:]\s*(\d+)'` 改为 `r'年龄[：:][^\d]{0,30}?(\d+)'`（容许 | 与中文）
  - 投保时保额 regex 用 `re.findall` + 取 `>= 10000` 的最大值（避免抓到 "保险计划 2" 的 "2"）
  - 年缴保费 regex 用 `[\s\S]{0,100}?` 容许换行（`年缴保费` 后是换行，不是空格）
  - **结果**: AIA aibanhang 提取 `{insured_age: 36, gender: 男, annual_premium: 7318, sum_insured: 100000}` ✓

- **pptx_renderer.py:1694-1695** — 防御性 None 处理
  - `premium = ... or 0`
  - `coverage = ... or 0`
  - 即使 sum_insured 缺失, 也不崩溃

### 验证

```
AIA 愛伴航 (2).pdf 端到端测试 (ECS):
- upload → parse → extract → render → download
- status: done
- slideCount: 11
- policy.sum_insured: 100000 ✓
- policy.annual_premium: 7318 ✓
- bi_count: 94 ✓
- insured.age: 36 ✓
```

### 部署

- ECS PID: 116435 (启动 2026-07-08 04:14 UTC+8)
- 公网: https://ppt.gllpsce.cn
- 修改文件: 3 个 (server.ts + extract_aia_ci.py + pptx_renderer.py)

---

## V3.1.1-ui-microtweak (2026-07-07) - UI 微调

基于 V3.1.0-fastpath-complete 微调（前端 only, ECS 已部署验证）。

### 修改

- **首页公司下拉微调** (`public/js/screens/upload.js`)
  - 储蓄险: 排除 `great-eastern` (大东方人寿), 不再显示
  - 重疾险: 仅保留 `aia` (友邦) + `ctf` (周大福), 其他公司隐藏
  - 原因: 当前内测仅友邦/周大福 CI 数据稳定, 其他公司 CI 易渲染崩溃
  - **注意**: ECS API 返回的 id 是 `great-eastern`（带连字符）, 过滤时需匹配

- **首页新增反馈提示** (`public/index.html`)
  - 在 "已选 0 份计划书" 下方添加: "如遇到无法解析的计划书，请将原计划书发至 bxwang65@gmail.com, 感谢您的使用与反馈"
  - 邮箱地址带链接 (mailto:)

### 已知问题（未修）

- AIA 愛伴航 / CTF CI 渲染崩溃: `pptx_renderer.py:1700` 在 `sum_insured=None` 时 TypeError
  - 数据提取 OK (18 行 benefit_illustration), 仅 PPT 渲染失败
  - 待修复: `_slide_ci_overview` 加 None 兜底

### 部署

- ECS PID: 115363 (启动 2026-07-08 03:53 UTC+8)
- 公网: https://ppt.gllpsce.cn
- 修改文件: 2 个 (public/index.html + public/js/screens/upload.js)
- diff: +19/-7 行

---

## V3.1.0-fastpath-complete (2026-07-05) - Fast-path 100% 覆盖

基于 V3.0.2-stable-14products 增量升级。核心目标: 所有储蓄险 fast-path 命中，零 LLM 兜底。

### 新增功能

- **Fast-path 覆盖率 92% → 100% (24/24 储蓄险)**
  - 新增 `extract_no_withdraw_pru()` — 保誠「信守明天」多元貨幣計劃 (TRST), 99 行 / 222ms
  - 新增 `extract_no_withdraw_china_taiping_1121()` — 太平「頤·樂享」尊享版 (1121NWLP7), 129 行 / 222ms
  - 新增 `extract_no_withdraw_chinalife()` — 中国人寿傲珑盛世 (C540), 130 行 / 234ms
  - 新增 `extract_no_withdraw_taiping()` — 中国太平鑫安逸 (AAXNA1U), 30 行 / 1s
  - **用户反馈**: "所有公司的所有产品！！都要有自己单独的产品解析器"

- **新增 signature (registry.ts)**
  - `aia-aibanhang-v1` AIA 愛伴航保險計劃 2
  - `aia-huanyu5-v2` AIA 環宇盈活 (5年繳) — 取代 v1, 适应 PDF 标题换行
  - `transamerica-giul3-v2` 全美 TA_GIUL3+M (繁体)
  - `transamerica-genesis3-v1` Genesis III IUL

- **PageTargets 优化**
  - PRU 信守明天: `[...range(2,5), ...range(11,16)]` (14页) → `[2, 12, 13, 14]` (4页)
  - 太平-1121: `range(2, 12)` (12页) → `[3, 7, 8, 9, 10, 14]` (6页)
  - 跳过 身故/不同投資回報/備註 页，避免误抓数据

### 修复

- **Fast-path section header 模式匹配** (取代关键词存在性)
  - 用户反馈: 退保页 备注 提到 "身故" "投資回報" 关键词，旧版 `if "身故" in text: continue` 误杀整页
  - 新版用 section header 模式: `if "3. 基本計劃 – 身故賠償之説明摘要" in text: continue`
  - 保誠信守明天 Y86-Y99 行恢复 (旧版丢 14 行)
  - 太平颐年乐享 Y110-Y129 行恢复 (旧版丢 19 行)

- **Orchestrator 完整性 check**
  - 旧版: 用 `target_age - age + pay_years` 推算预期保单年限, 对鑫安逸 30年/傲珑盛世 130年算错
  - 新版: 优先 `signature.presentationHorizonYears`, fallback 才用推算公式

- **AIA premium 解析 Pattern 增强**
  - Pattern 1b: 表格列里识别 NN,NNN.XX (AIA 環宇盈活)
  - Pattern 2: 重复 2+ 次的 NN,NNN.XX (兼容 .09/.49 含征费小数)
  - Pattern 3: 简体 levy 优先 ("投保时年缴总保费")

- **Orchestrator JSON.parse 防御**
  - PyMuPDF 1.24.x 会把 ExtGState 错误写到 stdout, 污染 JSON.parse
  - 新版: 找第一个 `{` 和最后一个 `}`, 截取中间段

### LLM 链调整

- **移除 Kimi**: 2026-07-05 起 kimi-for-coding billing cycle 配额耗尽返回 403, 踢出链
- **链路**: minimax (主) → deepseek → agnes
- **Agnes 定位**: 仅 fallback (实测慢 4-5x, 图多超时)

### 已知问题 (本次未修)

- 宏挚家传承 (manulife-lovehome-v1): fast-path 提取 62 行, completeness threshold 80 → 仍 LLM
- 世代悦享3 (cpic-aarj31u-v1): fast-path 提取 30 行, threshold 130 → 仍 LLM
- IUL render crash: sum_insured=None 时 TypeError (pptx_renderer.py:2006)

### 部署

- 路径: `~/insurance-ppt-v3/`
- 备份: `~/insurance-ppt-v3-backups/ecs-2026-07-05-v3.1.0-fastpath-complete.tar.gz` (86M)
- .env: `~/insurance-ppt-v3-backups/.env.2026-07-05-v3.1.0-fastpath-complete` (chmod 600)
- 公网: https://ppt.gllpsce.cn
- ECS PID: 101553

---

## V3.0.0-frozen (2026-06-24) - 首次封装

基于 `/Users/soldier/free-code/packages/insurance-ppt/` 2026-06-24 状态封装.

### 修复 (相对于 V2)

- **Manulife IUL 提取**
  - `extract_first_n_pages.py`: CJK 字符检测, Manulife 等图片型/CJS字体子集化 PDF 自动降级到 OCR
  - `pdf-first-pages.ts`: 处理 PyMuPDF 错误污染 stdout 的问题 (取首个 `{` 之后的 JSON)
  - `extract_manulife_iul.py` parse_table_lines: 7-列布局 off-by-one 修复
    - 旧: `surrender_value = nums[3]` (实际是最低退保價值)
    - 新: `surrender_value = nums[4]` (真正的退保價值, 即表格第6列)
  - `extract_manulife_iul.py`: 数据驱动识别缴费年期 (1/5/10/趸交)
  - `extract_sunlife_iul.py`: 永明 IUL 趸交过滤 + pay_years 自动识别

- **IUL PPTX 表头修正**
  - `insurance-deck/insdeck/render/pptx_renderer.py`:
    - 表头 "户口价值 非保证(USD)" → "退保价值 (USD)"
    - 数据源 `account_value_less_fee` → `non_guaranteed_cash_value` (兜底 account_value)
    - 折线图系列名 "非保证户口价值" → "退保价值"

### 用户反馈触发

- 用户多次反馈 "PPT7-8中的'非保证户口价值'应该改成'退保价值'"
- 用户反馈 "退保价值是表格的第6列, 抓不到" — 暴露 off-by-one 列偏移 bug
- 用户要求封装冻结版本以防后续开发破坏

### 部署

- 路径: `~/insurance-ppt-v3/`
- Git: github.com/bxwang65/insurancePPT @ branch `v3-frozen` / tag `v3.0.0-frozen`
- 公网: https://ppt.gllpsce.cn (Cloudflare Tunnel → localhost:3000)
- 启动: `scripts/start.sh` (nohup 后台守护, 终端关闭不影响)
