# ECS 部署预案 (2026-07-01 待执行)

## 当前状态对比

### ECS (47.242.58.70)
- HEAD: `5fd23a4` 与本地一致 (无新提交)
- 运行中: PID 52216, Jun 29 10:20 启动 (2天)
- 未提交修改: 7 个文件 (上次部署未 commit)
- .env 已有: KIMI / DEEPSEEK / MINIMAX / GEMINI / OPENROUTER

### 本地 Docker 3000
- HEAD: `5fd23a4` 一致
- 未提交修改: 13 个文件 (比 ECS 多 6 个核心改动)
- 容器: insurance-ppt:v3.0.3, 已加载新代码

## ECS 落后于本地的 6 个核心改动 (水土不服点)

| # | 文件 | 改动内容 | ECS 现状 | 影响 |
|---|---|---|---|---|
| 1 | `src/extraction/signatures/registry.ts` | **新增 4 个 signature** (aia-aibanhang-v1 / aia-huanyu5-v2 / transamerica-giul3-v2 / transamerica-genesis3-v1) | ❌ 缺失 | 愛伴航/環宇盈活/TA_GIUL3/Genesis III 仍走 LLM (贵 + 慢) |
| 2 | `src/extraction/signatures/matcher.ts` | `detectProductCodeFromText` regex 加 AIBANHANG2/TA_GIUL3/GIUL3/GENESIS3/SBIUL2/SIUL3 | ❌ 缺失 | 4 个新产品的 signature 命中不了 |
| 3 | `src/extraction/openai-extractor.ts` | PROVIDER_DEFAULTS 加 doubao/qwen; imageCapable list 同步 | ❌ 缺失 | 豆包/千问完全不可用 (但 ECS 暂不用) |
| 4 | `src/extraction/orchestrator.ts` | 新增 fastPartialSavings 完整性闸 (orchestrator.ts:132-149) | ❌ 缺失 | ECS 会接受 18 行部分提取 (日志已证实) |
| 5 | `src/api/extraction-queue.ts` | 队列逻辑微调 | ❌ 缺失 | 队列行为可能不一致 |
| 6 | `scripts/deploy-ecs.sh` | 部署脚本更新 | ❌ 旧版 | deploy-ecs.sh:61 端口错误未修 |

**没有改动的** (本地与 ECS 同步):
- `result-summary.js`, `extract_*.py`, `generate_*.ts`, `server.ts`, `presentation-agent.ts` — ECS 已有未提交版本

## 部署前 6 个水土不服对策

1. **insurance-deck 同步** (`/opt/insurance-deck`)
   - 风险: server.ts 引用的 Python 渲染模块路径
   - 对策: `ecs-preflight.sh --apply` 阶段自动 rsync (排除 __pycache__)

2. **__pycache__ 残留**
   - 风险: 旧 pyc 覆盖新 py
   - 对策: `find /opt/insurance-deck -name __pycache__ -exec rm -rf {} +`

3. **Bun 版本对齐**
   - 风险: 本地 1.3.11 vs Dockerfile 锁 1.3.14
   - 对策: preflight 自动装 1.3.14 到 `/usr/local/bin/bun`

4. **健康检查端口**
   - 风险: deploy-ecs.sh:61 老版本用 `localhost:3000` (ECS 上没 3000)
   - 对策: preflight 已修本地脚本, 但 ECS 上老脚本要等下次 rsync 覆盖

5. **浏览器缓存**
   - 风险: 旧 result-summary.js 被浏览器缓存
   - 对策: ES module 走 ETag/Last-Modified, 改文件后浏览器自动 refetch

6. **PYTHONPATH**
   - 风险: `/opt/insurance-deck` 找不到
   - 对策: 写入 `/etc/environment`

## 部署执行顺序 (明天 KIMI 测完后)

```bash
# ═══ 1. 备份 ECS ═══
bash scripts/ecs-backup.sh
# 备份到 ~/insurance-ppt-v3-backups/ecs-<timestamp>.tar.gz

# ═══ 2. 预检 + 修复 ═══
bash scripts/ecs-preflight.sh --apply
# 同步 insurance-deck + 清 pyc + 对齐 Bun + rsync 代码 + .env

# ═══ 3. 部署 ═══
bash scripts/ecs-preflight.sh --deploy
# bun install --frozen-lockfile + ecs-restart + calc_irr 验证

# ═══ 4. 公网验证 ═══
curl -s https://hksgtools.cn/api/health
# 测 4 个新产品: 愛伴航/環宇盈活/TA_GIUL3/Genesis III 应走 fast path

# ═══ 5. 查 ECS 日志 ═══
ssh root@47.242.58.70 'tail -f /opt/insurance-ppt/logs/server.log'
# 确认 [orch] fastPartialSavings 警告符合预期
```

## 回滚预案 (3 步)

```bash
# 1. 停服务 + 清目录
ssh root@47.242.58.70 'bash /opt/insurance-ppt/scripts/ecs-stop.sh; rm -rf /opt/insurance-ppt'

# 2. 恢复 tar 包
scp ~/insurance-ppt-v3-backups/ecs-<timestamp>.tar.gz root@47.242.58.70:/opt/
ssh root@47.242.58.70 'cd /opt && tar -xzf ecs-<timestamp>.tar.gz'

# 3. 恢复 .env + 启服务
scp ~/insurance-ppt-v3-backups/.env.<timestamp> root@47.242.58.70:/opt/insurance-ppt/.env
ssh root@47.242.58.70 'chmod 600 /opt/insurance-ppt/.env && bash /opt/insurance-ppt/scripts/ecs-restart.sh'
```

## 监控指标 (部署后第一小时)

| 指标 | 期望 | 报警阈值 |
|---|---|---|
| `[orch] 签名 X 命中但提取 0 行` | 0 | > 3/小时 = signature 失效 |
| `[orch] 提取仅 N 行, 预期 M` (fastPartialSavings) | 个位数 | > 20/小时 = 年龄边界判定太严 |
| `[orch] IUL fitz returned 0 rows` | 仅 Manulife IUL | > 5/小时 = 其它公司也失败 |
| 平均响应时间 | < 5s (signature fast path) | > 15s = LLM 兜底过多 |
| 失败率 | < 5% | > 10% 立即回滚 |

## ECS .env 同步核对清单

部署前比对本地与 ECS `.env` (逐项):

```bash
# 在 ECS 上
ssh root@47.242.58.70 'cat /opt/insurance-ppt/.env' | sed 's/=.*/=<SET>/' > /tmp/ecs.env.keys
# 在 Mac 上
sed 's/=.*/=<SET>/' .env > /tmp/local.env.keys
diff /tmp/ecs.env.keys /tmp/local.env.keys
```

**重点关注**:
- `MINIMAX_API_KEY` — 本地已轮换为新 key (`sk-cp-yddr...`), ECS 可能还是旧 key (无效)
- `KIMI_API_KEY` — ECS 是 49 会员配额 key, 本地若不同需同步
- `DEEPSEEK_API_KEY` — 已是新 key (`sk-f883c33cf700...`), ECS 可能有旧 key
- `EXTRACTION_PYTHON` — 本地用 `/usr/bin/python3.11`, ECS 必须有 (preflight 会查)