# 2026-08-12: 融合以琳培训系统 backend (NestJS + Prisma + SQLite)
# Build context: ./docker/training (含 src/ 和 admin-web/ 都拷过去虽然此镜像只用 src/)
# 持久化: 容器内 /app/prisma (dev.db) 与 /app/uploads 通过 bind mount 落地到
#   ./docker/training/data/{prisma,uploads}/

FROM node:20-bookworm AS builder

WORKDIR /app

# Prisma 需要在 schema 所在目录生成 client (相对于 prisma/, 但实际我们是用 src/prisma/)
# 这里用相对路径, Prisma 默认从 schema 所在目录的父目录读 .env / DATABASE_URL
COPY src/package*.json ./
COPY src/prisma ./prisma

# 先装 deps + 生成 prisma client (避免后续每次改代码都重新生成)
RUN npm ci --no-audit --no-fund
RUN npx prisma generate

# 拷源码 + build
COPY src/tsconfig.json ./
COPY src/nest-cli.json* ./
COPY src/src ./src

RUN npm run build

# ---- Runtime ----
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

# 装 runtime 必要的 native deps (bcrypt)
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends python3 make g++ wget \
    && rm -rf /var/lib/apt/lists/*

# 拷生产 deps (production-only, 跳过 nest cli)
COPY src/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 拷编译产物 + Prisma (migrations + schema, 不含 dev.db 因为已 bind mount)
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# 容器内缺 SQLite client 时 Prisma 自己带的不够, 安装
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# uploads 落盘目录
RUN mkdir -p /app/uploads

EXPOSE 3000

# 启动顺序: migrate deploy → seed (idempotent, 已有库会跳过) → 业务服务
# 注意: 用编译后的 seed.js 而非 ts-node (runtime 镜像已 --omit=dev, 没装 ts-node)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seeds/seed.js && node dist/main.js"]
