# Insurance-PPT-V3 Docker Image
# Mirrors ECS (Ubuntu + Python 3.11 + Bun + LibreOffice + insurance-deck)
# so local dev = production behavior.
#
# Build: docker buildx build --platform linux/amd64 -t insurance-ppt:v3.0.2 .
# Run:   docker compose up -d
#
# 注意: 默认从源码构建; 源码通过 docker-compose bind-mount 覆盖 (热重载)

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PORT=80

# ── 1. 系统依赖 (匹配 ECS: libreoffice-core + libreoffice-impress) ──
# Ubuntu 22.04 默认 Python 3.10, ECS 是 3.11. 装 3.11 从 deadsnakes (jammy 也支持).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl wget gnupg unzip \
    software-properties-common \
    libreoffice-core libreoffice-impress \
    tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-chi-tra \
    libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        python3.11 python3.11-venv python3.11-dev \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# ── 2. Bun 1.3.14 (匹配 ECS) ──
RUN curl -fsSL https://bun.sh/install | bash \
    && mv /root/.bun/bin/bun /usr/local/bin/bun \
    && mv /root/.bun/bin/bunx /usr/local/bin/bunx 2>/dev/null || true \
    && bun --version

# ── 3. Python 3.11 pip + insurance-deck 依赖 (匹配 ECS) ──
RUN curl -fsSL https://bootstrap.pypa.io/get-pip.py | python3.11 \
    && python3.11 -m pip install --no-cache-dir \
        "pdfplumber>=0.10.0" \
        "pillow>=9.0.0" \
        "PyMuPDF>=1.24.0" \
        "pypdfium2>=5.0.0" \
        "pdfminer.six>=20221105" \
        "python-pptx>=0.6.21" \
        "lxml" \
    && python3.11 --version

# ── 4. soffice symlink (匹配 ECS: /opt/homebrew/bin/soffice) ──
RUN mkdir -p /opt/homebrew/bin && ln -sf /usr/bin/soffice /opt/homebrew/bin/soffice

# ── 5. insurance-deck (Python 渲染模块) ──
COPY docker/insurance-deck/ /opt/insurance-deck/

# ── 6. 应用源码 + 依赖 (开发模式由 compose 覆盖 src/scripts) ──
WORKDIR /opt/insurance-ppt
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

# ── 7. 启动 (与 ecs-restart.sh 一致) ──
CMD ["sh", "-c", "exec bun run src/api/server.ts"]