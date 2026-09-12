# HX Rates API

内部 FastAPI 服务, 包装 `db/scripts/lookup_commission.py`, 提供 HK 佣金费率查询.

## Endpoints

```
GET  /healthz                 健康检查 (DB 行数)
POST /preview                 代理人视图: 只返 total_usd + 积分
POST /lookup                  管理员视图: 完整佣金明细
GET  /products?company=&level=L2&investor=npi
```

## 部署

由根目录 `docker-compose.yml` 编排, 跟 insurance-ppt / training-backend 同网络.

```bash
# 构建并启动
cd insurance-ppt-v3
docker compose up -d --build hx-rates-api

# 验证
curl -s http://localhost:5000/healthz | python3 -m json.tool
```

## 设计

- **权限分层**: 代理人调 `/preview` 看不到 y1/y2/add, 管理员调 `/lookup` 看完整明细
- **单例 CommissionLookup**: 复用 SQLite 连接, 内部锁保证线程安全
- **数据日期 `as_of`**: 默认今天, 可指定历史日期查归档版本 (Phase 3 历史切换功能)

## 文件

- `app.py` — FastAPI 应用
- `requirements.txt` — Python 依赖
- `Dockerfile` — 镜像构建