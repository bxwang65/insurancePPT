"""
HTML 渲染器 (单文件, 可分享/小程序H5/浏览器打印)

设计:
- 完全内联CSS+JS (无外部依赖, 离线可用)
- 12页与PPTX完全对应
- 焦糖棕配色保持一致
- 表格用 <table> (小程序可直接渲染)
- 图表用纯CSS (柱状图/进度条)
- 客户端可切页/全屏
"""
import html
import os
from typing import Dict, List

from ..templates.style_tokens import COLORS, FONT_HEI, FONT_LATIN


def _esc(s) -> str:
    if s is None: return ''
    return html.escape(str(s))


def _fmt(v) -> str:
    if v is None: return '-'
    if isinstance(v, float) and v < 1.5:
        return f"{v*100:.2f}%"
    if isinstance(v, (int, float)) and abs(v) > 100:
        return f"{int(v):,}" if v == int(v) else f"{v:,.2f}"
    if isinstance(v, (int, float)):
        return f"{v:,.2f}"
    return str(v)


def _css() -> str:
    """内联CSS"""
    return f"""
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
    font-family: '{FONT_HEI}', 'PingFang SC', 'Microsoft YaHei', '{FONT_LATIN}', sans-serif;
    background: {COLORS['cream_bg']};
    color: {COLORS['dark_coffee']};
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
}}
.deck {{
    max-width: 1280px;
    margin: 0 auto;
    padding: 20px;
}}
.slide {{
    background: {COLORS['cream_white']};
    border-radius: 8px;
    box-shadow: 0 4px 24px rgba(51,40,37,0.12);
    padding: 48px 56px;
    margin-bottom: 32px;
    page-break-after: always;
    min-height: 720px;
    position: relative;
}}
.slide-header {{
    border-top: 4px solid {COLORS['gold']};
    padding-top: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
}}
.brand {{
    color: {COLORS['caramel']};
    font-size: 12px;
    font-weight: bold;
    letter-spacing: 1px;
}}
.page-num {{
    color: {COLORS['coffee_mid']};
    font-size: 11px;
    font-weight: 500;
}}
.title {{
    color: {COLORS['dark_coffee']};
    font-size: 28px;
    font-weight: bold;
    margin-bottom: 6px;
    line-height: 1.3;
}}
.subtitle {{
    color: {COLORS['coffee_mid']};
    font-size: 13px;
    margin-bottom: 8px;
}}
.title-bar {{
    width: 60px;
    height: 3px;
    background: {COLORS['caramel']};
    margin-bottom: 28px;
}}
.row {{ display: flex; gap: 16px; }}
.col {{ flex: 1; }}
.metric-card {{
    background: {COLORS['cream_white']};
    border-left: 4px solid {COLORS['caramel']};
    padding: 20px;
    border-radius: 4px;
}}
.metric-value {{
    font-size: 32px;
    color: {COLORS['dark_coffee']};
    font-weight: bold;
    line-height: 1.2;
}}
.metric-unit {{
    color: {COLORS['caramel']};
    font-size: 11px;
    margin-top: 4px;
}}
.metric-label {{
    color: {COLORS['coffee_mid']};
    font-size: 11px;
    margin-top: 8px;
    letter-spacing: 0.5px;
}}
table.data-table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    margin: 12px 0;
}}
table.data-table th {{
    background: {COLORS['dark_coffee']};
    color: {COLORS['cream_light']};
    padding: 10px 6px;
    text-align: center;
    font-size: 10.5px;
    font-weight: bold;
    border-right: 1px solid rgba(255,255,255,0.05);
}}
table.data-table td {{
    padding: 8px 6px;
    text-align: center;
    border-bottom: 1px solid {COLORS['gray_line']};
    font-size: 11px;
}}
table.data-table tr:nth-child(even) td {{
    background: {COLORS['cream_light']};
}}
table.data-table .num {{
    font-variant-numeric: tabular-nums;
    color: {COLORS['coffee']};
}}
table.data-table .num.guar {{
    color: {COLORS['caramel']};
}}
table.data-table .num.total {{
    color: {COLORS['dark_coffee']};
    font-weight: bold;
}}
table.data-table .num.irr {{
    color: {COLORS['caramel_dark']};
    font-weight: bold;
}}
table.data-table .num.annual-wd {{
    color: {COLORS['caramel_dark']};
    font-weight: bold;
}}
.disclaimer-box {{
    background: {COLORS['cream_white']};
    border-left: 4px solid {COLORS['caramel']};
    padding: 14px 18px;
    border-radius: 4px;
    margin: 16px 0;
    font-size: 11.5px;
    color: {COLORS['coffee']};
}}
.disclaimer-box .title {{
    font-size: 12px;
    margin-bottom: 4px;
}}
.source {{
    color: {COLORS['coffee_mid']};
    font-size: 10px;
    text-align: right;
    margin-top: 12px;
}}
.cover {{
    background: linear-gradient(135deg, {COLORS['cream_bg']} 0%, {COLORS['cream_bg']} 50%, {COLORS['dark_coffee']} 50%, {COLORS['dark_coffee']} 100%);
    padding: 0;
    overflow: hidden;
}}
.cover-left {{
    width: 50%;
    padding: 80px 64px;
    color: {COLORS['dark_coffee']};
    display: inline-block;
    vertical-align: top;
    min-height: 720px;
}}
.cover-right {{
    width: 50%;
    padding: 80px 64px;
    color: {COLORS['cream_light']};
    display: inline-block;
    vertical-align: top;
    text-align: center;
    min-height: 720px;
    background: {COLORS['dark_coffee']};
    position: relative;
}}
.cover-product {{
    font-size: 38px;
    font-weight: bold;
    color: {COLORS['dark_coffee']};
    margin: 20px 0 12px;
    line-height: 1.2;
}}
.cover-sub {{
    font-size: 18px;
    color: {COLORS['caramel']};
    margin-bottom: 16px;
}}
.cover-name {{
    font-size: 76px;
    color: {COLORS['gold']};
    font-weight: bold;
    margin-top: 60px;
    letter-spacing: 4px;
}}
.cover-relation {{
    font-size: 22px;
    color: {COLORS['cream_light']};
    margin-top: 10px;
    letter-spacing: 4px;
}}
.cover-tag {{
    display: inline-block;
    border: 1px solid {COLORS['gold']};
    color: {COLORS['gold']};
    padding: 6px 14px;
    font-size: 11px;
    margin: 28px 4px 4px;
    border-radius: 2px;
}}
.feature-card {{
    background: {COLORS['cream_white']};
    border-radius: 6px;
    padding: 20px 24px;
    box-shadow: 0 2px 12px rgba(51,40,37,0.06);
    position: relative;
    border-left: 4px solid {COLORS['caramel']};
    height: 220px;
}}
.feature-no {{
    position: absolute;
    top: 18px;
    left: 22px;
    font-size: 26px;
    color: {COLORS['caramel']};
    font-weight: bold;
    opacity: 0.8;
}}
.feature-title {{
    position: absolute;
    top: 22px;
    left: 70px;
    font-size: 15px;
    color: {COLORS['dark_coffee']};
    font-weight: bold;
}}
.feature-body {{
    position: absolute;
    top: 70px;
    left: 22px;
    right: 24px;
    color: {COLORS['coffee']};
    font-size: 11px;
    line-height: 1.6;
}}
.feature-kpi {{
    position: absolute;
    bottom: 18px;
    right: 24px;
    font-size: 22px;
    color: {COLORS['caramel']};
    font-weight: bold;
}}
.feature-unit {{
    position: absolute;
    bottom: 4px;
    right: 24px;
    color: {COLORS['coffee_mid']};
    font-size: 9px;
}}
.bar-chart {{
    display: flex;
    align-items: flex-end;
    height: 240px;
    border-bottom: 2px solid {COLORS['dark_coffee']};
    border-left: 2px solid {COLORS['dark_coffee']};
    padding: 8px;
    gap: 4px;
    margin: 12px 0;
}}
.bar-group {{
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    justify-content: flex-end;
    position: relative;
}}
.bar {{
    width: 70%;
    background: {COLORS['caramel']};
    position: relative;
    border-radius: 2px 2px 0 0;
}}
.bar.gold {{
    background: {COLORS['gold']};
    margin-top: 0;
}}
.bar-group.stacked {{
    gap: 0;
}}
.bar-stack {{
    width: 70%;
    display: flex;
    flex-direction: column;
    border-radius: 2px 2px 0 0;
    overflow: hidden;
}}
.bar-stack .bar {{ width: 100%; border-radius: 0; }}
.bar-label {{
    margin-top: 6px;
    font-size: 10px;
    color: {COLORS['coffee_mid']};
    text-align: center;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
}}
.legend {{
    display: flex;
    gap: 16px;
    margin-top: 8px;
    font-size: 11px;
    color: {COLORS['coffee']};
}}
.legend-item {{
    display: flex;
    align-items: center;
    gap: 6px;
}}
.legend-box {{
    width: 14px;
    height: 14px;
    border-radius: 2px;
}}
.callout-card {{
    background: {COLORS['cream_white']};
    border-left: 4px solid {COLORS['caramel']};
    padding: 12px 16px;
    margin-bottom: 10px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 16px;
}}
.callout-card .yr {{
    font-weight: bold;
    color: {COLORS['dark_coffee']};
    font-size: 12px;
    min-width: 60px;
}}
.callout-card .val {{
    font-size: 18px;
    font-weight: bold;
    color: {COLORS['caramel_dark']};
    min-width: 80px;
    text-align: right;
}}
.callout-card .sub {{
    font-size: 10px;
    color: {COLORS['coffee_mid']};
    flex: 1;
}}
.education-stage {{
    background: {COLORS['cream_white']};
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(51,40,37,0.06);
}}
.education-header {{
    color: {COLORS['cream_light']};
    padding: 14px 12px;
    text-align: center;
}}
.education-header .name {{
    font-size: 16px;
    font-weight: bold;
    margin-bottom: 2px;
}}
.education-header .age {{
    font-size: 11px;
    opacity: 0.85;
}}
.education-body {{
    padding: 18px 12px;
    text-align: center;
    min-height: 160px;
    position: relative;
}}
.education-body .cum-label {{
    font-size: 10px;
    color: {COLORS['coffee_mid']};
    margin-bottom: 4px;
}}
.education-body .cum-val {{
    font-size: 16px;
    font-weight: bold;
    margin-bottom: 16px;
    font-variant-numeric: tabular-nums;
}}
.education-body .detail {{
    font-size: 10px;
    color: {COLORS['coffee']};
    line-height: 1.5;
    margin: 12px 0;
}}
.education-body .remain {{
    font-size: 11px;
    color: {COLORS['dark_coffee']};
    font-weight: bold;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid {COLORS['gray_line']};
}}
.timeline {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 12px;
    margin: 24px 0 8px;
    position: relative;
}}
.timeline::before {{
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 2px;
    background: {COLORS['caramel']};
    z-index: 0;
}}
.timeline-dot {{
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: {COLORS['gold']};
    position: relative;
    z-index: 1;
}}
.timeline-age {{
    position: absolute;
    top: -22px;
    color: {COLORS['dark_coffee']};
    font-size: 11px;
    font-weight: bold;
}}
.ending-cover {{
    background: linear-gradient(135deg, {COLORS['dark_coffee']} 0%, {COLORS['coffee']} 100%);
    color: {COLORS['cream_light']};
    text-align: center;
    padding: 120px 56px;
    min-height: 720px;
}}
.ending-cover h1 {{
    font-size: 36px;
    margin: 20px 0;
    color: {COLORS['cream_light']};
    font-weight: bold;
}}
.ending-cover h2 {{
    font-size: 36px;
    color: {COLORS['gold']};
    font-weight: bold;
    margin: 20px 0;
}}
.ending-cover .greeting {{
    font-size: 14px;
    color: {COLORS['gold_light']};
    margin: 24px 0;
    letter-spacing: 2px;
}}
.ending-cover .rule {{
    width: 80px;
    height: 2px;
    background: {COLORS['gold']};
    margin: 16px auto;
}}
.ending-cover .footer {{
    margin-top: 60px;
    color: {COLORS['gold_light']};
    font-size: 10px;
}}
.toolbar {{
    position: fixed;
    top: 20px;
    right: 20px;
    background: rgba(51,40,37,0.92);
    color: {COLORS['cream_light']};
    padding: 8px 14px;
    border-radius: 24px;
    font-size: 11px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
    z-index: 999;
    cursor: pointer;
    user-select: none;
}}
.toolbar:hover {{ background: rgba(51,40,37,1); }}
@media print {{
    .toolbar {{ display: none; }}
    .slide {{ page-break-after: always; box-shadow: none; }}
    body {{ background: white; }}
    .deck {{ padding: 0; max-width: 100%; }}
}}
"""


