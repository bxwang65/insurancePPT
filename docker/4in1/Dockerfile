# 4IN1 H5 开发环境 (松石菘蓝工具箱)
# 与 insurance-ppt 同 docker-compose 网络, 4IN1 通过浏览器 iframe 加载 insurance-ppt
#
# Build: 在 insurance-ppt-v3 目录下: docker compose build 4in1
# Run:   docker compose up -d 4in1
#
# 源码路径: /Users/soldier/Desktop/AI insurance Backup/pages/my/training-system/uni-app/h5-app

# 必须 linux/amd64 (匹配 ECS), 否则 esbuild 二进制与运行时架构不一致
FROM --platform=linux/amd64 node:20

WORKDIR /app

# 清掉 Mac 上 VPN 代理 (127.0.0.1:7890 在容器内不可达, npm install 会卡住)
ENV HTTP_PROXY="" HTTPS_PROXY="" http_proxy="" https_proxy="" \
    NO_PROXY="*" no_proxy="*" \
    npm_config_strict_ssl=false

# 先装依赖 (利用 Docker 层缓存)
# 关键: 用 env -i 隔离 env 后台污染, 然后 unset 代理, 再跑 npm install
# 不这么做的话 docker compose 会把宿主 shell 的 HTTP_PROXY 带进 RUN 步骤
COPY package.json package-lock.json* ./
RUN /bin/sh -c "unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy; \
    npm install --no-audit --no-fund --include=optional"

# 其余源码通过 docker-compose bind-mount (热重载)
# 这里 COPY 仅用于首次 build 时有兜底
COPY . .

EXPOSE 8080

# Vite dev server 必须监听 0.0.0.0 才能从容器外访问
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8080"]