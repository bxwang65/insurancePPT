#!/usr/bin/env python3
"""
HX Rates API - FastAPI 包装层

提供:
  GET  /healthz                      - 健康检查 (含 DB 计数)
  POST /preview                      - 代理人视图: 只返 total_usd + 积分
  POST /lookup                       - 管理员视图: 完整佣金明细
  GET  /products                     - 产品列表 (可按 company 过滤)

设计原则:
  - /preview 与 /lookup 输入相同, 输出字段不同 (代理人不要看穿点)
  - 鉴权由 insurance-ppt server.ts 处理, 本服务只对内部网络开放
  - 单例 CommissionLookup, 复用连接池
"""
import logging
import os
import sqlite3
import sys
import threading
from contextlib import asynccontextmanager
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

# 让 /app/db/scripts 中的 lookup_commission 可被 import
sys.path.insert(0, os.environ.get("SCRIPTS_DIR", "/app/db/scripts"))
from lookup_commission import CommissionLookup, CommissionBreakdown  # noqa: E402

# =============================================================
# 配置
# =============================================================
DB_PATH = os.environ.get("HX_RATES_DB", "/app/db/hx_rates.db")
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()

logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("hx-rates-api")


# =============================================================
# 工具: 从 plan 名解析"签发"截止日
# =============================================================
import re as _re

def parse_issue_deadline(plan_text: str) -> Optional[str]:
    """从 plan 名解析"签发"截止日 (业务真正关心的 issue deadline)

    PDF plan 名常见两种格式:
      A) "（於2026年7月31日前簽署并於9月30日前签发）"  → 返 "2026/9/30" (issue)
      B) "（於2026年9月30日前签署並於9月30日前签发）"   → 返 "2026/9/30"
      C) "（於2026年9月30日前签发）"                    → 返 "2026/9/30"
      D) 仅 "簽署" 无 "签发"                           → 返 None (走 DB activity_deadline)

    2026-08-16 用户反馈: 之前 DB 存的是 "签署" 日期 (7/31), 但保单要"签发"才算生效,
    显示应改为 issue deadline.
    """
    if not plan_text:
        return None
    # 优先 "签发" (issue) - 业务上才是保单生效截止
    m = _re.search(r'(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日前[簽签]发', plan_text)
    if m:
        return f"{m.group(1)}/{int(m.group(2))}/{int(m.group(3))}"
    # 简体 "X月X日前签发"
    m = _re.search(r'(\d{1,2})\s*月\s*(\d{1,2})\s*日前[签簽]发', plan_text)
    if m:
        # 没有年份, 默认当前年 (2026) — fallback 不准, 实际应从 activity_deadline 字段获取
        return f"2026/{int(m.group(1))}/{int(m.group(2))}"
    return None


# =============================================================
# 单例 (线程安全)
# =============================================================
_lock = threading.Lock()
_lookup: Optional[CommissionLookup] = None


def get_lookup() -> CommissionLookup:
    global _lookup
    if _lookup is None:
        with _lock:
            if _lookup is None:  # 二次检查
                log.info(f"初始化 CommissionLookup: {DB_PATH}")
                _lookup = CommissionLookup(DB_PATH)
    return _lookup


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时建连接 (fail fast)
    try:
        get_lookup()
        log.info("HX Rates API 启动完成")
    except Exception as e:
        log.error(f"启动失败: {e}")
        raise
    yield
    # 关闭时清理
    global _lookup
    if _lookup is not None:
        _lookup.close()
        _lookup = None


app = FastAPI(
    title="HX Rates API",
    version="1.0.0",
    description="HK 佣金费率查询服务 (内部使用, 由 insurance-ppt 反代)",
    lifespan=lifespan,
)

