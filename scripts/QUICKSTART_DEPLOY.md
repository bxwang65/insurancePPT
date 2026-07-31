# insurance-ppt-v3 ECS 部署 Quick-Start

> 最后更新: 2026-06-29 · 作者: boxie wong + claude
> 适用版本: insurance-ppt-v3 (V3), ECS Ubuntu 20.04 + Python 3.8 + Bun 1.3.14

---

## 0. 30 秒流程图

```
Mac 端改代码
  ↓
bash scripts/deploy-ecs.sh         ← 一键, Mac 端会自动调 preflight
  ↓
ECS 验证: http://ppt.gllpsce.cn    ← 团队内侧
  ↓
打备份: insurance-ppt-v3-backups/<日期>-<tag>/
```

**核心原则: 任何代码改动 → 必须经 `deploy-ecs.sh` 走 ECS, 不允许只改本地容器不推 ECS。**

---

## 1. 三种部署模式 (按场景选)

### 模式 A: 一键部署 (最常用) ⭐

```bash
cd /Users/soldier/insurance-ppt-v3
bash scripts/deploy-ecs.sh
```

**会自动做**:
1. Mac 端检测 → 调 `ecs-preflight.sh --deploy`
2. 预检本地 (8 个 IRR 实现点 / pyc 状态 / Bun 版本)
3. SSH 到 ECS 现场预检 (Python / insurance-deck / pyc / .env / 端口)
4. 修复模式 (rsync insurance-deck + 清 pyc + 对齐 Bun + 同步代码 + 上传 .env)
5. ECS 端 `bun install --frozen-lockfile` + 启动服务
6. ECS 端 `calc_irr()` 自测 (期望 3.52%)
7. Mac 端 health check

### 模式 B: 仅预检 (不改任何东西)

```bash
bash scripts/ecs-preflight.sh           # 检查 + 报告, 不动文件
```

### 模式 C: 仅修复不部署 (适合改 ECS 现场问题)

```bash
bash scripts/ecs-preflight.sh --apply   # 修复 + 同步, 不重启服务
```

---

## 2. 部署后必验证清单 (5 分钟)

### 2.1 健康检查

```bash
# Mac 端
curl -s http://localhost:3000/api/health    # 本地容器
curl -s http://ppt.gllpsce.cn/api/health    # ECS 公网
```

期望: `{"status":"ok",...}`

### 2.2 M-A IRR 算法验证 (8 个实现点必须全对)

```bash
# ECS 端 SSH 进去跑
ssh root@47.242.58.70 "PYTHONPATH=/opt/insurance-deck python3 -c '
from insdeck.extract.savings_normalizer import calc_irr
r = calc_irr(10, 660340, 500000, 5, \"USD\")
print(f\"M-A IRR = {r*100:.2f}%\")   # 期望 3.52%
assert abs(r*100 - 3.52) < 0.05, \"不一致!\"
print(\"✓ M-A IRR 算法一致\")
'"
```

### 2.3 14 家公司 PDF 全跑一遍

```bash
# 在 ECS 上批量跑 (已验证 14/14 通过)
cd /opt/insurance-ppt
PYTHONPATH=/opt/insurance-deck python3 -c "
import json, glob, sys
sys.path.insert(0, 'scripts')
from extract_savings_by_signature import extract_savings

results = []
for pdf in sorted(glob.glob('/Users/soldier/Downloads/官方计划书案例/*.pdf')):
    r = extract_savings(pdf)
    name = pdf.split('/')[-1].replace('.pdf','')
    irr_y30 = r.get('irr_y30', 'N/A')
    results.append(f'{name}: Y30 IRR={irr_y30}')
print('\n'.join(results))
"
```

期望: 13/14 在 5-6.5% 正常范围, CPIC 鑫安逸 3.50% (3 年纯保证型偏低正常)。

### 2.4 浏览器烟测

访问 http://ppt.gllpsce.cn, 上传任一 PDF, 确认:
- 解析成功后页面渲染
- 摘要图 IRR 显示 (不是 CAGR)
- 无 console error

---

## 3. 8 个水土不服点速查 (出问题按表查)

