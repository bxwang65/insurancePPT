# ECS 完整部署手册 (V2 · 黄金备份版)

> 最后更新: 2026-07-29 · 作者: boxie wong + claude
> 适用版本: insurance-ppt-v3 + 4in1 (Vue3) + insurance-deck (Python)
> 目标读者: 在新 ECS 上从零开始部署, 不依赖历史经验

---

## 0. 一句话总结

新 ECS 拿到 IP 后, 把 `golden-backup-YYYY-MM-DD.tar.gz` 解包到 `/opt`, 跑 `bash /opt/insurance-ppt-v3/setup-new-ecs.sh`, 改 DNS 解析, 等 5 分钟就能用。

> ⚠️ **必做第一步 (阶段 4.5)**: 启用 GCS 公桶下载. 不做的话计划书下载要 30s - 2 分钟, 做了之后秒下.

---

## 1. 当前 ECS 拓扑 (2026-07-28 实测)

```
用户浏览器
    ↓
hksgtools.cn (Cloudflare DNS, 代理模式 / 橙色云)
    ↓ HTTPS (CF edge 终止, 走 CF 骨干网到 ECS)
Cloudflare Tunnel (cloudflared 跑在 ECS 上, tunnel ID 4bbd5a00-752e-40d3-a74d-320d4a96e9bb)
    ↓ HTTP localhost
ECS 主机 (47.242.58.70, ecs.c9i.large, Ubuntu 20.04, HK D 区域)
    │
    ├─ :8080  → 4in1 vite dev server (npm run dev, 后台进程)
    │              └─ /api/*  → http://localhost:80 (vite proxy)
    │              └─ /h5/*   → http://localhost:80
    │              └─ /auth/* → http://localhost:80
    │              └─ /firebase-signin/* → https://identitytoolkit.googleapis.com (CF proxy strip prefix)
    │
    └─ :80    → insurance-ppt-ecs docker container (image insurance-ppt:ecs-v3.0.3)
                   ├─ Bun server (src/api/server.ts, PORT=80)
                   ├─ /opt/insurance-deck (Python 渲染模块, PYTHONPATH)
                   ├─ /usr/bin/soffice (LibreOffice, symlinked /opt/homebrew/bin/soffice)
                   └─ /usr/bin/python3.11 (从 deadsnakes ppa, symlinked /usr/local/bin/python3.11)

公网访问验证: https://hksgtools.cn/api/health
```

### 关键 ECS 元数据

| 项 | 值 | 备注 |
|---|---|---|
| **当前实例 ID** | i-j6c9hh6jylw675dyuhru | 阿里云 HK D 区域 |
| **当前公网 IP** | 47.242.58.70 | ECS 被释放后 7 天内可重绑 |
| **实例规格** | ecs.c9i.large | 2 vCPU / 4 GiB / 5 Mbps 按量 |
| **镜像** | Ubuntu 20.04 LTS | 默认 Python 3.8, 需手动装 3.11 |
| **登录用户** | root | SSH key 见 ~/.ssh/id_rsa (或新 ECS 重新生成) |
| **安全组** | 22/80/443/ICMP | 22 只对开发者 IP 开放 |
| **价格** | $0.097872/小时 | 节省计划覆盖 ~$90 |

### 当前进程清单 (部署完成后应有的)

| 进程 | 命令 | 路径 | PID 文件 |
|---|---|---|---|
| insurance-ppt | `bun run src/api/server.ts` (docker 内) | /opt/insurance-ppt | docker 管理 |
| 4in1 | `npm run dev` | /opt/4in1/src | 手动 (无 PID 文件) |
| cloudflared | `cloudflared tunnel --config /etc/cloudflared/config.yml run` | /etc/cloudflared | systemd |

### 关键目录清单 (ECS 上)

