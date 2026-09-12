# HK 佣金费率季度刷新 Playbook

**何时用**: 每季度保险公司更新费率表 (7/9/12/3 月, 通常), 需要把新 PDF 的数据灌进本地 DB, 培训 admin 后台才能查到新佣金率。

**谁做**: Claude (你) + 用户 (审核 CSV)

**目标**: 一个下午搞定, 不用每次重新摸索。

---

## 0. 准备 (用户操作, ~10 min)

1. 拿到保险公司发来的新 PDF (10 个):
   - `7月HX{NPI,PI}费率表L{1,2,3}.pdf` × 6
   - `7月HX{NPI,PI}费率表{直接,间接}伯乐.pdf` × 4
2. 把 10 个 PDF 放到 `db/source_pdfs/` (项目目录), **覆盖**旧文件
3. 用户用 PDF + 计算器核对 6 款主打产品 (PI L1/L2/L3 + 直接/间接伯乐), 输出:
   - CSV 文件 `db/reference/2026Q4.csv` (格式见下)
   - 必须含的产品 (从历史跑过的):
     - AIA 友邦 AA06805 / AXA 安盛 CC05505 / MLI 宏利 EE01905
     - FWD 富衛 FF03405 / 永M (空 code) / CPIC太保 QQ01305
     - PI 全部 + NPI 主要 L1/L2/L3
   - CSV 列: `company,code,term,investor,level,total_pct,direct_pct,indirect_pct`

---

## 1. 抽取 (Claude 执行, ~5 min)

```bash
cd /Users/soldier/insurance-ppt-v3

# 先 dry-run (--skip-archive 不动老数据)
python3 db/scripts/extract_hx_pdfs.py \
  --pdf-dir db/source_pdfs \
  --db db/hx_rates.db \
  --skip-archive \
  --report db/reference/extract_2026Q4_dryrun.md

# 看报告: db/reference/extract_2026Q4_dryrun.md
#   - 各表产品数 (应该 > 之前季度)
#   - 各公司产品数
#   - 0 数据产品 (异常!)
```

**模式库 (踩过的坑, 见 extract_hx_pdfs.py)**:

| 模式 | 来源 PDF | Bug | 修复 |
|------|----------|-----|------|
| `永M` 简略表 company 字段缺失 | `parse_simple_table` | 永M 伯乐表 company 全空 | `company: '永M'` (硬编码) |
| `於 X月X日前簽署` vs `签发` | `infer_activity_deadline` | 只匹配签署, 不匹配签发 | 优先 "签发" 模式 (UI 已用 issue_deadline) |
| 同 (code, plan, term) 多版本 | `activity_priority` | 非活动版覆盖活动版 | 优先 is_activity=1 |
| NPI L1 schema (y1/y2... + total) vs NPI L2 (y1/y2... + add_l2 + total_l2) | `_apply_rate` | 用错字段 | 按 level 分别处理 |

如果新 PDF 出现新模式 (新保险公司 / 新表结构), 加到上表 + extract_hx_pdfs.py.

---

## 2. 验证 (Claude 执行, ~2 min)

```bash
# 把 qa_validate.py + CSV 拷到容器 (DB 在容器内)
docker cp db/scripts/qa_validate.py hx-rates-api-dev:/app/db/scripts/
docker cp db/reference/2026Q4.csv hx-rates-api-dev:/app/db/reference/

# 跑验证
docker exec hx-rates-api-dev python3 /app/db/scripts/qa_validate.py \
  --csv /app/db/reference/2026Q4.csv \
  --db /app/db/hx_rates.db

# 输出:
#   ✓ 全部 PASS → 进 step 3
#   ✗ 有 FAIL → 看 Markdown 报告 (qa_report_*.md), 排查 extract
```

**常见 FAIL 类型**:

| FAIL | 原因 | 修复 |
|------|------|------|
| total_pct Δ > 0.05% | PDF 改了费率 / extract 抽错列 | 重新读 PDF 对应页, 改 extract_hx_pdfs.py |
| MISS (DB 无此产品) | 新增产品但没抽到 | 加 extract 模式 (见 step 1 模式库) |
| direct/indirect Δ > 0.05% | 伯乐表 company/code 错位 | 看 debug 路径 |
| L1 NPI total=0 | L1 NPI schema 用 `total` 字段, 不是 `total_l1` | 验证 _apply_rate 路径 |

