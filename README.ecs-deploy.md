# ECS Docker 化部署手册 (2026-07-24)

## 架构概览

ECS (47.242.58.70) 现在跟 Mac docker 完全镜像：
- **Bun 服务** → Docker 容器 (`insurance-ppt-ecs`)，image `insurance-ppt:ecs-v3.0.3`
- **4in1 H5 (8080)** → 保留原 systemd `4in1-dev.service`（不重建，避开 Mac 路径死链接）
- **Cloudflare Tunnel** → 保留原 systemd `cloudflared.service`
- **保险机制**: systemd `insurance-ppt-ecs.service` (Type=simple + Restart=always) 守护 docker compose up，Bun crash 9s 自动拉起

## 关键文件

| 文件 | 位置 | 说明 |
|---|---|---|
| `docker-compose.ecs.yml` | Mac + ECS `/opt/insurance-ppt/` | ECS 专用 compose (Mac docker-compose.yml 不动) |
| `Dockerfile` | Mac + ECS | ubuntu:22.04 + python3.11 + Bun + LibreOffice + PyMuPDF |
| `/etc/systemd/system/insurance-ppt-ecs.service` | ECS | systemd 守护 docker compose up |
| `/etc/systemd/system/cloudflared.service` | ECS | CF Tunnel (hksgtools.cn → localhost:80) |
| `/etc/systemd/system/4in1-dev.service` | ECS | 4in1 H5 vite dev (8080) |
| `/etc/cloudflared/config.yml` | ECS | tunnel 4bbd5a00... ingress hksgtools.cn→80 |

## 容器内 vs 主机软件对照（已验证）

| 软件 | Mac Dockerfile (容器) | ECS 主机 | 备注 |
|---|---|---|---|
| Ubuntu | 22.04 | 20.04 | 主机版本略旧但 docker 容器内是 22.04 |
| Python | 3.11.15 (deadsnakes 真 3.11) | 3.11 = symlink→3.8.10 | docker 化后修了之前的 symlink bug |
| Bun | 1.3.14 | (不直接用, 容器内 1.3.14) | docker 化后统一 |
| LibreOffice | 7.3.7.2 | 6.4.7.2 (主机) | docker 化后统一 |
| PyMuPDF | 1.28.0 | (主机不直接用) | docker 化后统一 |

## 验证 (2026-07-24 已跑通)

| 验证项 | 结果 |
|---|---|
| `docker compose build` | ✅ insurance-ppt:ecs-v3.0.3 1.31GB |
| `docker compose up -d` | ✅ 容器 Up + 健康检查 starting |
| `curl localhost:80/api/health` | ✅ `{"status":"ok"}` |
| `curl https://hksgtools.cn/api/health` (公网) | ✅ `{"status":"ok"}` |
| `docker kill + wait 20s` | ✅ 自动拉起, 9s 内 healthy |
| E2E (upload → parse 202 → poll) | ✅ 1.5ms + 15s + parsed |
| Mac 8080 文件未动 | ✅ public/index.html Jul 13 时间戳 |

## 代码更新流程

### 1. Mac 端代码改动
```bash
# Mac 改 src/ public/ scripts/ package.json 等
# Mac 上 git commit + push
```

### 2. Mac 一键部署到 ECS
```bash
bash scripts/ecs-deploy.sh   # 已存在 (rsync + restart)
```

ecs-deploy.sh 内部：
- `KexAlgorithms=curve25519-sha256...` (兼容 Mac OpenSSH 10.0 ↔ Ubuntu 20.04)
- rsync src/scripts/public/config/data (排除 .env / uploads / downloads)
- ECS 上 `systemctl restart insurance-ppt-ecs` → docker compose 自动重启

### 3. 验证
```bash
curl -s https://hksgtools.cn/api/health
```

## 4in1 单独更新流程

4in1 在 ECS 是 systemd 跑的 vite dev，源码在 `/opt/4in1/src/`：

```bash
# Mac 改 4in1 源码 (在 /Users/soldier/Desktop/AI insurance Backup/.../h5-app/)
# rsync 到 ECS
rsync -avz --delete \
  -e 'ssh -o KexAlgorithms=curve25519-sha256...' \
  "/Users/soldier/Desktop/AI insurance Backup/pages/my/training-system/uni-app/h5-app/" \
  root@47.242.58.70:/opt/4in1/src/
# ECS 上重启 4in1
ssh root@47.242.58.70 'systemctl restart 4in1-dev'
```

## 故障排查

| 症状 | 排查 |
|---|---|
| `curl localhost:80/api/health` 没响应 | `docker ps` 看容器是否在跑；`systemctl status insurance-ppt-ecs` |
| Bun 死了没自动拉起 | 检查 systemd Type=simple + Restart=always 是否设置正确 |
| Mac ssh ECS reset | 用 KexAlgorithms workaround (`ssh -o KexAlgorithms=curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group14-sha1,ecdh-sha2-nistp256`) |
| 公网 (hksgtools.cn) timeout | `systemctl status cloudflared`；`tail -f /var/log/syslog \| grep cloudflared` |
| 容器内 python3.11 报 PEP 604/585 错 | docker 化后已修复 (真 3.11.15)，不用再担心 |

## ECS 重启/重置后恢复

```bash
# ECS 启动后会自动跑:
#   - cloudflared.service (CF Tunnel)
#   - 4in1-dev.service (4in1 vite dev 8080)
#   - insurance-ppt-ecs.service (docker compose up insurance-ppt 容器)

# 验证
systemctl is-active cloudflared 4in1-dev insurance-ppt-ecs
docker ps
curl http://localhost:80/api/health
```

## 备份

`/Users/soldier/insurance-ppt-ecs-backup-2026-07-24/` (Mac):
- `cloudflared-config.yml` + `cloudflared-token` + `cloudflared.service`
- `configs.tar.gz` (ECS docker/ + scripts/)
- `envs.tar.gz` (ECS .env + .env.bak.* + docker-compose.yml + Dockerfile)