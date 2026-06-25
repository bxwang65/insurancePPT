# V3 部署指南 (DEPLOYMENT.md)

## 部署概览

- **本地路径**: `/Users/soldier/insurance-ppt-v3/`
- **公网域名**: http://ppt.gllpsce.cn
- **Git**: github.com/bxwang65/insurancePPT @ branch `v3-frozen` / tag `v3.0.0-frozen`
- **架构 (V3.0.1 起)**: 用户 → ppt.gllpsce.cn → 阿里云 HK ECS (47.242.58.70:80) → Bun server

```
┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌──────────────────┐
│ 浏览器/用户  │ -> │ ppt.gllpsce.cn  │ -> │ Cloudflare DNS  │ -> │ 阿里云 HK ECS   │
│ (国内直连)  │    │ (A 记录 DNS)    │    │ (只解析不代理)   │    │ 47.242.58.70:80 │
└─────────────┘    └──────────────────┘    └─────────────────┘    └────────┬─────────┘
                                                                          │
                                                                          ▼
                                                                  ┌───────────────┐
                                                                  │  Bun server   │
                                                                  │  (port 80)    │
                                                                  └───────────────┘
```

## 为什么切到阿里云 HK ECS

| 方案 | 延迟 | 上传速度 | 稳定性 | 月成本 |
|---|---|---|---|---|
| ❌ Cloudflare Tunnel (旧) | 1-15秒 | 17-83 KB/s | 节点会掉 | $0 |
| ❌ 家庭宽带端口映射 | — | — | ISP 限制入站 | $0 |
| ❌ OpenFrp 免费节点 | — | — | 节点离线 | $0 |
| ✅ **阿里云 HK ECS (新)** | **165-230ms** | **6-7 MB/s** | **7×24 在线** | **$0.10/小时 (按量)** |

**优势**:
- 国内 BGP 直连, 上传满速 (比之前快 **80-400 倍**)
- ECS 按量付费, 不用可释放, **节省计划 $90 抵扣 ~1.3 个月**
- 公网 IP 固定, DNS 直解析, 不依赖任何隧道
- 用户**无需翻墙**即可访问

## 启动 / 停止 / 重启

### ECS 服务管理 (在 Mac 上)

```bash
cd ~/insurance-ppt-v3

# 状态检查
bash scripts/ecs-status.sh

# 部署 (rsync + 重启)
bash scripts/ecs-deploy.sh

# SSH 进 ECS 手动操作
ssh root@47.242.58.70
```

### ECS 实例管理 (阿里云控制台)

| 动作 | 操作 |
|---|---|
| **释放实例** (完全停费) | ECS 控制台 → 实例 → 释放 (释放后公网 IP 保留 7 天) |
| **重启实例** | ECS 控制台 → 实例 → 重启 |
| **停止实例** (短时停费) | ECS 控制台 → 实例 → 停止 (保留磁盘, 不计费) |
| **重新创建** (释放后) | ECS 控制台 → 创建实例, 选之前的镜像或重新选 Ubuntu 22.04 |

### 省钱策略

```bash
# 周末不用 → 释放实例, 周一重建
# ECS 销毁后, 公网 IP 在 7 天内可重新绑定
```

## 关键命令

```bash
# 在 Mac 上
bash scripts/ecs-status.sh   # 一键检查 ECS 状态
bash scripts/ecs-deploy.sh   # 部署代码 + 重启服务

# SSH 进 ECS
ssh root@47.242.58.70
# 进去后:
ps aux | grep bun
cat /opt/insurance-ppt/logs/server.log
tail -f /opt/insurance-ppt/logs/server.log
kill $(cat /opt/insurance-ppt/logs/server.pid)  # 停止
```

## ECS 关键信息

- **实例 ID**: i-j6c9hh6jylw675dyuhru
- **公网 IP**: 47.242.58.70
- **实例名**: insurance-ppt-v3
- **区域**: 中国香港 D
- **规格**: ecs.c9i.large (2 vCPU 4 GiB)
- **镜像**: Ubuntu 20.04
- **带宽**: 5 Mbps 按使用流量
- **价格**: $0.097872/小时 (节省计划覆盖 $90)
- **安全组**: SSH 22, HTTP 80, HTTPS 443, ICMP
- **登录**: root + 密码 (用户在本地保存)

## 部署历史

### V3.0.1 (2026-06-25) — ECS 部署
- 切换: Cloudflare Tunnel → 阿里云 HK ECS
- 速度提升: 17-83 KB/s → 6-7 MB/s
- 域名解析: Cloudflare DNS (DNS only 模式)
- 新增脚本: `ecs-deploy.sh`, `ecs-status.sh`, `ecs-restart.sh`

### V3.0.0 (frozen) — Cloudflare Tunnel
- 初始部署, 实际部署发现慢

## 故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| ppt.gllpsce.cn 访问失败 | ECS 实例被释放 | 控制台重新创建, 重新绑定公网 IP |
| 上传慢 (回到 17 KB/s) | DNS 改回了 Cloudflare 代理 | 检查 CF 记录: 应是灰云 (DNS only) |
| SSH 连不上 | ECS 被释放 / 公网 IP 变更 | 控制台查新 IP, 更新 `ecs-deploy.sh` |
| ECS 上 python3.11 错误 | Ubuntu 20.04 默认 Python 3.8 | 已 symlink `/usr/local/bin/python3.11 -> python3` |
| 端口 80 占用 | 旧进程残留 | `pkill -f "bun run"` |

## 环境依赖 (ECS)

- Ubuntu 20.04 (系统默认)
- Bun 1.3.14 (`/usr/local/bin/bun`)
- Python 3.8 + pymupdf + pillow (3.11 symlinked)
- Tesseract OCR (中/英文)
- Git

## 文件结构

```
~/insurance-ppt-v3/
├── VERSION.txt          # 版本元数据
├── CHANGELOG_V3.md      # 变更日志
├── DEPLOYMENT.md        # 本文件
├── README.md
├── package.json         # Bun 项目配置
├── bun.lock             # 依赖锁定
├── tsconfig.json
├── src/                 # TypeScript 源码
├── scripts/             # 管理脚本
│   ├── start.sh         # Mac 本地启动 (备用)
│   ├── stop.sh
│   ├── status.sh
│   ├── restart.sh
│   ├── ecs-deploy.sh    # 部署到 ECS
│   ├── ecs-status.sh    # ECS 状态检查
│   ├── ecs-restart.sh   # ECS 上重启服务
│   ├── ecs-rsync.sh     # 单独 rsync (无重启)
│   └── ... (extractor scripts)
├── public/              # 静态资源
├── data/                # 公司知识库
├── config/              # 配置
├── docs/                # 文档
├── logs/                # Mac 本地日志
└── node_modules/        # 依赖

ECS /opt/insurance-ppt/
├── 镜像 Mac 的所有源代码
├── logs/server.log      # 运行时日志
├── logs/server.pid      # 进程 ID
└── .env                 # LLM API keys (600 权限)
```

## 部署流程 (新代码上线)

```bash
# 1. Mac 上修改代码
cd ~/insurance-ppt-v3
# ... edit files ...

# 2. 部署 (rsync + 重启)
bash scripts/ecs-deploy.sh

# 3. 验证
bash scripts/ecs-status.sh
curl -I http://ppt.gllpsce.cn
```

**耗时**: ~30 秒 (取决于代码量)
**回滚**: Git checkout 旧版本 + 重新部署