def _mbrand(meta):
    if not meta: return "INSURANCE | 储蓄计划"
    return f'{meta.get("company_short_en", "")}  |  {meta.get("company_short", "")}'


def _lines_or_dash(lines):
    if not lines: return '—'
    return '<br>'.join(lines)

def _header_html(page_num: int, total: int = 12, meta=None) -> str:
    meta_brand = _mbrand(meta)
    return f"""
<div class="slide-header">
    <div class="brand">{meta_brand}</div>
    <div class="page-num">{page_num:02d} / {total:02d}</div>
</div>
"""


def _title_html(title: str, subtitle: str = '', title_size: int = 28) -> str:
    return f"""
<h1 class="title" style="font-size:{title_size}px;">{_esc(title)}</h1>
{('<div class="subtitle">' + _esc(subtitle) + '</div>') if subtitle else ''}
<div class="title-bar"></div>
"""


def _render_cover(s, p, paid_total, meta):
    name = s.get('insured_name', 'VIP 先生') or 'VIP 先生'
    # 优先 meta.product_name (KB 里的标准名)
    prod = (meta.get('product_name') or s.get('product_name') or '「匠·传承」储蓄寿险计划2').replace('\n', '')
    cov = s.get('coverage_period', '终身')
    pay_years = s.get('payment_years', 5)
    annual = s.get('annual_premium') or 100000
    currency = s.get('currency', '美元')
    meta_brand = _mbrand(meta)
    meta_short = meta.get('company_short', '保险公司')
    # 副标题
    prod_short = meta.get('product_name_short', '')
    age = s.get('insured_age', 1)
    return f"""
<section class="slide cover">
    <div class="cover-left">
        <div class="brand" style="color:{COLORS['caramel']};font-weight:bold;letter-spacing:1px;font-size:12px;">{meta_brand}</div>
        <div style="font-size:9px;color:{COLORS['coffee_mid']};letter-spacing:2px;margin-top:6px;">PRIVATE CLIENT BRIEFING</div>
        <div style="width:50px;height:3px;background:{COLORS['caramel']};margin:12px 0 16px;"></div>
        <div class="cover-product">{_esc(prod)}</div>
        <div class="cover-sub">尊尚版 · 教育金规划方案</div>
        <div style="width:50px;height:2px;background:{COLORS['caramel']};margin:8px 0 24px;"></div>
        <div style="color:{COLORS['coffee']};font-size:13px;margin:8px 0;">受保人：{_esc(name)}（{age}岁）</div>
        <div style="color:{COLORS['coffee_mid']};font-size:12px;">{pay_years} 年缴 · {_esc(currency)} {annual:,.0f} / 年 · 保障 {_esc(cov)}</div>
        <div style="position:absolute;bottom:40px;left:64px;">
            <div style="color:{COLORS['caramel']};font-size:11px;font-weight:bold;">2026 / 06</div>
            <div style="color:{COLORS['coffee_mid']};font-size:9px;margin-top:4px;">汇报人：{meta_short} · 财富管理团队</div>
        </div>
    </div>
    <div class="cover-right">
        <div class="cover-name">VIP</div>
        <div class="cover-relation">M R .</div>
        <div style="width:60px;height:2px;background:{COLORS['gold']};margin:14px auto;"></div>
        <div class="cover-tag">PRIVATE CLIENT</div>
        <div style="margin-top:50px;font-size:14px;color:{COLORS['cream_light']};font-weight:bold;">
            {pay_years}年缴 · {_esc(currency)} {annual/1000:.0f}K
        </div>
        <div style="font-size:11px;color:{COLORS['gold_light']};margin-top:6px;">终身财富传承</div>
    </div>
</section>
"""


