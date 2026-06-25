# V3 变更日志 (CHANGELOG)

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
