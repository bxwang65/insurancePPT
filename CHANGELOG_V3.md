# V3 变更日志 (CHANGELOG)

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
