# V3 部署指南 (DEPLOYMENT.md)

## 部署概览

- **本地路径**: `/Users/soldier/insurance-ppt-v3/`
- **公网域名**: https://ppt.gllpsce.cn
- **Git**: github.com/bxwang65/insurancePPT @ branch `v3-frozen` / tag `v3.0.0-frozen`
- **架构**: Bun server (localhost:3000) → Cloudflare Tunnel → 公网 HTTPS

```
┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌─────────────┐
│ 浏览器/用户  │ -> │ ppt.gllpsce.cn  │ -> │ Cloudflare Edge │ -> │ Cloudflared │
└─────────────┘    └──────────────────┘    └─────────────────┘    └──────┬──────┘
                                                                          │ QUIC/HTTP2
                                                                          ▼
                                                                  ┌───────────────┐
                                                                  │ localhost:3000│
                                                                  │  (bun server) │
                                                                  └───────────────┘
```

## 启动 / 停止 / 重启

```bash
cd ~/insurance-ppt-v3

# 启动 (nohup + setsid 后台守护, 终端关闭不影响)
bash scripts/start.sh

# 停止
bash scripts/stop.sh

# 重启
bash scripts/restart.sh

# 状态检查 (本地 + 公网)
bash scripts/status.sh
```

## 关键命令

```bash
# 查看实时日志
tail -f ~/insurance-ppt-v3/logs/server.log

# 启动 Cloudflare tunnel (如果没运行)
nohup cloudflared tunnel --no-autoupdate run 14ae1918-7d62-4a2c-b74d-bf6367449cc3 \
  > ~/insurance-ppt-v3/logs/cloudflared.log 2>&1 &

# 验证公网
curl -sI https://ppt.gllpsce.cn | head -3
```

## 为什么 nohup 不会因终端关闭而退出

1. `nohup` - 忽略 SIGHUP 信号 (终端关闭时发送的"挂断"信号)
2. `setsid` - 创建新会话, 完全脱离原 terminal session 的进程组
3. 重定向 stdin/stdout/stderr 到 logs/, 不依赖原终端文件描述符
4. Bun runtime 是常驻进程, 主循环不退出

即使关闭所有 Claude Code 终端窗口, server 进程仍由 PID 1 (launchd) 收养继续运行.

## 文件结构

```
~/insurance-ppt-v3/
├── VERSION.txt          # 版本元数据 (frozen)
├── CHANGELOG_V3.md      # 变更日志
├── DEPLOYMENT.md        # 本文件
├── README.md
├── package.json         # Bun 项目配置
├── bun.lock             # 依赖锁定
├── railway.toml         # Railway 部署配置
├── tsconfig.json
├── src/                 # TypeScript 源码 (chmod 444 冻结)
├── scripts/             # Python + Shell 脚本
│   ├── start.sh
│   ├── stop.sh
│   ├── status.sh
│   ├── restart.sh
│   └── ... (extractor scripts)
├── public/              # 静态资源 (模板, 字体)
├── data/                # 公司知识库
├── config/              # 配置
├── docs/                # 文档
├── logs/                # 运行时日志 (chmod 755 可写)
│   ├── server.log
│   └── server.pid
└── node_modules/        # 依赖 (47M, 不进 git)
```

## 更新流程 (需要用户授权)

⚠️ V3 是冻结版本. 如需修复 bug:

1. 在 `/Users/soldier/free-code/packages/insurance-ppt/` 修改并测试
2. 用户明确授权后, 重新封装:
   ```bash
   rsync -a --delete --exclude='node_modules' --exclude='logs' \
     --exclude='.cache' --exclude='outputs' --exclude='uploads' \
     --exclude='sessions' /Users/soldier/free-code/packages/insurance-ppt/ \
     ~/insurance-ppt-v3/
   cd ~/insurance-ppt-v3
   chmod -R u+w src scripts
   # ... 修改文件 ...
   chmod -R u-w src
   git add -A && git commit -m "fix: ..."
   git tag v3.0.1-frozen
   git push origin v3-frozen --tags --force
   bash scripts/restart.sh
   ```
3. 旧版本通过 git reflog 找回

## 故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| localhost:3000 FAIL | server 没启动 | `bash scripts/start.sh` |
| ppt.gllpsce.cn FAIL | tunnel 没运行 | 启动 cloudflared (命令见上) |
| ppt.gllpsce.cn 502 | tunnel 在但 server 不在 | `bash scripts/start.sh` |
| 端口被占用 | 旧实例残留 | `bash scripts/stop.sh` 后再启动 |
| Python 脚本错误 | 缺 tesseract / pymupdf | `brew install tesseract tesseract-lang` + `pip3 install pymupdf pillow` |
| .env 缺失 | 敏感配置未写入 | 从旧目录 `cp .env ~/insurance-ppt-v3/`, 或参考 `.env.example` |

## 环境依赖

- Bun >= 1.0 (`/Users/soldier/.bun/bin/bun`)
- Python 3.11 (用于 PyMuPDF OCR)
- Tesseract (Manulife 图片型 PDF OCR): `brew install tesseract tesseract-lang`
- cloudflared (`/opt/homebrew/bin/cloudflared`)
- LLM API keys (写入 `.env`, 见 `.env.example`)
