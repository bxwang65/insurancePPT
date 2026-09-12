# HX Rates API - Python FastAPI 容器
# 提供 HK 佣金费率查询 (内部使用, 由 insurance-ppt 反代)
#
# 构建:   docker build -t hx-rates-api:dev docker/hx-rates/
# 运行:   docker run --rm -p 5000:5000 -v /path/to/db:/app/db hx-rates-api:dev

FROM python:3.11-slim

# 2026-08-15: 清 Mac 代理残留 (构建期 ENV 不影响运行时, 但保险起见 unset)
ENV HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= NO_PROXY=* no_proxy=*

WORKDIR /app

# 先 copy requirements 单独一层 (利用 Docker 缓存)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制 app.py (lookup_commission.py 由 docker-compose volume 挂载 /app/db/scripts 提供,
#  这样 db/ 目录任何修改 (新 hx_rates.db / 新 PDF / 新 script) 都无需重建 image)
COPY app.py .

# 环境变量 (运行时由 docker-compose 注入更优先)
ENV HX_RATES_DB=/app/db/hx_rates.db
ENV SCRIPTS_DIR=/app/db/scripts
ENV PORT=5000
ENV LOG_LEVEL=INFO

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/healthz', timeout=3)" || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5000", "--log-level", "info"]