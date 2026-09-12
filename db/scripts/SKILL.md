---
name: hx-quarterly-rates-refresh
description: HK 佣金费率表季度刷新 - 用户给 10 个 PDF + CSV 参考表时, 一键抽取+对账. 触发场景: 用户说"Q4 换表了/保险公司发了新费率/季度刷新"
---

# HK 佣金费率季度刷新 Skill

每季度保险公司更新佣金率, 需要把新 PDF 数据灌进本地 SQLite DB, 让培训 admin 后台能查到新佣金率。**目标: 1 个下午搞定, 不重复踩坑**。

## 触发条件

用户提到以下任一关键词时自动应用:
- "Q4 换表" / "Q3 换表" / "季度刷新" / "保险公司发了新费率"
- "HX 佣金率更新" / "HX 费率"
- "extract_hx_pdfs.py" 提到要跑
- 用户把 10 个 PDF 放到 `db/source_pdfs/`

## 必读 (执行前先看)

| 文件 | 必读原因 |
|------|----------|
| `db/scripts/QUARTERLY_REFRESH.md` | 7 步详细 playbook (用户写) |
| `db/scripts/extract_hx_pdfs.py` | 主抽取脚本 (要读头部 + `--report` 段) |
| `db/scripts/qa_validate.py` | CSV 参考表对账脚本 |
| `db/reference/2026Q3.csv` | 当前季度参考表 (CSV 格式样板) |
| `db/source_pdfs/` | 10 个 PDF 文件名样板 |

## 一键流程 (推荐)

用户给出 `db/reference/2026Q4.csv` 后, 一条命令搞定:

```bash
./scripts/refresh-rates.sh --csv db/reference/2026Q4.csv
```

脚本会:
1. 检查 10 个 PDF 就位
2. 检查 CSV 存在
3. 检查容器 `hx-rates-api-dev` 在线
4. 抽取 PDF → SQLite (`--skip-archive` 看 dry-run)
5. 重 build hx-rates-api 容器 (让 app.py 最新版生效)
6. 把 qa_validate.py + CSV 拷到容器
7. 跑 qa_validate.py → 33/33 PASS 才算完
8. 输出汇总 + commit 指引

退出码: 0=全部 PASS, 1=有 FAIL/MISS。

## 手搓流程 (debug 时用)

```bash
# 1. dry-run (不动老数据, 只看报告)
python3 db/scripts/extract_hx_pdfs.py \
  --pdf-dir db/source_pdfs \
  --db db/hx_rates.db \
  --skip-archive \
  --report db/reference/extract_2026Q4_dryrun.md

# 2. 容器内对账
docker cp db/scripts/qa_validate.py hx-rates-api-dev:/app/db/scripts/
docker cp db/reference/2026Q4.csv hx-rates-api-dev:/app/db/reference/
docker exec hx-rates-api-dev python3 /app/db/scripts/qa_validate.py \
  --csv /app/db/reference/2026Q4.csv \
  --db /app/db/hx_rates.db

# 3. 真抽 (覆盖老数据)
python3 db/scripts/extract_hx_pdfs.py \
  --pdf-dir db/source_pdfs \
  --db db/hx_rates.db \
  --report db/reference/extract_2026Q4.md

# 4. 重 build 容器 + 再验证
docker compose build hx-rates-api
docker compose up -d hx-rates-api
docker exec hx-rates-api-dev python3 /app/db/scripts/qa_validate.py \
  --csv /app/db/reference/2026Q4.csv --db /app/db/hx_rates.db
```

## 模式库 (踩过的坑, 见 extract_hx_pdfs.py)

| 模式 | 来源 PDF | Bug | 修复 |
|------|----------|-----|------|
| `永M` 简略表 company 字段缺失 | `parse_simple_table` | 永M 伯乐表 company 全空 | `company: '永M'` (硬编码) |
| `於 X月X日前簽署` vs `签发` | `infer_activity_deadline` | 只匹配签署, 不匹配签发 | 优先 "签发" 模式 (UI 已用 issue_deadline) |
| 同 (code, plan, term) 多版本 | `activity_priority` | 非活动版覆盖活动版 | 优先 is_activity=1 |
| NPI L1 schema (y1/y2... + total) vs NPI L2 (y1/y2... + add_l2 + total_l2) | `_apply_rate` | 用错字段 | 按 level 分别处理 |