```
/opt/insurance-ppt/                  # Bun 服务器 (docker bind mount 源)
├── src/                             # TypeScript 源码
├── public/                          # 静态资源 (含 downloads/ runtime 写)
├── data/                            # firebase-service-account.json 等 (chmod 600)
├── logs/server.{log,pid}            # 运行时日志
├── node_modules/                    # bun 依赖 (named volume)
├── .env                             # LLM API keys (chmod 600)
├── package.json + bun.lock          # 依赖锁定
└── scripts/ecs-restart.sh           # ECS 上的启停脚本

/opt/insurance-deck/                 # Python 渲染模块 (PYTHONPATH)
├── insdeck/extract/                 # savings_normalizer.py 等
├── insdeck/render/pptx_renderer.py  # 渲染核心
└── (rsync 自 docker/insurance-deck/, 不要带 __pycache__)

/opt/4in1/src/                       # Vue SPA 源码 (手动 git clone 或 rsync)
├── src/                             # Vue 页面 (Ai/Calc/FinanceCalc/Login/ProposalList)
├── public/                          # plan-maker/calculator/finance/icons
├── vite.config.js                   # 代理 /api → http://localhost:80
├── .env                             # VITE_API_PROXY 等
└── node_modules/                    # npm install 后生成

/etc/cloudflared/                    # Cloudflare Tunnel 配置 (systemd 拉起)
├── config.yml                       # tunnel ID + ingress
└── <tunnel-id>.json                 # 凭证 (chmod 600)

/etc/environment                     # PYTHONPATH=/opt/insurance-deck
```

---

## 2. 新 ECS 部署全流程 (从零到能用)

### 阶段 0: 前置准备 (在 Mac 上, 5 分钟)

```bash
# 0.1 解压黄金备份
mkdir -p ~/insurance-ppt-v3-backups
cd ~/insurance-ppt-v3-backups
tar -xzf golden-backup-2026-07-28.tar.gz

# 0.2 准备新 ECS 的 SSH keypair
ssh-keygen -t ed25519 -f ~/.ssh/id_rsa_new_ecs -N "" -C "bxwang65-new-ecs"
# 公钥 ~/.ssh/id_rsa_new_ecs.pub 待上传到新 ECS 的 /root/.ssh/authorized_keys

# 0.3 上传公钥到新 ECS (用阿里云控制台的 "修改密钥对" 功能, 或临时密码登录后手动追加)
```

### 阶段 1: 创建 ECS 实例 (阿里云控制台, 10 分钟)

| 配置项 | 值 |
|---|---|
| 区域 | 中国 (香港) D 区 |
| 实例规格 | ecs.c9i.large (2 vCPU / 4 GiB) |
| 镜像 | Ubuntu 20.04 LTS 64位 |
| 公网带宽 | 按使用流量, 5 Mbps |
| 公网 IP | 分配 (记下来: `<NEW_ECS_IP>`) |
| 安全组 | 新建: 22 (SSH), 80 (HTTP), 443 (HTTPS), ICMP (Ping) |
| 密钥对 | 上传 0.2 步骤的公钥 |
| 实例名 | `insurance-ppt-v3-new` |

### 阶段 2: 系统初始化 (在 Mac 上 SSH 进新 ECS, 5 分钟)