def _render_company(data, meta):
    bp = meta.get('brand_profile', {}) or {}
    cards = [
        ('1985', '年', '成立年份', '立足香港近40年'),
        ('A.M. Best', '评级', '财务实力评级', '信用评级稳健 a-'),
        (bp.get('series_label', '—'), '系列', bp.get('series_sub', ''), bp.get('series_products', '')),
    ]
    cards_html = ''
    for val, unit, lbl, sub in cards:
        cards_html += f"""
<div class="metric-card" style="height:140px;">
    <div class="metric-value">{_esc(val)}</div>
    <div class="metric-unit">{_esc(unit)}</div>
    <div class="metric-label" style="margin-top:14px;font-size:12px;color:{COLORS['coffee']};font-weight:bold;">{_esc(lbl)}</div>
    <div class="metric-label">{_esc(sub)}</div>
</div>
"""
    return f"""
<section class="slide">
    {_header_html(2, meta=meta)}
    {_title_html('关于我们', f'About Us  ·  {meta.get("company_name_zh", "保险公司")}', 28)}
    <div class="row">{cards_html}</div>
    <div style="display:flex;gap:32px;margin-top:32px;">
        <div style="flex:1;">
            <div style="border-top:3px solid {COLORS['caramel']};width:24px;margin-bottom:8px;"></div>
            <h3 style="font-size:14px;color:{COLORS['dark_coffee']};margin-bottom:12px;">业务范围</h3>
            <div style="font-size:11.5px;color:{COLORS['coffee']};line-height:1.9;">
                {_lines_or_dash(meta.get('brand_profile', {}).get('business_lines', []))}
            </div>
        </div>
        <div style="flex:1;">
            <div style="border-top:3px solid {COLORS['caramel']};width:24px;margin-bottom:8px;"></div>
            <h3 style="font-size:14px;color:{COLORS['dark_coffee']};margin-bottom:12px;">品牌背景</h3>
            <div style="font-size:11.5px;color:{COLORS['coffee']};line-height:1.9;">
                {_lines_or_dash(meta.get('brand_profile', {}).get('brand_background', []))}
            </div>
        </div>
    </div>
    <div class="source">数据来源：{meta.get('brand_profile', {}).get('data_source', '保险公司官网')}</div>
</section>
"""