| # | 严重度 | 现象 | 根因 | 修复 |
|---|---|---|---|---|
| 1 | 🔴 | Python 渲染 100% 失败 | `/opt/insurance-deck/` 缺失 | preflight 自动 rsync |
| 2 | 🔴 | 改 Python 不生效 | `__pycache__` 残留, pyc 覆盖新 py | `find /opt/insurance-deck -name __pycache__ -exec rm -rf {} +` |
| 3 | 🔴 | deploy 后 server 起不来 | ecs-deploy.sh:59-62 死分支 | preflight 已直接做 rsync |
| 4 | 🟠 | 部署后行为不一致 | ECS Python 3.8 vs 本地 3.11 语法差异 | 改 Python 用 `docker run python:3.8 -m py_compile` 验证, 禁用 PEP 604/585 |
| 5 | 🟠 | health check 假阴性 | `curl localhost:3000` 但 server 在 80 | preflight 自动 sed 修 |
| 6 | 🟠 | 行为漂移 | Bun latest ≠ Dockerfile 锁的 1.3.14 | preflight 装回 1.3.14 |
| 7 | 🟡 | 缓存 (实际不发生) | ES module 走 ETag, 不用 cache-bust | 无需操作 |
| 8 | 🟡 | .env 漏传 | rsync 排除 `.env` | preflight 用 scp 单独传, chmod 600 |

---

## 4. 关键路径速查

```
Mac 本地:
  /Users/soldier/insurance-ppt-v3/         ← 项目根
  /Users/soldier/insurance-ppt-v3-backups/ ← 历史备份

ECS:
  /opt/insurance-ppt/                      ← 代码 (rsync 目标)
  /opt/insurance-deck/                     ← Python 渲染模块 (额外 rsync)
  /opt/insurance-ppt/.env                  ← 环境变量 (scp 单独传, chmod 600)
  /opt/insurance-ppt/logs/server.log       ← 服务日志
  /opt/insurance-ppt/logs/server.pid       ← 进程 PID

Docker 本地容器:
  /opt/insurance-ppt/ (bind mount ← /host_mnt/Users/soldier/insurance-ppt-v3/)
  image: insurance-ppt:v3.0.3
  port: 3000 → 80
```

---

## 5. 常见操作速查

### 5.1 重启本地容器 (改了 server.ts)

```bash
cd /Users/soldier/insurance-ppt-v3
docker compose restart insurance-ppt
curl -s http://localhost:3000/api/health
```

### 5.2 重启 ECS 服务 (不重新部署)

```bash
ssh root@47.242.58.70 "bash /opt/insurance-ppt/scripts/ecs-restart.sh"
ssh root@47.242.58.70 "curl -s http://localhost:80/api/health"
```

### 5.3 改 Python 后强制清 pyc (本机 + ECS 都要清)

```bash
# Mac 本地
find /Users/soldier/insurance-ppt-v3/docker/insurance-deck -name __pycache__ -exec rm -rf {} +

# ECS
ssh root@47.242.58.70 "find /opt/insurance-deck -name __pycache__ -exec rm -rf {} +"
```

### 5.4 看 ECS 服务日志

```bash
ssh root@47.242.58.70 "tail -50 /opt/insurance-ppt/logs/server.log"
```

### 5.5 打备份

```bash
BACKUP="/Users/soldier/insurance-ppt-v3-backups/$(date +%Y-%m-%d)-<tag>"
mkdir -p "$BACKUP"
cp -a /Users/soldier/insurance-ppt-v3/. "$BACKUP/"
echo "✓ Backup: $BACKUP"
```

---

## 6. 故障排查决策树

```
ECS server 启动失败
  ├─ ssh root@47.242.58.70 "tail -50 /opt/insurance-ppt/logs/server.log"
  │   ├─ ImportError: No module named 'insdeck' → /opt/insurance-deck 缺失, 跑 preflight --apply
  │   ├─ FileNotFoundError: .env                → .env 缺失, scp 上传
  │   └─ 其他 Python 错误                        → 看堆栈, 多半是 pyc 残留, 清 pyc
  │
  ├─ 健康检查 404 / 502
  │   ├─ 端口不对 → server.ts PORT 环境变量检查
  │   └─ Bun 进程没起 → ecs-restart.sh 手动重启
  │
  └─ IRR 结果不对 (CAGR 不是 M-A)
      ├─ 8 个实现点查 grep "(\*\* (1 /" → 应为 0
      ├─ 改过算法忘了同步 → 同步所有 8 个调用点
      └─ pyc 覆盖新 py → find __pycache__ -exec rm
```

---

## 7. 关键联系人 / 凭证

