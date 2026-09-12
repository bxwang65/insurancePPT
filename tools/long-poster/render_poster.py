#!/usr/bin/env python3
"""
储蓄险长图海报生成器 (v3: 真实 AI 背景图 + 全节点标注折线图)
用法: python render_poster.py <json_path> <output_png> [theme]

数据源: 与 insurance-ppt extraction 一致 (benefit_illustration + policy + insured)
输出: 720 x 7000-9000px 单 PNG
"""
import json
import sys
import os
import base64
from pathlib import Path
from jinja2 import Template
import math

# === 配色 (跟主题类对应) ===
THEMES = {
    "manulife": {"primary": "#7a1f1f", "accent": "#e8792b", "bg_deep": "#2a1410"},
    "ctf": {"primary": "#1a4a3a", "accent": "#d4a857", "bg_deep": "#0e2820"},
    "aia": {"primary": "#1a3a6e", "accent": "#e8a72b", "bg_deep": "#0e1a30"},
}

# === 数据点选择 (友商海报是 5/10/15/20/25/30/35/40) ===
POSTER_YEARS = [5, 10, 15, 20, 25, 30, 35, 40]

# === 产品权益卡 (03 章节) — 后期按产品定制 ===
DEFAULT_VALUE_ITEMS = [
    {"name": "财富增值选项", "desc": "将保证部分调减后增加非保证部分,实现更激进的资产配置,可能获得更高潜在回报。"},
    {"name": "终期红利锁定", "desc": "将部分终期红利锁定为周年红利,提取或留存账户,提供流动性同时保留长期增长。"},
    {"name": "暂领转换权益", "desc": "将保单暂领部分转换为定期入息,实现养老补充或子女教育金安排。"},
    {"name": "保单分拆安排", "desc": "可拆分为两份或以上新保单,适配家庭结构变化或财富传承安排。"},
    {"name": "灵活价值提取", "desc": "保单可部分退保提取现金价值,满足不同阶段的资金需求。"},
]

def fmt_wan(val: int, currency: str) -> str:
    """格式化数字 (1 万为单位, 带 1 位小数)"""
    if val is None:
        return "0"
    if val >= 100_000_000:
        return f"{val/100_000_000:.1f}亿"
    wan = val / 10_000
    if wan >= 100:
        return f"{wan:.0f}"
    return f"{wan:.1f}"

def fmt_k(val: int) -> str:
    """格式化为 K 单位, 整数, 友商风格 (USD 16,600K)"""
    if val is None or val == 0:
        return "0"
    return f"{val // 1000:,}"

def _npv(rate: float, cashflows: list) -> float:
    """M-A NPV: cashflows 是 [-投入, 0,..., 终值], r 是年化贴现率"""
    return sum(cf / ((1 + rate) ** t) for t, cf in enumerate(cashflows))

def _irr_bisect(cashflows: list, lo: float = -0.5, hi: float = 1.0, tol: float = 1e-6, maxiter: int = 100) -> float:
    """M-A IRR (bisection, 与 insurance-ppt 算法一致)"""
    try:
        npv_lo = _npv(lo, cashflows)
        npv_hi = _npv(hi, cashflows)
        if npv_lo * npv_hi > 0:
            return float("nan")
        for _ in range(maxiter):
            mid = (lo + hi) / 2
            npv_mid = _npv(mid, cashflows)
            if abs(npv_mid) < tol:
                return mid
            if npv_lo * npv_mid < 0:
                hi = mid; npv_hi = npv_mid
            else:
                lo = mid; npv_lo = npv_mid
        return (lo + hi) / 2
    except (OverflowError, ZeroDivisionError):
        return float("nan")