def _render_features(no_wd, meta):
    # 动态计算回本年: 第一个 Total > paid_total 的保单年度
    paid = (meta.get('annual_premium', 0) or 0) * (meta.get('payment_years', 5) or 5)
    pb = None
    for y in sorted(int(k) for k in no_wd.keys() if k.isdigit()):
        if no_wd[str(y)].get('Total', 0) >= paid:
            pb = y
            break
    pb = pb or 7  # fallback
    y_pb = no_wd.get(str(pb), {})
    y20 = no_wd.get('20', {}); y30 = no_wd.get('30', {})
    mult_20 = y20.get('Mult', 0); mult_30 = y30.get('Mult', 0)
    items = [
        ('01', '5 年短期缴付', f'只需 5 年完成缴费，<br>后续无需再缴；缓解供款压力', '5', '年缴清'),
        ('02', f'第 {pb} 年快速回本', f'保单年度终结时退保现价<br>超过已缴保费总额，本金安全<br>Y{pb} 现价 USD {y_pb.get("Total", 0):,}', f'Y{pb}', '回本'),
        ('03', '20 年财富复利',
         f'保证 + 非保证现金价值<br>长期复利，稳健增长<br>Y20 约 USD {y20.get("Total", 0):,}',
         f'{mult_20:.2f}x', '20 年倍数'),
        ('04', '30 年财富复利',
         f'持续滚存跨越复利临界点<br>增值潜力可观<br>Y30 约 USD {y30.get("Total", 0):,}',
         f'{mult_30:.2f}x', '30 年倍数'),
    ]
    cards_html = ''
    for no, title, body, kpi, unit in items:
        cards_html += f"""
<div class="feature-card">
    <div class="feature-no">{no}</div>
    <div class="feature-title">{_esc(title)}</div>
    <div class="feature-body">{body}</div>
    <div class="feature-kpi">{kpi}</div>
    <div class="feature-unit">{_esc(unit)}</div>
</div>
"""
    return f"""
<section class="slide">
    {_header_html(3, meta=meta)}
    {_title_html('产品亮点', '5 年缴 · 短期供款完成 · 终身财富复利', 28)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px;">{cards_html}</div>
    <div class="source">注：20/30年倍数基于不退保情形下「退保发还金额总额」÷「已缴保费总额」计算<br>数据来源：{meta.get("company_short", "保险公司")}官方计划书 PDF p2-3 第3部分</div>
</section>
"""


def _render_growth_chart(no_wd, meta):
    # X 轴动态: 真实数据 + 断档提示
    # 规则: 前 30 年全粒度, 后 30 年每 10 年取一个, 总数 ≤ 14
    all_yrs = sorted(int(k) for k in no_wd.keys() if no_wd[k].get('Total', 0) > 0)
    front = [y for y in all_yrs if y <= 30]
    tail = [y for y in all_yrs if y > 30]
    tail_filtered = []
    for y in tail:
        if not tail_filtered or y - tail_filtered[-1] >= 10:
            tail_filtered.append(y)
    if len(front) + len(tail_filtered) > 14:
        front = [y for y in front if y <= 5 or y in (10, 15, 20, 25, 30)]
        tail_filtered = tail_filtered[:4]
    # 真实数据 Y (用于计算和渲染柱子)
    real_yrs = front + tail_filtered
    # 完整序列: 包含 None 占位 (用于 X 轴视觉断档)
    has_gap = bool(front) and bool(tail_filtered) and (tail_filtered[0] - front[-1] > 1)
    yrs = front + [None] + tail_filtered if has_gap else real_yrs
    if not real_yrs:  # fallback
        real_yrs = [1, 5, 10, 20, 30, 50, 70]
        yrs = real_yrs
    max_total = max(no_wd[str(y)]['Total'] for y in real_yrs) or 1
    bars_html = ''
    for y in yrs:
        if y is None:
            # 断档占位: 渲染一个空柱
            bars_html += f"""
<div class="bar-group" style="height:240px;opacity:0.4;">
    <div class="bar-stack" style="height:2px;background:{COLORS['gray_line']};justify-content:center;">
    </div>
    <div class="bar-label" style="color:{COLORS['coffee_mid']};font-size:14px;">…</div>
</div>
"""
            continue
        r = no_wd[str(y)]
        total = r['Total']
        non_g = total - r['Guar_CV']
        h_total = (total / max_total) * 200
        h_non = (non_g / max_total) * 200
        h_guar = (r['Guar_CV'] / max_total) * 200
        bars_html += f"""
<div class="bar-group" style="height:240px;">
    <div class="bar-stack" style="height:{h_total:.0f}px;">
        <div class="bar" style="height:{h_non:.0f}px;background:{COLORS['gold']};" title="非保证"></div>
        <div class="bar" style="height:{h_guar:.0f}px;background:{COLORS['caramel']};" title="保证"></div>
    </div>
    <div class="bar-label">Y{y}<br>({no_wd.get(str(y),{}).get("Age",y)}岁)</div>
</div>
"""
    # 动态回本年 (修复 Y7 硬编码)
    paid = (meta.get('annual_premium', 0) or 0) * (meta.get('payment_years', 5) or 5)
    pb = None
    for y in sorted(int(k) for k in no_wd.keys() if k.isdigit()):
        if no_wd[str(y)].get('Total', 0) >= paid:
            pb = y
            break
    pb = pb or 7
    y_pb = no_wd.get(str(pb), {})
    y20 = no_wd.get('20', {}); y30 = no_wd.get('30', {}); y70 = no_wd.get('70', {})
    callouts = [
        (f'第 {pb} 年', '回本', f'Y{pb} 现价 USD {y_pb.get("Total", 0):,}', COLORS['caramel']),
        ('20 年', f'{y20.get("Mult", 0):.2f}x', f'Y20 约 USD {y20.get("Total", 0):,}', COLORS['caramel_dark']),
        ('30 年', f'{y30.get("Mult", 0):.2f}x', f'Y30 约 USD {y30.get("Total", 0):,}', COLORS['caramel_dark']),
        ('70 年', f'{y70.get("Mult", 0):.0f}x', f'Y70 约 USD {y70.get("Total", 0):,}', COLORS['gold_dark']),
    ]
    callouts_html = ''
    for yr, val, sub, col in callouts:
        callouts_html += f"""
<div class="callout-card" style="border-left-color:{col};">
    <div class="yr">{_esc(yr)}</div>
    <div class="val" style="color:{col};">{_esc(val)}</div>
    <div class="sub">{_esc(sub)}</div>
</div>
"""
    return f"""
<section class="slide">
    {_header_html(4, meta=meta)}
    {_title_html('现金价值长期复利增长（不提领）', '保证 + 非保证现金价值 · 演示至保单年度 80 年（受保人 80 岁）', 22)}
    <div style="display:flex;gap:24px;">
        <div style="flex:2;">
            <div class="bar-chart">{bars_html}</div>
            <div class="legend">
                <div class="legend-item"><div class="legend-box" style="background:{COLORS['caramel']};"></div>保证现价 (USD)</div>
                <div class="legend-item"><div class="legend-box" style="background:{COLORS['gold']};"></div>非保证红利/分红 (USD)</div>
            </div>
        </div>
        <div style="flex:1;">
            <div style="border-top:3px solid {COLORS['caramel']};width:24px;margin-bottom:8px;"></div>
            {callouts_html}
        </div>
    </div>
    <div class="source">数据来源：{meta.get("company_short", "保险公司")}官方计划书 PDF p2-3 第3部分</div>
</section>
"""


