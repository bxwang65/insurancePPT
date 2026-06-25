#!/bin/bash
# V3 部署到阿里云 HK ECS 脚本 (在 ECS 上跑)
# 用法: bash scripts/deploy-ecs.sh
set -e

echo "=== [1/6] 安装 Bun ==="
if ! command -v bun &> /dev/null; then
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  echo "✓ Bun installed: $(bun --version)"
else
  echo "✓ Bun already: $(bun --version)"
fi

echo ""
echo "=== [2/6] 安装 Python 依赖 ==="
if ! command -v tesseract &> /dev/null; then
  apt-get update && apt-get install -y tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-chi-tra
fi
pip3 install pymupdf pillow --quiet 2>&1 | tail -3 || echo "(pip 跳过)"

echo ""
echo "=== [3/6] 准备应用目录 ==="
APP_DIR=/opt/insurance-ppt
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# 如果代码已经 rsync 过来, 跳过; 否则从 git 拉
if [ ! -f "package.json" ]; then
  echo "⚠️  package.json 不存在, 请先 rsync 代码到 $APP_DIR"
  echo "    在 Mac 上执行:"
  echo "    rsync -avz --exclude='node_modules' --exclude='logs' --exclude='public/downloads' \\"
  echo "      /Users/soldier/insurance-ppt-v3/ root@<ECS_IP>:$APP_DIR/"
  exit 1
fi

echo ""
echo "=== [4/6] 安装 Node 依赖 ==="
bun install --production 2>&1 | tail -5

echo ""
echo "=== [5/6] 启动应用 ==="
mkdir -p logs
nohup bun run src/api/server.ts > logs/server.log 2>&1 &
NEW_PID=$!
disown $NEW_PID 2>/dev/null || true
echo "$NEW_PID" > logs/server.pid
sleep 3
if kill -0 "$NEW_PID" 2>/dev/null; then
  echo "✓ Server started, PID=$NEW_PID"
else
  echo "✗ Failed, see logs/server.log"
  tail -10 logs/server.log
  exit 1
fi

echo ""
echo "=== [6/6] 健康检查 ==="
sleep 2
curl -s -o /dev/null -w "localhost:3000 = HTTP %{http_code}\n" http://localhost:3000
echo ""
echo "=== 部署完成 ==="
echo "应用目录: $APP_DIR"
echo "日志: $APP_DIR/logs/server.log"
echo "进程: cat $APP_DIR/logs/server.pid"
echo "停止: kill \$(cat $APP_DIR/logs/server.pid)"