def compute_irr_si(annual_premium: int, tsv: int, years: int, pay_years: int = 5) -> dict:
    """计算复利 IRR + 单利 SI (口径与 pptx_renderer.py 完全一致)
       annual_premium: 年缴 (USD)
       tsv: 该年末累计退保总值
       years: 第几年 (1, 5, 10, ...) — 直接作为持有年数 k
       pay_years: 缴费年期
       公式 (pptx_renderer.py L1294-1303):
         IRR    = (total_received / paid_total) ** (1/k) - 1
         Simple = (total_received - paid_total) / paid_total / k
       paid_total = min(years, pay_years) * annual_premium
       关系: 同样终值/本金/年数下, 单利 > 复利 (复利有"利滚利")
    """
    if years <= 0 or tsv <= 0 or annual_premium <= 0:
        return {"irr": None, "si": None}
    invest_years = min(years, pay_years)
    total_in = annual_premium * invest_years  # = paid_total
    if total_in <= 0:
        return {"irr": None, "si": None}
    # 与 PPT renderer 一致: 仅当 TSV > 总保费时才计算 (回本前显示 —)
    if tsv <= total_in:
        return {"irr": None, "si": None}
    # 持有年数 = policy_year (与 PPT renderer 完全一致, 不做"投入期中位"调整)
    holding_years = years
    if holding_years <= 0:
        return {"irr": None, "si": None}
    # 复利 IRR: (TSV/total_in)^(1/holding) - 1
    irr = (tsv / total_in) ** (1.0 / holding_years) - 1
    # 单利 SI: (TSV - total_in) / total_in / holding  (与 PPT Simple 等价)
    si = (tsv - total_in) / total_in / holding_years
    return {"irr": irr, "si": si}

def fmt_pct(v, digits: int = 2) -> str:
    """格式化为百分比, 2 位小数"""
    if v is None or v != v:  # NaN check
        return "—"
    return f"{v * 100:.{digits}f}%"

def gender_cn(g: str) -> str:
    """M → 男, F → 女"""
    g = (g or "").upper()
    return {"M": "男", "F": "女", "MALE": "男", "FEMALE": "女"}.get(g, "")

def pick_data_cards(bi: list, target_years: list = POSTER_YEARS, total_premium_floor: int = None):
    """从 benefit_illustration 选 8 个时间点, 数据不够时按复合增长外推
       total_premium_floor: 第 5 年后的总保费 (用作 baseline 外推)
       返回: (cards, payback_year) - payback_year 是累计保费 ≤ TSV 的最早年份
    """
    by_year = {r["policy_year"]: r for r in bi}
    max_year = max(by_year.keys())
    # 总保费 baseline = 第 5 年后稳定值
    if total_premium_floor is None:
        for y in range(max_year, 4, -1):
            if by_year.get(y, {}).get("total_premium_paid", 0) > 0:
                total_premium_floor = by_year[y]["total_premium_paid"]
                break

    cards = []
    for y in target_years:
        row = by_year.get(y)
        if row:
            gcv = row.get("guaranteed_cash_value", 0)
            ngv = row.get("non_guaranteed_cash_value", 0)
            tsv = row.get("total_surrender_value", 0) or (gcv + ngv)
            tp = row.get("total_premium_paid", 0)
        else:
            # 外推: GCV 线性增长 + NGV 按近 5 年 CAGR 复利
            base = by_year.get(max_year, {})
            base_gcv = base.get("guaranteed_cash_value", 0)
            base_ngv = base.get("non_guaranteed_cash_value", 0)
            ngv_cagr = 1.06
            years_for_cagr = []
            for yy in range(max(1, max_year - 5), max_year):
                prev = by_year.get(yy, {}).get("non_guaranteed_cash_value", 0)
                curr = by_year.get(yy + 1, {}).get("non_guaranteed_cash_value", 0)
                if prev > 0:
                    years_for_cagr.append((curr / prev) ** (1 / (yy + 1 - yy)))
            if years_for_cagr:
                ngv_cagr = sum(years_for_cagr) / len(years_for_cagr)
                ngv_cagr = max(min(ngv_cagr, 1.10), 1.03)
            gcv_step = 0
            for yy in range(max_year - 2, max_year):
                step = by_year.get(yy + 1, {}).get("guaranteed_cash_value", 0) - by_year.get(yy, {}).get("guaranteed_cash_value", 0)
                if step > 0:
                    gcv_step = step
            gcv = base_gcv + gcv_step * (y - max_year)
            ngv = int(base_ngv * (ngv_cagr ** (y - max_year)))
            tsv = gcv + ngv
            tp = total_premium_floor or 0

        cards.append({
            "year": y,
            "tsv_wan": fmt_wan(tsv, "USD"),
            "gcv_wan": fmt_wan(gcv, "USD"),
            "premium_wan": fmt_wan(tp, "USD"),
            "tsv_raw": tsv,
            "gcv_raw": gcv,
            "premium_raw": tp,
        })

    # 计算回本年: TSV ≥ 总保费的真实最早年份 (用原始数据, 不外推)
    payback_year = None
    for y in sorted(by_year.keys()):
        row = by_year[y]
        tsv = row.get("total_surrender_value", 0) or (row.get("guaranteed_cash_value", 0) + row.get("non_guaranteed_cash_value", 0))
        tp = row.get("total_premium_paid", 0)
        if tsv > 0 and tp > 0 and tsv >= tp:
            payback_year = y
            break

    return cards, payback_year