def _render_no_withdraw_table(no_wd, paid_total, meta):
    # 动态生成: 每5年展示, 直到保单最大年度
    max_y = max(int(k) for k in no_wd.keys() if k.isdigit()) if no_wd else 70
    interval = 5
    show_yrs = list(range(interval, max_y + 1, interval))
    show_yrs = [y for y in show_yrs if str(y) in no_wd]
    show_yrs = show_yrs[:15]
    rows_html = ''
    for y in show_yrs:
        r = no_wd[str(y)]
        irr = r.get('IRR')
        simple = r.get('Simple')
        rows_html += f"""
<tr>
    <td><strong>{y}</strong></td>
    <td><strong>{y}</strong></td>
    <td class="num">{r.get("Paid", paid_total):,}</td>
    <td class="num guar">{r['Guar_CV']:,}</td>
    <td class="num">{r['Total'] - r['Guar_CV']:,}</td>
    <td class="num total">{r['Total']:,}</td>
    <td class="num irr">{f"{irr*100:.2f}%" if irr else '-'}</td>
    <td class="num">{f"{simple*100:.2f}%" if simple else '-'}</td>
</tr>
"""
    return f"""
<section class="slide">
    {_header_html(5, meta=meta)}
    {_title_html('不提领情形 · 退保发还金额明细', '每 10 年展示 · 含保证 / 非保证构成 · 含单利与 IRR（复利）', 22)}
    <table class="data-table">
        <thead>
            <tr>
                <th>保单年度</th><th>年龄</th><th>已缴保费<br>(USD)</th>
                <th>保证现价<br>(USD)</th><th>非保证金额<br>(USD)</th>
                <th>退保发还总额<br>(USD)</th><th>复利 IRR</th><th>单利IRR</th>
            </tr>
        </thead>
        <tbody>{rows_html}</tbody>
    </table>
    <div class="disclaimer-box">
        <div class="title">数据口径说明</div>
        · 已缴保费：{int(paid_total/1000)}年×计划 = USD {paid_total:,.0f}　　· IRR(M-A, HK IA上限): NPV=0 求解, 现金流 -P(t=0..n-1)+SV(t=year), 港元封顶6.0%/非港元6.5%　　· 单利IRR = (总额-保费)/保费/年数<br>
        · 非保证金额含复归红利+终期分红　　· 演示至保单80年；计划保障至128岁
    </div>
    <div class="source">数据来源：{meta.get("company_short", "保险公司")}官方计划书 PDF p2-3 第3部分</div>
</section>
"""


def _render_withdraw_table(wd, paid_total, meta):
    # 动态起提年: 第一个 Annual_WD > 0 的保单年度
    wd_start = None
    for y in sorted(int(k) for k in wd.keys() if k.isdigit()):
        if wd[str(y)].get('Annual_WD', 0) > 0:
            wd_start = y
            break
    wd_start = wd_start or 7
    max_y = max(int(k) for k in wd.keys() if k.isdigit()) if wd else 80
    # 优先显示的关键年 (含起提年)
    preferred = set(range(5, max_y + 1, 5))
    preferred.add(wd_start)
    if wd_start > 1: preferred.add(wd_start - 1)
    preferred.add(max_y)
    show_yrs = [y for y in preferred if str(y) in wd]
    # 至少保留5个点
    if len(show_yrs) < 5:
        avail = sorted(int(k) for k in wd.keys() if k.isdigit())
        for y in avail:
            if y not in show_yrs:
                show_yrs.append(y)
            if len(show_yrs) >= 8: break
    rows_html = ''
    for y in show_yrs:
        r = wd[str(y)]
        irr = r.get('IRR')
        simple = r.get('Simple')
        total_received = r.get('Total_Received', r.get('Cum_WD', 0) + r.get('Total', 0))
        rows_html += f"""
<tr>
    <td><strong>{y}</strong></td>
    <td><strong>{r['Age']}</strong></td>
    <td class="num">{r.get("Paid", paid_total):,}</td>
    <td class="num annual-wd">{r.get('Annual_WD', 0) or 0:,}</td>
    <td class="num annual-wd">{r.get('Cum_WD', 0):,}</td>
    <td class="num total">{r.get('Total', 0):,}</td>
    <td class="num total" style="color:{COLORS['gold_dark']};">{total_received:,}</td>
    <td class="num irr">{f"{irr*100:.2f}%" if irr else '-'}</td>
    <td class="num">{f"{simple*100:.2f}%" if simple else '-'}</td>
</tr>
"""
    return f"""
<section class="slide">
    {_header_html(6, meta=meta)}
    {_title_html('教育金提领方案 · 退保发还金额及累计提取', f'保单年度 {wd_start} 起每年提取 USD {(wd.get(str(wd_start), {}).get("Annual_WD", 0) or 0):,}（按PDF展示）· 含单利与 IRR', 22)}
    <table class="data-table">
        <thead>
            <tr>
                <th>保单<br>年度</th><th>年龄</th><th>已缴保费</th>
                <th>年提取</th><th>累计提取</th><th>退保发还总额<br>(B+C+D)</th>
                <th>累计已领+<br>退保现价</th><th>复利<br>IRR</th><th>单利<br>IRR</th>
            </tr>
        </thead>
        <tbody>{rows_html}</tbody>
    </table>
    <div class="disclaimer-box">
        <div class="title">数据口径</div>
        · Y{wd_start} 起每年提取 USD {(wd.get(str(wd_start), {}).get("Annual_WD", 0) or 0):,}　　· 累计已领+退保现价 = 年提取累计 + 期末退保发还金额　　· IRR(M-A, HK IA上限): 含每年+aw现金流, NPV=0 求解
    </div>
    <div class="source">数据来源：{meta.get("company_short", "保险公司")}官方计划书 PDF p42-50 第5部分（现金提取）</div>
</section>
"""