```bash
# 2.1 SSH 进 ECS
ssh -i ~/.ssh/id_rsa_new_ecs root@<NEW_ECS_IP>

# 2.2 系统更新 + 基础工具
apt-get update && apt-get upgrade -y
apt-get install -y curl wget git vim htop net-tools unzip

# 2.3 安装 Docker (用于跑 insurance-ppt 容器)
curl -fsSL https://get.docker.com | bash
systemctl enable docker && systemctl start docker
docker --version  # 应显示 24+ 版本

# 2.4 安装 Bun 1.3.14 (与 Dockerfile 一致, 不要装最新版)
curl -fsSL https://bun.sh/install | bash
mv /root/.bun/bin/bun /usr/local/bin/bun
mv /root/.bun/bin/bunx /usr/local/bin/bunx 2>/dev/null || true
bun --version  # 应显示 1.3.14

# 2.5 安装 Python 3.11 (从 deadsnakes ppa, ECS 默认 3.8 不够)
apt-get install -y software-properties-common
add-apt-repository -y ppa:deadsnakes/ppa
apt-get update
apt-get install -y python3.11 python3.11-venv python3.11-dev
ln -sf /usr/bin/python3.11 /usr/local/bin/python3.11  # 双保险
curl -fsSL https://bootstrap.pypa.io/get-pip.py | python3.11

# 2.6 安装 LibreOffice (PPTX → PDF 预览)
DEBIAN_FRONTEND=noninteractive apt-get install -y libreoffice-core libreoffice-impress
mkdir -p /opt/homebrew/bin
ln -sf /usr/bin/soffice /opt/homebrew/bin/soffice
soffice --version

# 2.7 安装 Tesseract OCR (中英繁简, 兜底用)
apt-get install -y tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-chi-tra

# 2.8 Python 依赖 (与 Dockerfile 一致)
python3.11 -m pip install --no-cache-dir \
  "pdfplumber>=0.10.0" \
  "pillow>=9.0.0" \
  "PyMuPDF>=1.24.0" \
  "pypdfium2>=5.0.0" \
  "pdfminer.six>=20221105" \
  "python-pptx>=0.6.21" \
  "lxml"

# 2.9 永久 PYTHONPATH
echo 'PYTHONPATH=/opt/insurance-deck' >> /etc/environment

# 2.10 退出 ECS, 后面在 Mac 上一键部署
exit
```

### 阶段 3: 上传黄金备份并解包 (在 Mac 上, 2 分钟)

```bash
# 3.1 上传备份包到新 ECS
scp -i ~/.ssh/id_rsa_new_ecs \
  ~/insurance-ppt-v3-backups/golden-backup-2026-07-28.tar.gz \
  root@<NEW_ECS_IP>:/tmp/

# 3.2 SSH 进 ECS 解包
ssh -i ~/.ssh/id_rsa_new_ecs root@<NEW_ECS_IP> "bash -s" << 'REMOTE'
set -e
cd /opt

# 解包到 /opt, 会得到 /opt/insurance-ppt, /opt/insurance-deck, /opt/4in1 等目录
tar -xzf /tmp/golden-backup-2026-07-28.tar.gz

# .env 权限锁定 (备份里是 600, 但保险起见再锁一次)
chmod 600 /opt/insurance-ppt/.env 2>/dev/null || echo "WARN: .env not found in backup"
chmod 600 /opt/insurance-ppt/data/firebase-service-account.json 2>/dev/null || echo "WARN: firebase-sa not in backup"

# data/ + public/downloads/ 必须可写 (Bun runtime 写 users.json / pptx)
chmod -R a+w /opt/insurance-ppt/data /opt/insurance-ppt/public/downloads 2>/dev/null

# 清 pyc (避免本地 pyc 覆盖新 py)
find /opt/insurance-deck -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null
find /opt/insurance-deck -name "*.pyc" -delete 2>/dev/null

# 验证 insurance-deck 可 import
PYTHONPATH=/opt/insurance-deck python3.11 -c "
from insdeck.extract.savings_normalizer import calc_irr
r = calc_irr(10, 660340, 500000, 5, 'USD')
print(f'OK: calc_irr(10, 660340, 500000, 5, USD) = {r*100:.2f}%')
if abs(r*100 - 3.52) > 0.05:
  raise SystemExit('MISMATCH: 期望 3.52%, 实际 ' + str(r*100))
"

# 4in1 npm install
cd /opt/4in1/src
npm install --omit=dev 2>&1 | tail -5

# insurance-ppt npm install (用 frozen lockfile)
cd /opt/insurance-ppt
bun install --frozen-lockfile 2>&1 | tail -3

echo "=== 解包完成, 所有依赖就绪 ==="
REMOTE
```

### 阶段 4: 启动 insurance-ppt Docker (在 ECS 上, 3 分钟)

```bash
ssh -i ~/.ssh/id_rsa_new_ecs root@<NEW_ECS_IP>

cd /opt/insurance-ppt

# 4.1 构建镜像 (ECS 镜像 tag 是 ecs-v3.0.3, 与 Mac 区分)
docker buildx build --platform linux/amd64 \
  -t insurance-ppt:ecs-v3.0.3 \
  -f Dockerfile .

# 4.2 启动容器 (用 docker-compose.ecs.yml, 与 Mac 容器名不冲突)
docker compose -f docker-compose.ecs.yml up -d

# 4.3 验证容器运行
docker ps | grep insurance-ppt-ecs
# 应显示 Up + 端口 80->80

# 4.4 健康检查
sleep 5
curl -s http://localhost:80/api/health
# 应返回 {"status":"ok",...} 或类似
```