def enrich_cards_with_irr_si(cards: list, annual_premium: int, pay_years: int) -> list:
    """为每个数据卡加 IRR / SI (用第 y 年末的累计现金流算)
       annual_premium: 年缴
       pay_years: 缴费年期
       注: 第 y 年末的累计投入 = min(y, pay_years) * annual_premium
    """
    enriched = []
    for c in cards:
        y = c["year"]
        irr_si = compute_irr_si(annual_premium, c["tsv_raw"], y, pay_years)
        enriched.append({
            **c,
            "irr": irr_si["irr"],
            "irr_pct": fmt_pct(irr_si["irr"]),
            "si": irr_si["si"],
            "si_pct": fmt_pct(irr_si["si"]),
        })
    return enriched

def build_chart_svg(cards: list, total_premium: int, max_year: int = 40, payback_year: int = None) -> str:
    """v5 SVG 折线图:
       - 全部 8 个数据点都标注 USD X,XXX K
       - 累计已缴保费 = 粗实线 3px 深灰
       - 退保总值 = 粗实线 3px 主橙色 + 大圆点 6px
       - 回本时间标注: 用真实 Y 数据 (不内插), payback_year 由 pick_data_cards 返回
       - Y 轴 5 档 ($0 → max)
       - 标题: "演示退保发还总额 vs 累计已缴保费 (USD)"
    """
    W, H = 640, 360
    pad_l, pad_r, pad_t, pad_b = 64, 24, 50, 50
    chart_w, chart_h = W - pad_l - pad_r, H - pad_t - pad_b

    max_val = max((c["tsv_raw"] for c in cards), default=total_premium)
    y_max = int(max_val * 1.18)

    def x_pos(yr: float) -> float:
        return pad_l + (yr / max_year) * chart_w
    def y_pos(val: float) -> float:
        return pad_t + chart_h - (val / y_max) * chart_h

    parts = []
    parts.append(f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">')

    # === 标题 ===
    parts.append(f'<text x="{pad_l}" y="22" font-size="13" fill="#1a1a1a" font-weight="700">演示退保发还总额 vs 累计已缴保费 (USD)</text>')
    parts.append(f'<text x="{W - pad_r}" y="22" font-size="10" fill="#999" text-anchor="end">单位: USD K (千)</text>')

    # === 网格 (5 档横线 + Y 轴标签) ===
    for i in range(5):
        v = y_max * i / 4
        y = y_pos(v)
        parts.append(f'<line x1="{pad_l}" y1="{y:.1f}" x2="{pad_l + chart_w}" y2="{y:.1f}" stroke="#e8e2d4" stroke-width="1"/>')
        parts.append(f'<text x="{pad_l - 8}" y="{y + 4:.1f}" font-size="10" fill="#888" text-anchor="end">${v/1000:,.0f}K</text>')

    # === 横轴年份 ===
    for yr in (0, 10, 20, 30, 40):
        parts.append(f'<text x="{x_pos(yr):.1f}" y="{H - pad_b + 20}" font-size="10" fill="#888" text-anchor="middle">{yr}年</text>')

    # === X 轴基线 ===
    parts.append(f'<line x1="{pad_l}" y1="{y_pos(0):.1f}" x2="{pad_l + chart_w}" y2="{y_pos(0):.1f}" stroke="#bbb" stroke-width="1.5"/>')

    # === 累计保费: 粗实线 3px 深灰 ===
    parts.append(f'<line x1="{x_pos(0):.1f}" y1="{y_pos(total_premium):.1f}" x2="{x_pos(max_year):.1f}" y2="{y_pos(total_premium):.1f}" stroke="#555" stroke-width="3"/>')
    # 标签 (右上)
    parts.append(f'<text x="{x_pos(max_year) - 4:.1f}" y="{y_pos(total_premium) - 8:.1f}" font-size="10" fill="#555" text-anchor="end" font-weight="600">累计保费 ${fmt_k(total_premium)}K</text>')

    # === 退保总值: 折线 (从 0 年起, 起始点 = 首点 * 0.3 避免与 X 轴重叠) ===
    first_card = cards[0]
    pts = []
    pts.append(f"{x_pos(0):.1f},{y_pos(first_card['tsv_raw'] * 0.3):.1f}")
    for c in cards:
        pts.append(f"{x_pos(c['year']):.1f},{y_pos(c['tsv_raw']):.1f}")
    # 折线区域渐变填充
    area_pts = pts + [f"{x_pos(cards[-1]['year']):.1f},{y_pos(0):.1f}", f"{x_pos(0):.1f},{y_pos(0):.1f}"]
    parts.append(f'<polygon points="{" ".join(area_pts)}" fill="rgba(232,121,43,0.12)"/>')
    # 主折线
    parts.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="#e8792b" stroke-width="3"/>')

    # === 回本时间标注 (用真实数据, payback_year 由 pick_data_cards 返回) ===
    if payback_year is not None and 0 < payback_year <= max_year:
        pbx = x_pos(payback_year)
        pby = y_pos(total_premium)
        # 大红圆点
        parts.append(f'<circle cx="{pbx:.1f}" cy="{pby:.1f}" r="8" fill="rgba(220,38,38,0.25)"/>')
        parts.append(f'<circle cx="{pbx:.1f}" cy="{pby:.1f}" r="5" fill="#dc2626" stroke="#fff" stroke-width="2"/>')
        # 垂直虚线 (从交点拉到 X 轴)
        parts.append(f'<line x1="{pbx:.1f}" y1="{pby:.1f}" x2="{pbx:.1f}" y2="{y_pos(0):.1f}" stroke="#dc2626" stroke-width="1" stroke-dasharray="3 3"/>')
        # 标签: "回本 ≈ Y年" (box + arrow + text)
        label_x = pbx
        label_y = pby - 32
        if label_x - 50 < pad_l:
            label_x = pad_l + 50
        box_w = 80
        box_h = 22
        bx = label_x - box_w / 2
        by = label_y - box_h / 2
        parts.append(f'<rect x="{bx:.1f}" y="{by:.1f}" width="{box_w}" height="{box_h}" rx="3" fill="#dc2626"/>')
        parts.append(f'<text x="{label_x:.1f}" y="{label_y + 4:.1f}" font-size="11" fill="#fff" text-anchor="middle" font-weight="700">回本 ≈ {payback_year}年</text>')
        # 箭头 (从 box 底部到圆点)
        parts.append(f'<line x1="{label_x:.1f}" y1="{by + box_h:.1f}" x2="{pbx:.1f}" y2="{pby - 6:.1f}" stroke="#dc2626" stroke-width="1.5"/>')

    # === 8 个数据点全部标注 USD X,XXX K (用户反馈: 重要节点必须清晰标识) ===
    # 错位避免重叠: 上方/下方交替
    for idx, c in enumerate(cards):
        x, y = x_pos(c["year"]), y_pos(c["tsv_raw"])
        # 外圈光晕
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="rgba(232,121,43,0.2)"/>')
        # 主圆点
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="#fff" stroke="#e8792b" stroke-width="2.5"/>')
        # 数据标签: USD X,XXX K — 错位标注 (偶数下, 奇数上)
        label = f"USD {fmt_k(c['tsv_raw'])}K"
        if idx % 2 == 0:
            ty = y - 14
            parts.append(f'<rect x="{x - 32:.1f}" y="{ty - 12:.1f}" width="64" height="16" rx="3" fill="#7a1f1f"/>')
            parts.append(f'<text x="{x:.1f}" y="{ty:.1f}" font-size="10" fill="#fff" text-anchor="middle" font-weight="700">{label}</text>')
        else:
            ty = y + 22
            parts.append(f'<rect x="{x - 32:.1f}" y="{ty - 12:.1f}" width="64" height="16" rx="3" fill="#fff" stroke="#7a1f1f" stroke-width="1"/>')
            parts.append(f'<text x="{x:.1f}" y="{ty:.1f}" font-size="10" fill="#7a1f1f" text-anchor="middle" font-weight="700">{label}</text>')

    parts.append('</svg>')
    return "\n".join(parts)

def build_p(p: dict, bi: list = None) -> dict:
    """处理 policy 数字为 万单位
       bi: benefit_illustration, 用于 pay_period=0 时回推 pay_years
       币种归一化: DeepSeek 偶尔输出中文 "美金/港元/人民币/澳元/加元", 统一映射为 ISO 代码
    """
    annual = p.get("annual_premium", 0) or 0
    pay_years = p.get("premium_payment_period", "5年")
    currency_raw = str(p.get("currency", "USD") or "USD").strip()
    currency_map = {
        "美金": "USD", "美元": "USD", "US$": "USD", "USD": "USD",
        "港元": "HKD", "港币": "HKD", "HK$": "HKD", "HKD": "HKD",
        "人民币": "CNY", "RMB": "CNY", "CNY": "CNY",
        "澳元": "AUD", "AUD": "AUD",
        "加元": "CAD", "CAD": "CAD",
    }
    currency = currency_map.get(currency_raw, currency_raw if len(currency_raw) <= 5 else "USD")
    import re
    pay_match = re.search(r"\d+", str(pay_years))
    pay_n = int(pay_match.group()) if pay_match else 5
    # 防御: LLM 偶尔把 pay_period 抽成 "0年" / "" / "趸交" — 用 max_total_premium_paid 反推
    if (pay_n == 0 or pay_n > 30) and bi and annual > 0:
        max_tp = max((r.get("total_premium_paid", 0) for r in bi), default=0)
        if max_tp > 0:
            inferred = round(max_tp / annual)
            if 1 <= inferred <= 30:
                pay_n = inferred
                print(f"[build_p] pay_period invalid ({pay_years!r}), inferred {pay_n} 年 from max_total_paid={max_tp} / annual={annual}")
    total = annual * pay_n
    si = p.get("sum_insured", 0) or 0
    return {
        "currency": currency,
        "annual_premium": annual,
        "pay_years": pay_n,
        "total_premium": total,
        "sum_insured": si,
        "premium_wan": fmt_wan(annual, currency),
        "total_premium_wan": fmt_wan(total, currency),
        "sum_insured_wan": fmt_wan(si, currency),
    }

def load_theme(company_id: str) -> dict:
    """加载 per-company theme (themes/<company_id>.json)
       失败时回退到 manulife (避免硬崩, 营销可继续)
    """
    theme_path = Path(__file__).parent / "themes" / f"{company_id}.json"
    if not theme_path.exists():
        # 模糊匹配: aia == AIA, ctf == 周大福
        for f in (Path(__file__).parent / "themes").glob("*.json"):
            if company_id.lower() in f.stem.lower():
                theme_path = f
                break
    if not theme_path.exists():
        print(f"[render] WARN theme '{company_id}' not found, fallback to manulife")
        theme_path = Path(__file__).parent / "themes" / "manulife.json"
    with open(theme_path, encoding="utf-8") as f:
        return json.load(f)


def load_theme_images(theme: dict) -> dict:
    """读 theme.images; 缺失时尝试从 assets/<company>_<key>.jpg 加载
       返回 {header, chapter02, chapter06} 的 base64 字符串 (用于 CSS data URI)
    """
    images = theme.get("images", {}) or {}
    out = {}
    for key in ("header", "chapter02", "chapter06"):
        b64 = images.get(key, "")
        if b64:
            out[key] = b64
            continue
        # 尝试从 assets/ 读 (命名约定: <company_id>_<key>.jpg)
        company_id = theme.get("company_id", "manulife")
        for ext in ("jpg", "jpeg", "png", "webp"):
            path = Path(__file__).parent / "assets" / f"{company_id}_{key}.{ext}"
            if path.exists():
                with open(path, "rb") as f:
                    out[key] = base64.b64encode(f.read()).decode("ascii")
                break
        else:
            # 最后回退: manulife 已缓存的图
            legacy = Path(__file__).parent / "assets" / "_b64.json"
            if legacy.exists():
                legacy_bgs = json.loads(legacy.read_text())
                out[key] = legacy_bgs.get({
                    "header": "header_family",
                    "chapter02": "growth_wealth",
                    "chapter06": "sailboat_sea",
                }[key], "")
    return out


def logo_to_data_uri(logo_path: str) -> str:
    """读本地 logo PNG → data URI (避免 file:// 协议警告)
       2026-09-11: themes/*.json 里 logo_path 是 Mac 绝对路径 (/Users/soldier/insurance-ppt-v3/...),
       ECS 容器 project root 是 /opt/insurance-ppt, 故加 ECS fallback 链.
    """
    candidates = []
    if logo_path:
        candidates.append(logo_path)
        # Mac path → ECS path 映射 (theme JSON 是 Mac 开发时产物)
        if logo_path.startswith("/Users/soldier/insurance-ppt-v3/"):
            candidates.append("/opt/insurance-ppt/" + logo_path[len("/Users/soldier/insurance-ppt-v3/"):])
        # 相对 project root 解析
        project_root = Path(__file__).resolve().parent.parent.parent
        if not Path(logo_path).is_absolute():
            candidates.append(str(project_root / logo_path))
    for p in candidates:
        if p and Path(p).exists():
            ext = Path(p).suffix.lstrip(".") or "png"
            mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                    "svg": "image/svg+xml", "webp": "image/webp"}.get(ext, "image/png")
            with open(p, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("ascii")
            return f"data:{mime};base64,{b64}"
    return ""


def build_withdraw_table_rows(insured_age: int, withdrawal_illustration: list,
                              max_rows: int = 11) -> list:
    """构建提取表行 — 每 5 年一行 (Y1/Y5/Y10/.../Y80), 最多 11 行, 无 80 岁硬上限 (由数据自然截止).
       2026-09-12: 用户去掉 80 岁年龄限制, 改为每 5 年间隔 + 最多 11 行, 旧版"每 10 年 + 80 岁上限"作废.
       候选年份 = [1, 5, 10, 15, ..., 80], clip 到 max_year_data (保单演示表自然截止).
       若精确年份缺失 (如 计划书从 Y2 开始), 用 ≤ 目标年的最近一年代理.
    """
    if not withdrawal_illustration or not insured_age or insured_age < 0:
        return []
    # 全部 annual_withdrawal=0 视为没真实提取 → 整段不渲染
    if not any(r.get("annual_withdrawal", 0) > 0 for r in withdrawal_illustration):
        return []

    by_year = {int(r["policy_year"]): r for r in withdrawal_illustration if r.get("policy_year")}
    if not by_year:
        return []

    max_year_data = max(by_year.keys())
    if max_year_data < 1:
        return []

    # 候选年份: 1, 5, 10, 15, ..., 80 (每 5 年一个)
    candidates = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80]

    selected = []
    for y in candidates:
        if y > max_year_data:
            break
        # 精确命中直接用
        if y in by_year:
            actual_y = y
        else:
            # 缺数据: 优先 ≤ y 的最近年份, 没有则用最小可用年份
            smaller_or_equal = [yy for yy in by_year.keys() if yy <= y]
            if smaller_or_equal:
                actual_y = max(smaller_or_equal)
            else:
                # 数据从 Y2 起, 找 Y1 时无 ≤ 1, fallback 到最小可用
                actual_y = min(by_year.keys())
        # 去重 (Y1→Y2 代理后 Y10 仍要包含)
        if actual_y not in selected:
            selected.append(actual_y)

    # 关键: 把所有 annual_withdrawal > 0 的年份也纳入 (一次性提取场景, 如 Y11=200K 其他=0,
    # 不在 5 年间隔 [1,5,10,...] 里就被吞掉, 用户看不到任何提取金额)
    nonzero_years = sorted({
        int(r["policy_year"]) for r in withdrawal_illustration
        if r.get("annual_withdrawal", 0) > 0 and r.get("policy_year")
    })
    for y in nonzero_years:
        if y not in selected:
            selected.append(y)
    selected = sorted(set(selected))[:max_rows]

    out = []
    for y in selected:
        r = by_year[y]
        # surrender_value_after 优先 (提取后剩余); fallback to total_surrender_value
        sv = r.get("surrender_value_after")
        if sv is None:
            sv = r.get("total_surrender_value", 0)
        out.append({
            "year": y,
            "age": insured_age + y - 1,
            "total_premium": r.get("total_premium_paid", 0) or 0,
            "withdrawal": r.get("annual_withdrawal", 0) or 0,
            "surrender_value": sv or 0,
        })
    return out