**新模式出现时**: 加到上表 + `extract_hx_pdfs.py`, 不要只在对话里说。

## CSV 参考表格式 (用户必填)

```csv
company,code,term,investor,level,total_pct,direct_pct,indirect_pct
AIA 友邦,AA06805,5,pi,L1,57.91,2.39,1.60
AIA 友邦,AA06805,5,pi,L2,60.91,2.39,1.60
...
永M,,5,pi,L1,59.45,2.46,1.64   # 永M code 可空
```

**必填列**: `company, code, term, investor, level, total_pct`
**选填列**: `direct_pct, indirect_pct, y1_pct, add_pct, y2_pct, y3_pct, y4_pct, y5_pct`
**容差**: ±0.05% (test_lookup_commission.py 已用此值)

**语义** (重要!):
- `total_pct` = 实际显示给用户的总佣金率
- PI: `total_pct` = `total_l2/l3` (不含伯乐)
- NPI: `total_pct` = `y1 + y2 + y3 + y4 + y5 + add_l2/l3` (不含伯乐)
- `direct_pct` / `indirect_pct` = 来自 `*_fee_direct/indirect` 表的 `direct_value`/`indirect_value`

## 必须含的 6 款主打产品 (用户参考表)

- AIA 友邦 AA06805
- AXA 安盛 CC05505
- MLI 宏利 EE01905
- FWD 富衛 FF03405
- 永M (code 空)
- CPIC太保 QQ01305

每款 PI/NPI × L1/L2/L3 = 6 行, 6 款 × 6 行 = 36 行 (实际有 33, AXA NPI 暂未测)。

## 常见 FAIL 类型 (修复表)

| FAIL | 原因 | 修复 |
|------|------|------|
| `total_pct` Δ > 0.05% | PDF 改了费率 / extract 抽错列 | 重新读 PDF 对应页, 改 `extract_hx_pdfs.py` |
| MISS (DB 无此产品) | 新增产品但没抽到 | 加 extract 模式 (见模式库) |
| `direct/indirect` Δ > 0.05% | 伯乐表 company/code 错位 | 看 debug 路径 |
| L1 NPI total=0 | L1 NPI schema 用 `total` 字段, 不是 `total_l2` | 验证 `_apply_rate` 路径 |

## 紧急回滚

```bash
# 找到上次有效 DB 的 effective_from
sqlite3 db/hx_rates.db "SELECT DISTINCT effective_from FROM pi_fee_l2 ORDER BY 1 DESC LIMIT 5"

# 把所有行的 effective_to 清空 (重启用老数据)
sqlite3 db/hx_rates.db "UPDATE npi_fee_l1 SET effective_to = NULL WHERE effective_from = '2026-Q3-日期'"
# ... 重复 10 张表
```

或更简单: `git checkout db/hx_rates.db`。

## 关键文件清单 (commit 时全要)

| 文件 | 作用 |
|------|------|
| `db/reference/2026Q4.csv` | 新季度参考表 (新增) |
| `db/reference/extract_2026Q4.md` | 抽取报告 (新增) |
| `db/source_pdfs/*.pdf` | 10 个 PDF (覆盖) |
| `db/hx_rates.db` | SQLite DB (覆盖) |
| `db/scripts/extract_hx_pdfs.py` | 主抽取脚本 (如有修改) |
| `db/scripts/qa_validate.py` | QA 脚本 (新增) |
| `db/scripts/SKILL.md` | 本文件 (新增) |
| `db/scripts/QUARTERLY_REFRESH.md` | 详细 playbook |
| `docker/hx-rates/app.py` | FastAPI 服务 (如改 issue_deadline 等) |
| `scripts/refresh-rates.sh` | 一键 orchestrator |

## 不要做的事

- ❌ 不要在没跑 qa_validate 前 commit
- ❌ 不要直接覆盖 db/hx_rates.db (先 dry-run, 看报告)
- ❌ 不要假设"上次跑过, 这次也能跑" (PDF 格式可能微调, 必须 qa 验证)
- ❌ 不要跳过 `--skip-archive` 的 dry-run (归档老数据前先确认新数据对得上)

## 不在 Skill 范围内 (转交其他任务)

- 培训 admin 前端页面 (`docker/training/admin-web/src/views/rates/`)
- 费率表浏览页面 (Phase 2)
- 历史版本切换 (Phase 3)
- ECS 同步 (`rsync` 到 hk-ecs)