| 项 | 值 |
|---|---|
| ECS IP | `47.242.58.70` |
| ECS 公网 | `http://ppt.gllpsce.cn` |
| 本地容器 | `http://localhost:3000` |
| SSH 密钥 | `~/.ssh/id_rsa.pub` 已上传 |
| `.env` 位置 | `Mac: ~/.ssh 旁边的 /Users/soldier/insurance-ppt-v3/.env` |
| Kimi API | `https://api.kimi.com/coding/v1` (model: `kimi-for-coding`) |
| 备用2 LLM | `minimax` M3 (`https://api.minimax.chat/v1`) |
| 备用3 LLM | Agnes 2.0 Flash (`https://apihub.agnes-ai.com/v1`) |

**Kimi API URL 必须带 `/v1` 后缀**, 否则报 `resource_not_found`。

---

## 8. 历史备份索引

```
/Users/soldier/insurance-ppt-v3-backups/
├── 2026-06-26-ecs-stable-14products/                  ← 老备份 (Kimi URL 错, 已被覆盖)
└── 2026-06-29-ecs-kimi-fixed-14products-verified/    ← 当前 OK 版, 14/14 PDF + M-A 全通过
```

备份策略: **每次 ECS 部署成功且自测通过后打一个 `<日期>-<tag>` 备份**, 至少保留最近 3 个。

---

## 9. M-A IRR 算法标准 (8 个调用点)

**Why**: 用户 2026-06-28 明确指示所有储蓄险 IRR 统一用 M-A NPV IRR, 禁 CAGR。

```python
# 算法本质
NPV(r) = Σ cashflow_t / (1+r)^t = 0,  bisect r ∈ [-0.99, 1.0], 200 iter, tol=1e-6
HK IA cap: HKD 6.0% / 非 HKD 6.5%
```

**8 个调用点必须保持一致**:

| # | 文件 | 函数 |
|---|---|---|
| 1 | `src/api/server.ts` | `computeIrrMA()` / `computeIrrMAWithdraw()` |
| 2 | `src/pipeline/presentation-agent.ts` | `computeIrrMA()` |
| 3 | `public/js/screens/result-summary.js` | `computeIrrMA()` |
| 4 | `docker/insurance-deck/insdeck/extract/savings_normalizer.py` | `calc_irr()` / `calc_irr_withdraw()` |
| 5 | `scripts/extract_savings_by_signature.py` | `calc_irr_ma()` / `calc_irr_ma_withdraw()` |
| 6 | `scripts/extract_ci_by_signature.py` | `_calc_irr_ma()` |
| 7 | `scripts/generate_combo.ts` | `calcIRR()` / `calcIRRWithdraw()` |
| 8 | `scripts/generate_from_ai.ts` | `calcIRR()` / `calcIRRWithdraw()` |

**改算法时**: 同步更新全部 8 个点, 改完跑第 2 节 2.2 验证。

---

## 10. 应急回滚

```bash
# 列出所有备份
ls -lt /Users/soldier/insurance-ppt-v3-backups/ | head -5

# 选一个备份覆盖本地
cp -a /Users/soldier/insurance-ppt-v3-backups/2026-06-29-ecs-kimi-fixed-14products-verified/. \
      /Users/soldier/insurance-ppt-v3/

# 重启本地 + 重推到 ECS
docker compose restart insurance-ppt
bash scripts/deploy-ecs.sh
```

---

## 附: 相关脚本清单

| 脚本 | 跑在哪 | 作用 |
|---|---|---|
| `scripts/deploy-ecs.sh` | Mac | 一键部署 (自动调 preflight) |
| `scripts/ecs-preflight.sh` | Mac | 预检 + 修复 + 部署 (3 模式) |
| `scripts/ecs-restart.sh` | ECS | 仅重启服务, 不重装 |
| `scripts/ecs-deploy.sh` | ECS | 老部署脚本 (已被 deploy-ecs.sh 取代) |
| `scripts/extract_savings_by_signature.py` | Mac/ECS | 储蓄险 fast-path 提取 |
| `scripts/extract_ci_by_signature.py` | Mac/ECS | CI 险 fast-path 提取 |

---

> 💡 **关闭会话后找回路径**:
> 1. 项目内: `/Users/soldier/insurance-ppt-v3/scripts/QUICKSTART_DEPLOY.md`
> 2. Obsidian 同步: `/Users/soldier/Desktop/insurance-platform/HKSGtools/insurance-ppt-v3部署QuickStart.md`
> 3. 备份目录: `/Users/soldier/insurance-ppt-v3-backups/<日期>-<tag>/`