### 阶段 4.5: 启用 GCS 公桶下载 (解决 1-2 分钟下载慢) ⭐ 关键

> **为什么要做**: 当前 `/api/download` 走 HMAC 本地签名 + Bun 流式 + CF Tunnel, 10MB 计划书实际下载 30 秒 - 2 分钟, 隧道吞吐瓶颈. 改为生成完 PPTX 后直接上传 GCS 公桶 `gll-insurance-data-hk`, 下载走 `storage.googleapis.com` 直连 (CF 骨干网 + 公开桶), **秒下**.

#### 4.5.1 复制 service account 到 ECS (Mac 上)

```bash
# 1. service account JSON 已在保险柜 env/insurance-ppt.env 备份目录里
#    如果没有, 从旧 ECS scp:
scp -i ~/.ssh/id_rsa_old_ecs root@47.242.58.70:/opt/insurance-ppt/data/firebase-service-account.json \
   /tmp/firebase-sa.json

# 如果还想用 GCS service account (同一份即可, 多用途), 也复制一份:
#   pdfdownload@insurance-ai-485105.iam.gserviceaccount.com
#   在保险柜 env/insurance-ppt.env 同目录应该有 .sa-gcs.json

# 2. 上传到新 ECS
scp -i ~/.ssh/id_rsa_new_ecs /tmp/firebase-sa.json root@<NEW_ECS_IP>:/opt/insurance-ppt/data/
ssh -i ~/.ssh/id_rsa_new_ecs root@<NEW_ECS_IP> "chmod 600 /opt/insurance-ppt/data/firebase-sa.json"
```

#### 4.5.2 修改 server.ts (Mac 上, 然后 rsync)

打开 `src/api/server.ts`, 两处改动:

**改动 1: 顶部加 GCS import (紧挨 firebase-admin import)**

```ts
import { Storage } from "@google-cloud/storage";
const gcsStorage = new Storage();  // 默认用 GOOGLE_APPLICATION_CREDENTIALS env
```

**改动 2: 修改 `signedDownloadUrl()` 函数 (server.ts:410)**