# CORS - 仅内网调用, 保险起见全开 (insurance-ppt 同 network, 不暴露公网)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# =============================================================
# Pydantic Models
# =============================================================
class PreviewRequest(BaseModel):
    """代理人视图请求"""
    company: str = Field(..., min_length=1, max_length=64, description="公司名")
    code: str = Field(default="", max_length=32, description="产品代码 (永M 可空)")
    term: int = Field(..., ge=1, le=20, description="缴费年期 1/2/3/5/...")
    premium: float = Field(..., gt=0, le=10_000_000, description="年缴保费 USD")
    investor: Literal["npi", "pi"] = Field(default="npi", description="客户合格投资人状态 (pi 合格 / npi 非合格)")
    as_of: Optional[str] = Field(
        default=None,
        description="数据日期 YYYY-MM-DD (默认今天, 用于查历史版本)",
    )

    @field_validator("as_of")
    @classmethod
    def validate_date(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        from datetime import datetime
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError(f"as_of 必须是 YYYY-MM-DD 格式, 收到: {v}")
        return v


class LookupRequest(PreviewRequest):
    """管理员视图请求 (在 PreviewRequest 基础上加 level + investor)"""
    level: Literal["L1", "L2", "L3"] = Field(default="L2", description="佣金级别")
    investor: Literal["npi", "pi"] = Field(default="npi", description="客户合格投资人状态 (pi 合格 / npi 非合格)")


class PreviewResponse(BaseModel):
    """代理人视图响应 - 故意只暴露积分, 隐藏 y1/y2/add 等敏感字段"""
    company: str
    code: str
    plan: str
    term: int
    level: str
    investor: str
    currency: str
    premium: float
    is_activity: bool
    activity_deadline: Optional[str]
    issue_deadline: Optional[str] = None  # 2026-08-16: 从 plan 名解析 "签发" 截止日 (业务真正关心)
    total_usd: float
    points: float  # 1 USD = 100 积分 (前端展示)


class LookupResponse(PreviewResponse):
    """管理员视图响应 - 完整明细"""
    y1_pct: float
    y2_pct: float
    y3_pct: float
    y4_pct: float
    y5_pct: float
    add_pct: float
    total_pct: float
    direct_pct: float
    indirect_pct: float
    y1_usd: float
    y2_usd: float
    y3_usd: float
    y4_usd: float
    y5_usd: float
    renew_usd: float
    add_usd: float
    direct_usd: float
    indirect_usd: float
    warnings: list[str] = []


class ProductItem(BaseModel):
    company: str
    code: str
    plan: str
    term: int
    # 2026-08-16: 加 is_activity 让前端能区分活动版/非活动版
    is_activity: int = 0
    activity_deadline: Optional[str] = None


class ProductsResponse(BaseModel):
    count: int
    items: list[ProductItem]


class HealthResponse(BaseModel):
    ok: bool
    db_path: str
    as_of: str
    tables: dict[str, int]


# =============================================================
# Endpoints
# =============================================================
@app.get("/healthz", response_model=HealthResponse)
def healthz():
    """健康检查 - 含 DB 连接 + 10 表行数"""
    try:
        conn = sqlite3.connect(DB_PATH)
        tables = {}
        for t in [
            "npi_fee_l1", "npi_fee_l2", "npi_fee_l3", "npi_fee_direct", "npi_fee_indirect",
            "pi_fee_l1", "pi_fee_l2", "pi_fee_l3", "pi_fee_direct", "pi_fee_indirect",
        ]:
            tables[t] = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        conn.close()
        cl = get_lookup()
        return HealthResponse(
            ok=True,
            db_path=DB_PATH,
            as_of=cl.as_of,
            tables=tables,
        )
    except Exception as e:
        log.exception("健康检查失败")
        raise HTTPException(status_code=503, detail=f"DB unavailable: {e}")


@app.post("/preview", response_model=PreviewResponse)
def preview(req: PreviewRequest):
    """代理人视图 - 只返 total_usd + 积分, 隐藏 y1/y2/add 等敏感字段

    代理人调用此接口时, 即使是 L1 级别也用 L2 视图计算 (代理人不区分级别,
    管理员已经按级别分配了具体能拿到的佣金档).
    """
    cl = get_lookup()
    if req.as_of:
        cl.as_of = req.as_of
    try:
        # 代理人视图固定 L2 (最常见的佣金级别, 管理员已分好)
        # 2026-08-16: 接受可选 investor (admin 在 /rates 页查 PI 时也需要 preview 走 PI)
        investor = req.investor if hasattr(req, 'investor') else "npi"
        r = cl.lookup(req.company, req.code, req.term, "L2", req.premium, investor)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))

    log.info(
        f"preview: {req.company} {req.code} {req.term}年 ${req.premium:,.0f} "
        f"→ ${r.total_usd:,.0f} ({r.points:,.0f} 积分)"
    )

    return PreviewResponse(
        company=r.company,
        code=r.code,
        plan=r.plan,
        term=r.term,
        level=r.level,
        investor=r.investor,
        currency=r.currency,
        premium=r.premium,
        is_activity=bool(r.is_activity),
        activity_deadline=r.activity_deadline,
        issue_deadline=parse_issue_deadline(r.plan),
        total_usd=r.total_usd,
        points=r.points,
    )


@app.post("/lookup", response_model=LookupResponse)
def lookup(req: LookupRequest):
    """管理员视图 - 完整佣金明细 (含 y1/y2/y3/y4/y5, add, direct, indirect)"""
    cl = get_lookup()
    if req.as_of:
        cl.as_of = req.as_of
    try:
        r = cl.lookup(
            req.company, req.code, req.term, req.level, req.premium, req.investor
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))

    log.info(
        f"lookup: {req.company} {req.code} {req.term}年 {req.level} {req.investor.upper()} "
        f"${req.premium:,.0f} → ${r.total_usd:,.0f} (y1={r.y1_pct}% add={r.add_pct}%)"
    )

    return LookupResponse(
        company=r.company,
        code=r.code,
        plan=r.plan,
        term=r.term,
        level=r.level,
        investor=r.investor,
        currency=r.currency,
        premium=r.premium,
        is_activity=bool(r.is_activity),
        activity_deadline=r.activity_deadline,
        total_usd=r.total_usd,
        points=r.points,
        y1_pct=r.y1_pct,
        y2_pct=r.y2_pct,
        y3_pct=r.y3_pct,
        y4_pct=r.y4_pct,
        y5_pct=r.y5_pct,
        add_pct=r.add_pct,
        total_pct=r.total_pct,
        direct_pct=r.direct_pct,
        indirect_pct=r.indirect_pct,
        y1_usd=r.y1_usd,
        y2_usd=r.y2_usd,
        y3_usd=r.y3_usd,
        y4_usd=r.y4_usd,
        y5_usd=r.y5_usd,
        renew_usd=r.renew_usd,
        add_usd=r.add_usd,
        direct_usd=r.direct_usd,
        indirect_usd=r.indirect_usd,
        warnings=r.warnings,
    )


@app.get("/products", response_model=ProductsResponse)
def products(
    company: Optional[str] = Query(default=None, description="按公司过滤 (模糊匹配)"),
    level: Literal["L1", "L2", "L3"] = Query(default="L2"),
    investor: Literal["npi", "pi"] = Query(default="npi"),
):
    """产品列表 - 给前端下拉框用"""
    cl = get_lookup()
    items = cl.list_products(investor, level)
    if company:
        items = [p for p in items if company in p["company"]]
    return ProductsResponse(
        count=len(items),
        items=[ProductItem(**p) for p in items],
    )


# =============================================================
# 启动入口 (uvicorn app:app)
# =============================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "5000")),
        log_level=LOG_LEVEL.lower(),
    )