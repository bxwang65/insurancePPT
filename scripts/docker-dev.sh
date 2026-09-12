#!/bin/bash
# Docker 开发环境一键启动
# 用法:
#   bash scripts/docker-dev.sh           # 启动 (后台)
#   bash scripts/docker-dev.sh logs      # 跟踪日志
#   bash scripts/docker-dev.sh stop      # 停止
#   bash scripts/docker-dev.sh rebuild   # 重建镜像
#   bash scripts/docker-dev.sh test      # 跑 14 产品 ECS 对照测试
set -e

cd "$(dirname "$0")/.."

# 检查 .env
if [ ! -f .env ]; then
  echo "✗ .env 不存在, 请先跑: bash scripts/sync-env.sh"
  exit 1
fi

case "${1:-up}" in
  up)
    docker compose up -d
    sleep 2
    curl -s http://localhost:3000/api/health
    echo ""
    echo "✓ Docker 已在 http://localhost:3000 启动"
    echo "  日志: bash scripts/docker-dev.sh logs"
    echo "  停止: bash scripts/docker-dev.sh stop"
    ;;
  logs)
    docker compose logs -f
    ;;
  stop)
    docker compose down
    echo "✓ 已停止"
    ;;
  rebuild)
    docker compose build --no-cache
    docker compose up -d
    ;;
  test)
    echo "=== 测试 14 个产品在 Docker (port 3000) ==="
    ECS_BASE=http://localhost:3000 python3.11 /tmp/test_ecs_products.py
    ;;
  *)
    echo "用法: $0 {up|logs|stop|rebuild|test}"
    exit 1
    ;;
esac