def _render_compare_chart(no_wd, wd, meta):
    # 动态起提年
    wd_start = None
    for y in sorted(int(k) for k in wd.keys() if k.isdigit()):
        if wd[str(y)].get('Annual_WD', 0) > 0:
            wd_start = y
            break
    wd_start = wd_start or 7
    yrs = [10, 20, 30, 40, 50, 60, 70, 80]
    yrs = [y for y in yrs if str(y) in no_wd and str(y) in wd]
    max_v = 0
    data = []
    for y in yrs:
        no_t = no_wd[str(y)]['Total']
        w_t = wd[str(y)].get('Total_Received', wd[str(y)].get('Cum_WD', 0) + wd[str(y)].get('Total', 0))
        data.append((y, no_t, w_t))
        max_v = max(max_v, no_t, w_t)
    if not max_v: max_v = 1
    bars_html = ''
    for y, no_t, w_t in data:
        h1 = (no_t / max_v) * 220
        h2 = (w_t / max_v) * 220
        bars_html += f"""
<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:240px;gap:2px;">
    <div style="display:flex;gap:2px;align-items:flex-end;width:100%;justify-content:center;">
        <div class="bar" style="height:{h1:.0f}px;background:{COLORS['caramel']};width:40%;" title="不提领"></div>
        <div class="bar" style="height:{h2:.0f}px;background:{COLORS['gold']};width:40%;" title="提领"></div>
    </div>
    <div class="bar-label">Y{y}<br>({no_wd.get(str(y),{}).get("Age",y)}岁)</div>
</div>
"""
    y_start_w = wd.get(str(wd_start), {}); y20w = wd.get('20', {}); y30w = wd.get('30', {})
    insights = [
        ('提领起始年', f'Y{wd_start}', f'年提 USD {y_start_w.get("Annual_WD", 0):,}', '保单年度第 6 年起'),
        ('本金回正期', f'Y{wd_start-1}', '退保现价充足', '现金流稳定'),
        ('提领期合计', f'Y{wd_start}-Y{wd_start+14}', f'累计 USD {y20w.get("Cum_WD", 0):,}', '已为已缴保费的 1.4x'),
        ('长期复利', 'Y30+', f'剩余 USD {y30w.get("Total", 0):,}', '复利临界点'),
    ]
    insights_html = ''
    for k, v, sub, ex in insights:
        insights_html += f"""
<div class="callout-card" style="height:60px;">
    <div style="flex:1;">
        <div style="font-weight:bold;color:{COLORS['dark_coffee']};font-size:12px;">{_esc(k)}</div>
        <div style="font-size:10px;color:{COLORS['coffee_mid']};margin-top:2px;">{_esc(ex)}</div>
    </div>
    <div style="color:{COLORS['caramel_dark']};font-weight:bold;font-size:14px;text-align:right;">{_esc(v)}</div>
</div>
"""
    return f"""
<section class="slide">
    {_header_html(7, meta=meta)}
    {_title_html('不提领 vs 提领 · 总收益对比', '累计已领 + 期末退保现价 · 关键年限对比', 22)}
    <div style="display:flex;gap:24px;">
        <div style="flex:2;">
            <div style="display:flex;align-items:flex-end;height:260px;border-bottom:2px solid {COLORS['dark_coffee']};border-left:2px solid {COLORS['dark_coffee']};padding:8px;gap:4px;">
                {bars_html}
            </div>
            <div class="legend">
                <div class="legend-item"><div class="legend-box" style="background:{COLORS['caramel']};"></div>不提领 · 退保现价 (USD)</div>
                <div class="legend-item"><div class="legend-box" style="background:{COLORS['gold']};"></div>提领 · 累计+退保现价 (USD)</div>
            </div>
        </div>
        <div style="flex:1;">
            <div style="border-top:3px solid {COLORS['caramel']};width:24px;margin-bottom:8px;"></div>
            <h3 style="font-size:14px;color:{COLORS['dark_coffee']};margin-bottom:12px;">核心洞察</h3>
            {insights_html}
        </div>
    </div>
    <div class="source">注：因金额跨度大，纵轴按相对比例显示；倍数基于已缴保费 USD 500,000<br>数据来源：{meta.get("company_short", "保险公司")}官方计划书 PDF p2-3（不提领）+ p42-50（提领）</div>
</section>
"""


def _render_education(wd, meta):
    def get_data(y):
        if str(y) in wd:
            r = wd[str(y)]
            return {
                'cum': f'USD {r.get("Cum_WD", 0):,}',
                'remain': f'USD {r.get("Total", 0):,}'
            }
        return {'cum': '-', 'remain': '-'}
    # 动态起提年 + 起保年龄 → 算 Age
    wd_start = None
    for y in sorted(int(k) for k in wd.keys() if k.isdigit()):
        if wd[str(y)].get('Annual_WD', 0) > 0:
            wd_start = y
            break
    wd_start = wd_start or 7
    insured_age = meta.get('insured_age', 0) or 0
    def age_of(y): return y + insured_age
    def age_band(lo, hi):
        """返回 [保单年度区间] 使 Age ∈ [lo,hi]"""
        ys = [y for y in sorted(int(k) for k in wd.keys() if k.isdigit()) if lo <= age_of(y) <= hi]
        return ys
    a1 = age_band(6, 12)   # 小学
    a2 = age_band(13, 15)  # 初中
    a3 = age_band(16, 18)  # 高中
    a4 = age_band(19, 22)  # 大学
    a5 = age_band(23, 99)  # 研究生+
    def yr_label(ys):
        if not ys: return '-'
        if len(ys) == 1: return f'Y{ys[0]}'
        return f'Y{ys[0]}-Y{ys[-1]}'
    d12 = get_data(a1[-1] if a1 else 12)
    d15 = get_data(a2[-1] if a2 else 15)
    d18 = get_data(a3[-1] if a3 else 18)
    d22 = get_data(a4[-1] if a4 else 22)
    annual_wd = wd.get(str(wd_start), {}).get('Annual_WD', 0) or 0
    stages = [
        ('6-12岁', '小学', yr_label(a1), d12['cum'], f'每年 {annual_wd//1000}K<br>兴趣班/课外辅导', d12['remain'], COLORS['caramel_light'], 0),
        ('13-15岁', '初中', yr_label(a2), d15['cum'], f'每年 {annual_wd//1000}K<br>升学辅导/素质拓展', d15['remain'], COLORS['caramel'], 1),
        ('16-18岁', '高中', yr_label(a3), d18['cum'], f'每年 {annual_wd//1000}K<br>国际课程/留学预备', d18['remain'], COLORS['caramel_dark'], 2),
        ('19-22岁', '大学', yr_label(a4), d22['cum'], f'每年 {annual_wd//1000}K<br>学费/生活费', d22['remain'], COLORS['gold_dark'], 3),
        ('23+岁', '研究生/创业', yr_label(a5) or 'Y23+', '持续提取', '退保现价持续滚存<br>灵活支取', '持续增长', COLORS['dark_coffee'], 4),
    ]
    cards_html = ''
    for age, name, years, cum, detail, remain, col, idx in stages:
        text_col = COLORS['cream_light'] if idx < 4 else COLORS['gold_light']
        cards_html += f"""
<div class="education-stage">
    <div class="education-header" style="background:{col};">
        <div class="name" style="color:{text_col};">{_esc(name)}</div>
        <div class="age" style="color:{text_col};">{_esc(years)}</div>
    </div>
    <div class="education-body">
        <div class="cum-label">累计已领</div>
        <div class="cum-val" style="color:{col};">{_esc(cum)}</div>
        <div class="detail">{detail}</div>
        <div class="remain">保单现价 {_esc(remain)}</div>
    </div>
</div>
"""
    return f"""
<section class="slide">
    {_header_html(8, meta=meta)}
    {_title_html('教育金现金流 · 与受保人年龄节点结合', f'保单年度 {wd_start} 起每年提取 USD {annual_wd:,} · 从小学到大学的稳健现金流', 22)}
    <div class="timeline">
        <div class="timeline-dot" style="position:relative;"><div class="timeline-age">6-12</div></div>
        <div class="timeline-dot" style="position:relative;"><div class="timeline-age">13-15</div></div>
        <div class="timeline-dot" style="position:relative;"><div class="timeline-age">16-18</div></div>
        <div class="timeline-dot" style="position:relative;"><div class="timeline-age">19-22</div></div>
        <div class="timeline-dot" style="position:relative;"><div class="timeline-age">23+</div></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-top:48px;">{cards_html}</div>
    <div class="source" style="margin-top:24px;">叙事：保单年度 {wd_start}（受保人 {age_of(wd_start)} 岁）开始提领 → 精准覆盖小学到大学教育支出 → 本金持续滚存<br>数据来源：{meta.get("company_short", "保险公司")}官方计划书 PDF p42-50 第5部分</div>
</section>
"""


