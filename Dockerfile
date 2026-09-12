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
# 2026-09-12: 加 apt 重试配置 —— 构建机走本机代理时, apt 对部分包会偶发
#   `502 Bad Gateway`, 默认 0 重试导致整步 exit 100 失败. 写进 apt.conf.d 后
#   本 RUN 及后续 RUN (含 playwright install --with-deps) 都继承. 仅影响下载容错, 不改镜像内容.
RUN printf 'Acquire::Retries "10";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' > /etc/apt/apt.conf.d/99-retries \
    && apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl wget gnupg unzip \
    software-properties-common \
    libreoffice-core libreoffice-impress \
    tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-chi-tra \
    fonts-noto-cjk fonts-wqy-zenhei fonts-wqy-microhei \
    libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        python3.11 python3.11-venv python3.11-dev \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# ── 1b. fontconfig: 把 CJK 字体顶到 sans-serif/serif 链头 (防 Chromium tofu) ──
# Noto Sans CJK + WenQuanYi 装好后, 默认 sans-serif 仍是 DejaVu (无 CJK glyph).
# poster.html CSS 引用 "Noto Sans CJK SC" / "WenQuanYi Zen Hei" 时 Chromium 直接走这条链,
# 但若 CSS 写 sans-serif 或某浏览器版本忽略 CSS 链, 此 conf 兜底.
COPY docker/fontconfig-cjk-default.conf /etc/fonts/conf.d/99-cjk-default.conf
RUN fc-cache -fv 2>&1 | tail -1

# ── 2. Bun 1.3.14 (匹配 ECS) ──
RUN curl -fsSL https://bun.sh/install | bash \
    && mv /root/.bun/bin/bun /usr/local/bin/bun \
    && mv /root/.bun/bin/bunx /usr/local/bin/bunx 2>/dev/null || true \
    && bun --version

# ── 3. Python 3.11 pip + insurance-deck 依赖 (匹配 ECS) ──
# 2026-09-12: 补 jinja2 / matplotlib / playwright —— 这三项此前镜像里没有,
#   导致两条生产链路在容器内必然失败(ECS 日志实证):
#     jinja2     -> tools/long-poster/render_poster.py 海报渲染  (23 次 ModuleNotFoundError)
#     matplotlib -> scripts/generate_chart_assets.py 图表生成    (18 次 ModuleNotFoundError)
#     playwright -> 海报 HTML→PNG 截图 (需同时装 chromium 浏览器)
#   注: generate_chart_assets.py 里 _render_with_plotly 无调用点(死代码), 故不装 plotly
RUN curl -fsSL https://bootstrap.pypa.io/get-pip.py | python3.11 \
    && python3.11 -m pip install --no-cache-dir \
        "pdfplumber>=0.10.0" \
        "pillow>=9.0.0" \
        "PyMuPDF>=1.24.0" \
        "pypdfium2>=5.0.0" \
        "pdfminer.six>=20221105" \
        "python-pptx>=0.6.21" \
        "lxml" \
        "jinja2>=3.1.0" \
        "matplotlib>=3.8.0" \
        "playwright>=1.40.0" \
    && python3.11 -m playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && python3.11 -c "import jinja2, matplotlib, playwright; print('poster/chart deps OK')" \
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