---

## 3. 真正抽取 (Claude 执行, ~3 min)

```bash
# qa_validate 全过后, 真正灌入 (覆盖老数据)
python3 db/scripts/extract_hx_pdfs.py \
  --pdf-dir db/source_pdfs \
  --db db/hx_rates.db \
  --report db/reference/extract_2026Q4.md
```

extract 自动把老数据 `effective_to` 设为新日期前一天 (归档), 新数据 `effective_from` = 今天。

---

## 4. 重新验证 (Claude 执行, ~1 min)

```bash
docker exec hx-rates-api-dev python3 /app/db/scripts/qa_validate.py \
  --csv /app/db/reference/2026Q4.csv \
  --db /app/db/hx_rates.db

# 应该 ✓ 全部 PASS
```

---

## 5. 集成测试 (Claude + 用户, ~5 min)

```bash
# 跑单元测试
docker exec hx-rates-api-dev python3 /app/db/scripts/test_lookup_commission.py --db /app/db/hx_rates.db
# 期望: 30/30 PASS

# 浏览器手测 (用户):
#   1. http://localhost:3000/training/admin/index.html#/rates
#   2. 选 AIA 友邦 / AA06805 / 5年 / 100000 / L2 / PI
#   3. 看 breakdown: 基础total=57.91% + 加点=3.00% + 首年合计=60.91% + 直接=2.39 + 间接=1.60 = 总计 64.90%
```

---

## 6. 同步 (Claude 执行, ~10 min)

如果用户确认 ECS 也需要:

1. **DB**: `rsync db/hx_rates.db hk-ecs:/opt/insurance-deck/db/` (走 SSH key)
2. **API**: 重 build + 重启 hx-rates-api 容器
3. **UI**: 重 build admin-web + 同步到 4in1 public
4. **CSV 参考表**: 同步到 ECS 容器内

详细命令参考项目根 CLAUDE.md (如有) 或最近的同步 log.

---

## 7. 完成

把以下文件 commit:
- `db/reference/2026Q4.csv` (新增)
- `db/reference/extract_2026Q4.md` (新增)
- `db/source_pdfs/*.pdf` (覆盖 10 个)
- `db/hx_rates.db` (新版本)
- `db/scripts/extract_hx_pdfs.py` (如有修改)
- `db/scripts/qa_validate.py` (新增)
- `docker/hx-rates/app.py` (如有 issue_deadline 等修改)

---

## 关键文件清单

| 文件 | 作用 |
|------|------|
| `db/scripts/extract_hx_pdfs.py` | PDF → SQLite 主抽取脚本 |
| `db/scripts/qa_validate.py` | 用户参考表 → 自动对账 |
| `db/scripts/test_lookup_commission.py` | Bug A/B/C 回归测试 (硬编码 EXPECTED_PI/NPI) |
| `db/scripts/lookup_commission.py` | 单条/批量查询 (核心业务逻辑) |
| `db/reference/2026Q3.csv` | 当前参考表 (6 款主打产品) |
| `db/reference/2026Q4.csv` | 季度新参考表 (待用户制作) |
| `db/source_pdfs/*.pdf` | 10 个源 PDF 备份 |
| `db/hx_rates.db` | SQLite 数据库 (容器内 /app/db/hx_rates.db) |
| `docker/hx-rates/app.py` | FastAPI 服务 (issue_deadline 解析等) |

---

## 紧急回滚

如果 Q4 数据有问题, 1 分钟回滚:
```bash
# 找到上次有效 DB 的 effective_from
sqlite3 db/hx_rates.db "SELECT DISTINCT effective_from FROM pi_fee_l2 ORDER BY 1 DESC LIMIT 5"

# 把所有行的 effective_to 清空 (重启用老数据)
sqlite3 db/hx_rates.db "UPDATE npi_fee_l1 SET effective_to = NULL WHERE effective_from = '2026-Q3-日期'"
# ... 重复 10 张表
```

或者更简单: `git checkout db/hx_rates.db` (如果 DB 在 git 里, 否则用上一个 tar.gz 备份).