def _render_disclaimer(meta):
    notes = [
        ('01', '非保证利益', '本计划所演示之非保证金额（包括复归红利及终期分红）乃基于现时假设投资回报计算，并非保证。', '实际金额或会因投资市场波动而调整，在某些情况下非保证金额可能为零。'),
        ('02', '汇率风险', '若以保单货币（美元）以外的其他货币支付保费或收取利益，将按本公司不时厘定的汇率兑换。', '外币汇率波动可能影响实际支付金额。'),
        ('03', '提领限制', '现金提取须符合本公司最低投保单位要求；若提取导致投保单位低于最低要求，则不可提取。', '所演示之提取金额基于非保证红利与分红，未必可维持。'),
        ('04', '通胀风险', '未来生活成本可能因通胀而上升；本计划之金额为名义金额，未必能完全追上通胀。', '建议结合其他投资工具作综合规划。'),
    ]
    cards_html = ''
    for no, t, b1, b2 in notes:
        cards_html += f"""
<div style="background:{COLORS['cream_white']};border-radius:4px;overflow:hidden;box-shadow:0 2px 8px rgba(51,40,37,0.06);height:200px;">
    <div style="background:{COLORS['dark_coffee']};color:{COLORS['cream_light']};padding:12px 16px;display:flex;align-items:center;gap:14px;">
        <div style="color:{COLORS['gold']};font-size:18px;font-weight:bold;">{no}</div>
        <div style="font-size:14px;font-weight:bold;">{_esc(t)}</div>
    </div>
    <div style="padding:14px 16px;font-size:10.5px;color:{COLORS['coffee']};line-height:1.6;">
        <div>{_esc(b1)}</div>
        <div style="margin-top:6px;">{_esc(b2)}</div>
    </div>
</div>
"""
    return f"""
<section class="slide">
    {_header_html(9, meta=meta)}
    {_title_html('重要事项声明', 'Important Notes · 客户须知的风险与限制', 26)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px;">{cards_html}</div>
    <div class="disclaimer-box" style="margin-top:24px;">
        <div class="title">完整条款</div>
        本文件不包含完整的计划条款，详情参阅保单文件及主要产品推销刊物。阁下应向持牌保险中介人查询。
    </div>
</section>
"""


def _render_sources(data, meta):
    rows = [
        ('保障摘要 · 保额/保费/年期', 'PDF p1', '受保人资料 + 投保资料'),
        ('不提领 · 退保发还金额（Y1-Y40）', 'PDF p2', '基本计划-说明摘要（第3部分）'),
        ('不提领 · 退保发还金额（Y41-Y80）', 'PDF p3', '基本计划-说明摘要（第3部分）'),
        ('不提领 · 身故赔偿额说明', 'PDF p17-19', '身故赔偿额-不同投资回报下的说明'),
        ('提领 · 退保发还金额（Y1-Y40）', 'PDF p42-43', '基本计划-说明摘要（续）-现金提取'),
        ('提领 · 退保发还金额（Y41-Y80）', 'PDF p44-45', '基本计划-说明摘要（续）-现金提取'),
        ('提领 · 身故赔偿额说明', 'PDF p47-50', '身故赔偿额下的说明（提取）'),
        ('注释与重要事项', 'PDF p20-22', '本计划之注释条款'),
        ('产品详细说明', 'PDF p23-41', '财富增值选项、跃进选项等'),
    ]
    rows_html = ''
    for item, page, src in rows:
        rows_html += f"""
<tr>
    <td style="text-align:left;font-weight:bold;color:{COLORS['dark_coffee']};">{_esc(item)}</td>
    <td style="color:{COLORS['caramel_dark']};font-weight:bold;">{_esc(page)}</td>
    <td style="text-align:left;color:{COLORS['coffee']};">{_esc(src)}</td>
</tr>
"""
    return f"""
<section class="slide">
    {_header_html(10, meta=meta)}
    {_title_html('数据来源与回溯', 'Data Sources · 全部数据可逐项回溯至官方计划书页码', 26)}
    <table class="data-table">
        <thead>
            <tr>
                <th style="text-align:left;">数据项</th>
                <th>PDF 页码</th>
                <th style="text-align:left;">来源说明</th>
            </tr>
        </thead>
        <tbody>{rows_html}</tbody>
    </table>
    <div class="disclaimer-box">
        <div class="title">核验方法</div>
        所有数据均直接源自{meta.get("company_short", "保险公司")}官方计划书原文（pdfplumber按列精确提取）；如需进一步核验，可逐项对照 PDF 指定页码。
    </div>
</section>
"""