def get_extract_start(withdrawal_illustration: list) -> dict | None:
    """提取起始信息: {start_year, annual_amount, is_one_time} — 给模板渲染"提取起始备注"用
       无真实提取时返回 None.
       一次性提取 (全表只有 1 个非零行): is_one_time=True, 模板切换文案.
    """
    if not withdrawal_illustration:
        return None
    nonzero = [r for r in sorted(withdrawal_illustration, key=lambda x: x.get("policy_year", 0))
               if r.get("annual_withdrawal", 0) > 0]
    if not nonzero:
        return None
    first = nonzero[0]
    return {
        "start_year": int(first["policy_year"]),
        "annual_amount": first["annual_withdrawal"],
        "is_one_time": len(nonzero) == 1,
    }


def fmt_wan_table(amount, decimals: int = 1) -> str:
    """提取表专用: 统一 X.X万, 与海报其它 fmt_wan 不冲突 (避免同名覆盖 build_p 内部调用)"""
    if amount is None:
        return "-"
    return f"{amount / 10000:.{decimals}f}万"


def render(json_path: str, output_png: str, company_id: str = "manulife",
           brand_name: str = None, author: str = None):
    """主渲染入口 — 全部从 themes/<company_id>.json 读
       Args:
           json_path: 提取好的 benefit_illustration JSON 路径
           output_png: 输出 PNG 路径
           company_id: 公司 slug (manulife/aia/ctf/pru/axa/fwd/cpic/yflife/...)
    """
    theme = load_theme(company_id)
    colors = theme.get("colors", {"primary": "#7a1f1f", "accent": "#e8792b", "bg_deep": "#2a1410"})
    logo_data_uri = logo_to_data_uri(theme.get("logo_path", ""))
    images = load_theme_images(theme)
    value_items = theme.get("value_items", DEFAULT_VALUE_ITEMS)

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    insured = data.get("insured", {})
    bi = data.get("benefit_illustration", [])
    policy = build_p(data.get("policy", {}), bi=bi)

    cards, payback_year = pick_data_cards(bi, total_premium_floor=policy["total_premium"])
    # 加 IRR/SI 计算 (复利 IRR + 单利 SI, 口径与 PPT renderer 完全一致)
    cards = enrich_cards_with_irr_si(cards, policy["annual_premium"], policy["pay_years"])
    # 关键: 图表 X 轴必须固定 0-40 年 (与 POSTER_YEARS 保持一致), 不用数据 max_year
    chart_svg = build_chart_svg(cards, policy["total_premium"], max_year=40, payback_year=payback_year)

    template_path = Path(__file__).parent / "templates" / "poster.html"
    with open(template_path, "r", encoding="utf-8") as f:
        tpl = Template(f.read())

    rendered = tpl.render(
        theme=company_id,
        colors=colors,
        brand_name=brand_name or theme.get("brand_label", "Manulife 宏利"),
        brand_name_zh=theme.get("brand_name_zh", "宏利"),
        author=author or theme.get("author", "宏利香港"),
        tagline=theme.get("tagline", "长期储蓄 · 现金价值 · 财富传承"),
        logo_data_uri=logo_data_uri,
        bg_header=images.get("header", ""),
        bg_chapter02=images.get("chapter02", ""),
        bg_chapter06=images.get("chapter06", ""),
        product_name=data.get("product_name", "储蓄保险计划"),
        insured={
            "age": insured.get("age", 35),
            "gender_cn": gender_cn(insured.get("gender", "M")),
        },
        currency=policy["currency"],
        premium_wan=policy["premium_wan"],
        pay_years=policy["pay_years"],
        total_premium_wan=policy["total_premium_wan"],
        sum_insured_wan=policy["sum_insured_wan"],
        chart_svg=chart_svg,
        data_cards=cards,
        # 2026-09-11: 提取方案摘要表 (仅当有真实 annual_withdrawal>0 时填充, 否则空 → 模板隐藏)
        withdraw_table_rows=build_withdraw_table_rows(
            insured_age=int(insured.get("age", 35) or 35),
            withdrawal_illustration=data.get("withdrawal_illustration", []) or [],
        ),
        extract_start=get_extract_start(data.get("withdrawal_illustration", []) or []),
        fmt_wan=fmt_wan_table,
        value_items=value_items,
    )

    # 输出 HTML 中间产物
    html_out = Path(output_png).with_suffix(".html")
    html_out.write_text(rendered, encoding="utf-8")
    print(f"[render] HTML saved: {html_out}")

    # Playwright 截图
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 720, "height": 800})
            page.goto(f"file://{html_out.resolve()}")
            page.wait_for_load_state("networkidle")
            page.screenshot(path=output_png, full_page=True, type="png")
            browser.close()
        print(f"[render] PNG saved: {output_png}")
        from PIL import Image
        img = Image.open(output_png)
        print(f"[render] Size: {img.size[0]}x{img.size[1]} px")
    except ImportError as e:
        print(f"[render] Playwright 不可用, 仅 HTML 已生成: {e}")
        print(f"[render] 手动打开 {html_out} 用浏览器截图")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python render_poster.py <json_path> [output_png] [company_id]")
        print("例: python render_poster.py manulife_hongzhi.json out.png manulife")
        print("可用 company_id:", ", ".join(p.stem for p in (Path(__file__).parent / "themes").glob("*.json")))
        sys.exit(1)
    json_path = sys.argv[1]
    output_png = sys.argv[2] if len(sys.argv) > 2 else "out.png"
    company_id = sys.argv[3] if len(sys.argv) > 3 else "manulife"
    render(json_path, output_png, company_id)