```ts
// 原版: 返回 HMAC 签名本地路径, 浏览器走 /downloads/* 经 Bun + 隧道流回
// 改后: 走 GCS 公桶直连, 浏览器秒下
const GCS_BUCKET = "gll-insurance-data-hk";  // 公读
const GCS_PLAN_PREFIX = "plans";

function signedDownloadUrl(relativePath: string): string {
  // 提取 basename
  const basename = relativePath.split("/").pop() || relativePath;
  // 直接返回 GCS 公桶 URL, 不签名 (桶已设 allUsers:objectViewer)
  return `https://storage.googleapis.com/${GCS_BUCKET}/${GCS_PLAN_PREFIX}/${encodeURIComponent(basename)}`;
}
```

#### 4.5.3 修改生成 PPTX 的代码段, 生成完上传 GCS

定位 `src/api/server.ts` 中所有 `pptPath` / `pptxPath` 写入位置 (在 `setDoc` / 文件落盘之后), 加一段:

```ts
// 上传到 GCS 公桶, 触发 cloud CDN 缓存, 客户端直接 GET 即可
try {
  await gcsStorage.bucket(GCS_BUCKET).upload(localPptPath, {
    destination: `${GCS_PLAN_PREFIX}/${basename(pptxPath)}`,
    metadata: { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
    resumable: false,
  });
  console.log(`[gcs] uploaded ${basename(pptxPath)} → ${GCS_BUCKET}`);
} catch (e) {
  console.error(`[gcs] upload failed (non-fatal, fallback to local): ${e}`);
}
```

⚠️ 三个落盘点都要加 (server.ts 里 pptx 写盘的所有路径, 搜 `writeFile` + `ppt`):
- 生成综合方案后 (~line 580)
- 重新生成后 (~line 1150)
- 模板克隆后 (~line 1910)

#### 4.5.4 加 env 变量到 docker-compose.ecs.yml

```yaml
environment:
  # GCS service account 路径 (容器内)
  - GOOGLE_APPLICATION_CREDENTIALS=/opt/insurance-ppt/data/firebase-sa.json
volumes:
  # 把 service account 注入容器
  - ./data/firebase-sa.json:/opt/insurance-ppt/data/firebase-sa.json:ro
```

#### 4.5.5 部署 + 验证 (Mac 上)

```bash
# 1. rsync 代码 + 重启
bash scripts/ecs-deploy.sh

# 2. 等计划书生成一次, 看 GCS 上传日志
ssh -i ~/.ssh/id_rsa_new_ecs root@<NEW_ECS_IP> \
  "docker logs insurance-ppt-ecs --tail 30 | grep gcs"
# 应看到 [gcs] uploaded xxx.pptx → gll-insurance-data-hk

# 3. 直接 curl 下载, 验证秒下
curl -o /tmp/test.pptx -w "HTTP %{http_code}, time=%{time_total}s, size=%{size_download}\n" --max-time 30 \
  "https://storage.googleapis.com/gll-insurance-data-hk/plans/<basename>.pptx"
# 应 1-3 秒, 与隧道无关

# 4. 浏览器实际下载测试 (用户在 plan-maker 跑一次完整流程)
```

#### 4.5.6 (可选) 老的本地 HMAC 路径保留作 fallback

不要删 `signedDownloadUrl` 原 HMAC 实现. GCS 上传失败时 (桶权限/网络抖动) 仍走本地路径, **不要让一个改动把生产整坏**. 上面的 try/catch 就是这个意思.

### 阶段 5: 启动 4in1 (手动后台, 1 分钟)

```bash
# 仍在 ECS 上
cd /opt/4in1/src

# 5.1 检查 .env 是否在备份里
cat .env | grep VITE_API_PROXY
# 应是 http://localhost:80 (ECS 上 4in1 与 insurance-ppt 在同主机, 直接 localhost)

# 5.2 启动 4in1 (用 nohup, 写 PID 文件方便后续管理)
mkdir -p /opt/4in1/logs
nohup npm run dev > /opt/4in1/logs/4in1.log 2>&1 &
echo $! > /opt/4in1/logs/4in1.pid
disown

# 5.3 验证 4in1 起来
sleep 8
curl -s -o /dev/null -w "4in1: HTTP %{http_code}\n" http://localhost:8080/
cat /opt/4in1/logs/4in1.log | tail -10
# 应显示 vite ready, 监听 0.0.0.0:8080
```

### 阶段 6: 配置 cloudflared (systemd, 5 分钟)

> ⚠️ 这一步需要从**旧 ECS** 复制 `/etc/cloudflared/` 整个目录 (含 tunnel 凭证 JSON), 或者在 Cloudflare Dashboard 重新建一个 tunnel。

```bash
# 6.1 安装 cloudflared (ECS 上)
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i cloudflared-linux-amd64.deb
cloudflared --version

# 6.2 从旧 ECS 复制配置 (假设旧 ECS 还活着, IP 是 47.242.58.70)
# 用旧 ECS 的 ssh key (在新 ECS 上临时添加)
scp -i ~/.ssh/id_rsa_old_ecs root@47.242.58.70:/etc/cloudflared/config.yml /etc/cloudflared/
scp -i ~/.ssh/id_rsa_old_ecs root@47.242.58.70:/etc/cloudflared/4bbd5a00-752e-40d3-a74d-320d4a96e9bb.json /etc/cloudflared/
chmod 600 /etc/cloudflared/4bbd5a00-*.json

# 6.3 验证 config.yml 指向 localhost:8080 (4in1)
cat /etc/cloudflared/config.yml
# 应有 ingress: - hostname: hksgtools.cn / service: http://localhost:8080

# 6.4 注册 systemd 服务
cloudflared service install
systemctl enable cloudflared
systemctl start cloudflared
systemctl status cloudflared
# 应显示 active (running)

# 6.5 验证隧道连通 (在 Mac 上)
curl -s -o /dev/null -w "hksgtools.cn: HTTP %{http_code}\n" --max-time 15 https://hksgtools.cn/
# 应返回 200 (走的还是 CF 旧 IP, 但 ECS 隧道连通了才会响应)
```

> 如果旧 ECS 已经释放拿不到凭证: 在 Cloudflare Dashboard → Zero Trust → Networks → Tunnels → 重新建一个 tunnel, 把新生成的 token 写到 `/etc/cloudflared/<new-id>.json`, config.yml 里改 `tunnel:` 字段。

### 阶段 7: DNS 切换 (Cloudflare Dashboard, 2 分钟)

> DNS A 记录之前已经指向旧 ECS IP 47.242.58.70。**只改 IP, 不改其他字段** (代理模式/橙色云保持打开)。

```
hksgtools.cn     A    <NEW_ECS_IP>    代理 (橙色云) ✅ 保持
```

等 DNS 传播 (一般 30 秒, 最长 5 分钟)。

### 阶段 8: 端到端验证 (在 Mac 上)

```bash
# 8.1 公网访问
curl -s -o /dev/null -w "hksgtools.cn: HTTP %{http_code}, time=%{time_total}s\n" \
  --max-time 15 https://hksgtools.cn/

# 8.2 健康检查
curl -s https://hksgtools.cn/api/health | head -5

# 8.3 4 个 tab 都能开 (AI 智库 / 定制计划书 / 融资单计算器 / 预缴计算器)
# 浏览器打开 https://hksgtools.cn, 登录后逐个 tab 测

# 8.4 跑一遍核心功能 (跟旧 ECS 对比)
# - AI 智库问个保险问题, 应该秒回 (走 minimax 或 deepseek)
# - 定制计划书上传 PDF, 应该能渲染
# - 预缴计算器选个产品算 IRR
# - 融资单计算器填个 ROI

# 8.5 ECS 日志最后看一眼
ssh -i ~/.ssh/id_rsa_new_ecs root@<NEW_ECS_IP> \
  "docker logs insurance-ppt-ecs --tail 20 && echo '---' && tail -20 /opt/4in1/logs/4in1.log"
```

---

## 3. 日常运维

### 代码更新 (改完本地推 ECS)

```bash
cd /Users/soldier/insurance-ppt-v3
bash scripts/ecs-deploy.sh   # Mac 上一键
# 内部流程: ssh → rsync → ecs-restart.sh → 健康检查
```

### 重启服务

```bash
# insurance-ppt
ssh root@<NEW_ECS_IP> "docker restart insurance-ppt-ecs"

# 4in1
ssh root@<NEW_ECS_IP> "kill \$(cat /opt/4in1/logs/4in1.pid) && \
  cd /opt/4in1/src && nohup npm run dev > /opt/4in1/logs/4in1.log 2>&1 & \
  echo \$! > /opt/4in1/logs/4in1.pid"

# cloudflared
ssh root@<NEW_ECS_IP> "systemctl restart cloudflared"
```

### 备份 ECS (黄金备份之前手动备份)

```bash
cd /Users/soldier/insurance-ppt-v3
bash scripts/ecs-backup.sh   # 默认时间戳 tag
# 输出 ~/insurance-ppt-v3-backups/ecs-YYYYMMDD-HHMMSS.tar.gz
```

---

## 4. 19 个已知坑 (按出现频率排序)

| # | 坑 | 症状 | 解决方案 |
|---|---|---|---|
| 1 | **OpenSSH KEX 卡死** | `ssh root@ECS` 卡在 KEXINIT, 无任何输出 | 强制指定 KexAlgorithms + HostKeyAlgorithms (ecs-deploy.sh 已写死) |
| 2 | **__pycache__ 残留** | 改 Python 文件不生效, 旧 pyc 覆盖新 py | `find /opt/insurance-deck -name __pycache__ -exec rm -rf {} +` |
| 3 | **PYTHONPATH 缺失** | server 启动后 `import insdeck` 失败, 渲染 100% 失败 | 写入 `/etc/environment` 的 `PYTHONPATH=/opt/insurance-deck` |
| 4 | **python3.11 未安装** | Ubuntu 20.04 默认 3.8, server 启动报 ModuleNotFoundError | `add-apt-repository ppa:deadsnakes/ppa` + `apt install python3.11` + symlink `/usr/local/bin/python3.11` |
| 5 | **soffice 缺失** | PPTX → PDF 预览 404, ECS 上 LibreOffice 没装 | `apt install libreoffice-core libreoffice-impress` + symlink `/opt/homebrew/bin/soffice` |
| 6 | **Bun 版本错** | 本地 1.3.11 vs Dockerfile 锁 1.3.14, lockfile 不匹配 | 装 1.3.14 到 `/usr/local/bin/bun` |
| 7 | **data/ 不可写** | runtime 写 users.json 失败, 静默 500 | `chmod -R a+w /opt/insurance-ppt/data /opt/insurance-ppt/public/downloads` |
| 8 | **public/downloads 不可写** | 生成 pptx 文件 0 字节 / 404 | 同上 |
| 9 | **firebase-service-account.json 缺失** | /auth/firebase-login 返回 503 | 从旧 ECS scp 过来, chmod 600 |
| 10 | **deploy-ecs.sh:61 端口错** | health check 走 `localhost:3000`, ECS 上无 3000 | 已修本地脚本, rsync 会覆盖 |
| 11 | **浏览器缓存 stale JS** | 改 result-summary.js 后用户看到旧版 | ES module 走 ETag, server.ts 加 Cache-Control: HTML=must-revalidate |
| 12 | **Vite 默认 VITE_API_PROXY=insurance-ppt:80** | ECS 上 4in1 systemd 跑 npm, 解析不到 docker DNS, /api 全失败 | .env 显式 `VITE_API_PROXY=http://localhost:80` |
| 13 | **/plan-maker/* 路由 404** | 老 JS 触发"暂未解析成功" toast, SPA 初始化失败 | vite 直接 serve `/opt/4in1/src/public/plan-maker/`, ecs-deploy.sh 不同步 (已是 baked) |
| 14 | **缩略图 broken** | Chrome HTTP cache 缓存 404 (cf-cache-status:MISS 但浏览器 cache 命中) | server.ts previewUrls 加 `?v=Date.now()` |
| 15 | **/downloads 404 (生产)** | CF token 托管 ingress 路由到 vite:8080, vite 没代理 /downloads | vite proxy 加 `/downloads` → `http://insurance-ppt:80` |
| 16 | **bun serve() HEAD 404** | CF revalidate 用 HEAD method, 只匹配 GET → 缓存 4h → "下载全坏" | bun serve 加 `\|\| method === 'HEAD'` |
| 17 | **容器 baked HTTP_PROXY** | bun install 走 127.0.0.1:7890 失败 (Mac 代理, 容器内不可达) | docker-compose.ecs.yml 显式 `HTTP_PROXY=` `HTTPS_PROXY=` |
| 18 | **单文件 mount 偶发 fallback** | 4in1-dev 改 index.html/vite.config.js 后, 容器内还是旧版 | mount 后必 `docker restart 4in1-dev` |
| 19 | **absolute paths in /plan-maker/index.html** | app.js 404, SPA 不能初始化, "无法上传" | 相对路径 `./assets/...` 而非 `/assets/...` |
| 20 | **计划书下载 1-2 分钟** | 2026-07-30 诊断: `/downloads/*` 返 `Cache-Control: no-store`, 强制每次走 CF Tunnel 跨太平洋 (LA edge → HK ECS) 被限流 50KB/s, 1.9MB PPTX 实测 40s. | server.ts 改 `public, max-age=3600`. CF edge 缓存文件, 第二次起 HIT 边缘节点 ~2s (HIT 实测 cf-cache-status: HIT, 下载 1-3s). 兜底方案仍是阶段 4.5 GCS 公桶直连. |

---

## 5. 关键脚本速查

### Mac 端 (在 /Users/soldier/insurance-ppt-v3/scripts/)

| 脚本 | 作用 | 何时跑 |
|---|---|---|
| `ecs-deploy.sh` | rsync + 重启, 一键 | 改完代码 |
| `ecs-preflight.sh --check` | 仅检查, 不动文件 | 部署前看一眼 |
| `ecs-preflight.sh --apply` | 检查 + 自动修复 | ECS 有水土不服 |
| `ecs-preflight.sh --deploy` | 检查 + 修复 + 部署 | 等同 deploy.sh |
| `ecs-status.sh` | 看 ECS 进程 / 端口 / 资源 | 排障 |
| `ecs-restart.sh` | ECS 上重启 Bun 服务 | 远程手动重启 |
| `ecs-backup.sh` | ECS 打 tar 包回 Mac | 改大版本前 |
| `ecs-tail.sh` | tail ECS 日志 | 排障 |
| `ecs-rsync.sh` | 仅同步, 不重启 | 测试代码 |

### ECS 端 (在 /opt/insurance-ppt/scripts/)

| 脚本 | 作用 |
|---|---|
| `ecs-restart.sh` | 停旧 Bun, 起新 Bun, 写 PID 文件 |

---

## 6. 紧急回滚 (3 步)

```bash
# 1. SSH 进 ECS, 停服务, 清目录
ssh -i ~/.ssh/id_rsa_new_ecs root@<NEW_ECS_IP> \
  "docker stop insurance-ppt-ecs && \
   kill \$(cat /opt/4in1/logs/4in1.pid 2>/dev/null) 2>/dev/null; \
   rm -rf /opt/insurance-ppt /opt/insurance-deck /opt/4in1"

# 2. 从 Mac 传黄金备份包
scp -i ~/.ssh/id_rsa_new_ecs \
  ~/insurance-ppt-v3-backups/golden-backup-2026-07-28.tar.gz \
  root@<NEW_ECS_IP>:/tmp/

# 3. 解包 + 重启 (等同阶段 3 + 阶段 4 + 阶段 5)
ssh -i ~/.ssh/id_rsa_new_ecs root@<NEW_ECS_IP> \
  "cd /opt && tar -xzf /tmp/golden-backup-2026-07-28.tar.gz && \
   cd /opt/insurance-ppt && docker compose -f docker-compose.ecs.yml up -d && \
   cd /opt/4in1/src && nohup npm run dev > /opt/4in1/logs/4in1.log 2>&1 &"
```

---

## 7. 联系人 / 资源

- **域名注册商**: Cloudflare Registrar (`hksgtools.cn`)
- **DNS**: Cloudflare DNS (hksgtools.cn zone)
- **隧道**: Cloudflare Zero Trust → Networks → Tunnels → `4bbd5a00-...`
- **LLM providers**: minimax (主力, 视觉模型可解析图片型 PDF), deepseek (fallback), agnes (兜底); 2026-07-30 起 Kimi API 已删除 (之前配额耗尽踢出链)
- **对象存储**: GCS bucket `gll-insurance-data-hk` (公开读)
- **Auth**: Firebase Auth + Firestore
- **代码托管**: github.com/bxwang65/insurancePPT (主), bxwang65/songshi-frontend-prod, bxwang65/songshi-backend-prod, bxwang65/hk-savings-calculator

---

## 8. 版本控制

| 组件 | 当前版本 | 升级路径 |
|---|---|---|
| Bun | 1.3.14 | 改 Dockerfile `bun --version`, 改 ECS `/usr/local/bin/bun` |
| Node | 20.x | npm 装, ECS 不用 |
| Python | 3.11 | deadsnakes ppa |
| LibreOffice | 系统包 | `apt upgrade` |
| Tesseract | 5.x | `apt upgrade` |
| Ubuntu | 20.04 | 建议保持, Dockerfile 也是 22.04 但部署是 20.04 |
| insurance-ppt | v3.0.3 | docker image tag `insurance-ppt:ecs-v3.0.3` |
| 4in1 | 1.0.0 | package.json `version` |
| insurance-deck | 与主仓同步 | rsync 自 `docker/insurance-deck/` |