def _render_summary(no_wd, wd, paid_total, meta):
    # 动态回本年 + 起提年
    paid = (meta.get('annual_premium', 0) or 0) * (meta.get('payment_years', 5) or 5)
    pb = None
    for y in sorted(int(k) for k in no_wd.keys() if k.isdigit()):
        if no_wd[str(y)].get('Total', 0) >= paid:
            pb = y; break
    pb = pb or 7
    y_pb = no_wd.get(str(pb), {})
    wd_start = None
    for y in sorted(int(k) for k in wd.keys() if k.isdigit()):
        if wd[str(y)].get('Annual_WD', 0) > 0:
            wd_start = y; break
    wd_start = wd_start or 7
    annual_wd = wd.get(str(wd_start), {}).get('Annual_WD', 0) or 0
    y30 = no_wd.get('30', {}); w20 = wd.get('20', {})
    cards = [
        ('A', '短期供款 · 终身受惠', f'5 年缴清 USD {paid_total:,.0f}，后续无需再缴费。保单持续滚存至 128 岁，长期复利效应明显。', '5', '年缴清'),
        ('B', '稳健回本 · 风险可控', f'保单第 {pb} 年回本（退保现价 > 已缴保费）。Y{pb} 现价 USD {y_pb.get("Total", 0):,}；Y30 约 USD {y30.get("Total", 0):,}。', f'Y{pb}', '回本'),
        ('C', '灵活提领 · 教育无忧', f'Y{wd_start} 起每年提取 USD {annual_wd//1000}K，覆盖小学到大学。Y20 累计提取 USD {w20.get("Cum_WD", 0):,}，本金仍持续滚存。', f'{annual_wd//1000}K', '年提取'),
    ]
    cards_html = ''
    for icon, title, body, metric, unit in cards:
        cards_html += f"""
<div style="background:{COLORS['cream_white']};border-radius:6px;overflow:hidden;box-shadow:0 2px 8px rgba(51,40,37,0.06);height:340px;">
    <div style="background:{COLORS['dark_coffee']};color:{COLORS['cream_light']};padding:14px 18px;display:flex;align-items:center;gap:12px;">
        <div style="width:32px;height:32px;background:{COLORS['caramel']};color:{COLORS['cream_light']};display:flex;align-items:center;justify-content:center;font-weight:bold;border-radius:2px;">{icon}</div>
        <div style="font-size:14px;font-weight:bold;">{_esc(title)}</div>
    </div>
    <div style="padding:18px;font-size:11px;color:{COLORS['coffee']};line-height:1.7;">{body}</div>
    <div style="text-align:center;padding:20px;">
        <div style="font-size:36px;font-weight:bold;color:{COLORS['caramel']};">{metric}</div>
        <div style="font-size:10px;color:{COLORS['coffee_mid']};margin-top:4px;">{_esc(unit)}</div>
    </div>
</div>
"""
    return f"""
<section class="slide">
    {_header_html(11, meta=meta)}
    {_title_html('总结与建议', 'Summary & Recommendation', 26)}
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:12px;">{cards_html}</div>
    <div class="disclaimer-box" style="margin-top:20px;">
        <div class="title">综合建议</div>
        本计划适合具备 5 年供款能力、追求稳健长期财富传承、且有子女教育金规划需求的高净值家庭。<br>
        · 短期供款压力适中　· 长期复利跨越代际　· 提领方案精准对接教育节点　· 兼顾传承与流动性<br>
        实际收益取决于投资市场表现，建议结合整体资产配置作综合考虑。
    </div>
</section>
"""


def _render_ending(s, meta):
    name = s.get('insured_name', 'VIP 先生') or 'VIP 先生'
    age = s.get('insured_age', 1)
    meta_brand = _mbrand(meta)
    return f"""
<section class="slide ending-cover">
    <div style="font-size:12px;color:{COLORS['gold']};font-weight:bold;letter-spacing:2px;">{meta_brand}</div>
    <div style="margin:80px 0 20px;">愿这份规划</div>
    <h1>陪伴孩子稳健成长</h1>
    <h2>让爱与财富，代代相传</h2>
    <div class="rule"></div>
    <div class="greeting">—— 致 {_esc(name)} 与家人  ——</div>
    <div style="font-size:11px;color:{COLORS['gold_light']};">规划起点 · 受保人 {age} 岁</div>
    <div class="footer">本演示基于{meta.get("company_short", "保险公司")}官方计划书数据生成 · 实际保单条款以保单文件为准</div>
    <div style="margin-top:8px;font-size:10px;color:{COLORS['gold_light']};">12 / 12</div>
</section>
"""


def render_html(data: Dict, output_path: str) -> str:
    """主入口: 生成单文件HTML"""
    summary = data['summary']
    no_wd = data['no_withdraw']
    wd = data['withdraw']
    paid_total = data['paid_total']
    meta = data.get('meta', {})

    html_body = f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{meta.get("company_short", "储蓄计划")} 储蓄计划 · 客户版</title>
<style>{_css()}</style>
</head>
<body>
<div class="toolbar" onclick="window.print()">🖨 打印 / PDF</div>
<div class="deck">
{_render_cover(summary, no_wd, paid_total, meta)}
{_render_company(data, meta)}
{_render_features(no_wd, meta)}
{_render_growth_chart(no_wd, meta)}
{_render_no_withdraw_table(no_wd, paid_total, meta)}
{_render_withdraw_table(wd, paid_total, meta)}
{_render_compare_chart(no_wd, wd, meta)}
{_render_education(wd, meta)}
{_render_disclaimer(meta)}
{_render_sources(data, meta)}
{_render_summary(no_wd, wd, paid_total, meta)}
{_render_ending(summary, meta)}
</div>
<script>
document.addEventListener('keydown', e => {{
    if (e.key === 'ArrowDown' || e.key === ' ') {{
        const slides = document.querySelectorAll('.slide');
        const visible = Array.from(slides).find(s => {{
            const r = s.getBoundingClientRect();
            return r.top > window.innerHeight / 3;
        }});
        if (visible) visible.scrollIntoView({{ behavior: 'smooth' }});
        e.preventDefault();
    }}
}});
</script>
</body>
</html>
"""
    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html_body)
    return output_path
