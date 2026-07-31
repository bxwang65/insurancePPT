#!/usr/bin/env python3
"""
SlideRenderer — Playwright截图管线
将HTML模板渲染为PNG背景图，用于嵌入PPT

配色方案: 深海蓝#0A3C5F + 青绿#18898D + 金色#C9A027
中文字体: Heiti TC (macOS内置)

使用方法:
    renderer = SlideRenderer()
    png_path = renderer.render_slide({
        "type": "area_chart",
        "title": "账户价值增长",
        "data": {"years": [5,10,15,20], "values": [100,150,200,280]},
        "narrative": "复利效应让财富持续增值"
    })
"""

import os
import sys
import json
import base64
import asyncio
from pathlib import Path
from typing import Optional

# 品牌配色
BRAND_COLORS = {
    "primary": "#0A3C5F",      # 深海蓝
    "accent_teal": "#18898D",  # 青绿
    "accent_gold": "#C9A027",  # 金色
    "text_dark": "#1A1A2E",
    "text_light": "#FFFFFF",
    "bg_light": "#F8F9FA",
    "bg_card": "#FFFFFF",
}

FONT_FAMILY = "'Heiti TC', 'STHeiti', 'PingFang TC', 'Microsoft YaHei', sans-serif"

# ─── HTML模板 ──────────────────────────────────────────────

TEMPLATE_AREA_CHART = """<!DOCTYPE html>
<html lang="zh-HK">
<head>
<meta charset="UTF-8">
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ 
  font-family: {font}; 
  width: 1280px; height: 720px; 
  background: linear-gradient(135deg, {primary} 0%, #0D4F7A 100%);
  display: flex; flex-direction: column; padding: 40px;
}}
.header {{
  display: flex; align-items: center; margin-bottom: 24px;
}}
.accent-bar {{
  width: 6px; height: 48px; background: {gold}; border-radius: 3px;
  margin-right: 20px;
}}
.page-title {{
  font-size: 28px; font-weight: 600; color: {white}; letter-spacing: 1px;
}}
.chart-container {{
  flex: 1; display: flex; gap: 40px; align-items: stretch;
}}
.chart-area {{
  flex: 1; background: rgba(255,255,255,0.08); border-radius: 16px;
  padding: 24px; position: relative; display: flex; flex-direction: column;
}}
.narrative-card {{
  width: 320px; background: {white}; border-radius: 16px; padding: 28px;
  display: flex; flex-direction: column; justify-content: center;
}}
.narrative-label {{
  font-size: 13px; color: {teal}; font-weight: 600; letter-spacing: 2px;
  text-transform: uppercase; margin-bottom: 12px;
}}
.narrative-text {{
  font-size: 20px; color: {dark}; line-height: 1.6; font-weight: 500;
}}
.highlights {{
  margin-top: 24px; padding-top: 20px; border-top: 1px solid #EEE;
}}
.highlight-item {{
  display: flex; justify-content: space-between; margin: 8px 0;
  font-size: 14px;
}}
.highlight-label {{ color: #888; }}
.highlight-value {{ color: {teal}; font-weight: 700; font-size: 16px; }}
canvas {{ flex: 1; }}
</style>
</head>
<body>
<div class="header">
  <div class="accent-bar"></div>
  <div class="page-title">{title}</div>
</div>
<div class="chart-container">
  <div class="chart-area">
    <canvas id="chart"></canvas>
  </div>
  <div class="narrative-card">
    <div class="narrative-label">核心叙事</div>
    <div class="narrative-text">{narrative}</div>
    <div class="highlights">
      {highlights_html}
    </div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script>
const ctx = document.getElementById('chart').getContext('2d');
const gradient = ctx.createLinearGradient(0, 0, 0, 400);
gradient.addColorStop(0, 'rgba(24,137,141,0.6)');
gradient.addColorStop(1, 'rgba(24,137,141,0.05)');

new Chart(ctx, {{
  type: 'line',
  data: {{
    labels: {years_json},
    datasets: [{{
      label: '账户价值',
      data: {values_json},
      fill: true,
      backgroundColor: gradient,
      borderColor: '{teal}',
      borderWidth: 3,
      pointBackgroundColor: '{gold}',
      pointBorderColor: '{white}',
      pointBorderWidth: 2,
      pointRadius: 6,
      pointHoverRadius: 8,
      tension: 0.4
    }}]
  }},
  options: {{
    responsive: true,
    maintainAspectRatio: false,
    plugins: {{
      legend: {{ display: false }},
      tooltip: {{
        backgroundColor: '{primary}',
        titleColor: '{white}',
        bodyColor: '{white}',
        padding: 12,
        cornerRadius: 8,
        callbacks: {{
          label: ctx => `HK$ ${{ctx.raw.toLocaleString()}}`
        }}
      }}
    }},
    scales: {{
      x: {{
        grid: {{ color: 'rgba(255,255,255,0.1)' }},
        ticks: {{ color: 'rgba(255,255,255,0.7)', font: {{ size: 12 }} }}
      }},
      y: {{
        grid: {{ color: 'rgba(255,255,255,0.1)' }},
        ticks: {{
          color: 'rgba(255,255,255,0.7)',
          font: {{ size: 12 }},
          callback: v => `HK$ ${{(v/1000).toFixed(0)}}K`
        }}
      }}
    }}
  }}
}});
</script>
</body>
</html>"""


TEMPLATE_KPI_CARDS = """<!DOCTYPE html>
<html lang="zh-HK">
<head>
<meta charset="UTF-8">
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
  font-family: {font};
  width: 1280px; height: 720px;
  background: linear-gradient(135deg, {primary} 0%, #0D4F7A 100%);
  display: flex; flex-direction: column; padding: 48px;
}}
.header {{
  display: flex; align-items: center; margin-bottom: 36px;
}}
.accent-bar {{
  width: 6px; height: 48px; background: {gold}; border-radius: 3px;
  margin-right: 20px;
}}
.page-title {{
  font-size: 28px; font-weight: 600; color: {white}; letter-spacing: 1px;
}}
.kpi-grid {{
  flex: 1; display: grid; grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(2, 1fr);
  gap: 24px;
}}
.kpi-card {{
  background: {white}; border-radius: 20px; padding: 28px;
  display: flex; flex-direction: column; justify-content: space-between;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
  transition: transform 0.2s;
}}
.kpi-card:hover {{ transform: translateY(-4px); }}
.kpi-label {{
  font-size: 13px; color: #888; letter-spacing: 2px; text-transform: uppercase;
}}
.kpi-value {{
  font-size: 42px; font-weight: 700; color: {teal}; line-height: 1.1;
}}
.kpi-unit {{
  font-size: 16px; color: {gold}; font-weight: 600; margin-left: 4px;
}}
.kpi-sub {{
  font-size: 13px; color: #AAA; margin-top: 4px;
}}
.narrative {{
  margin-top: 32px; text-align: center;
}}
.narrative-text {{
  font-size: 22px; color: rgba(255,255,255,0.9); font-weight: 500;
  letter-spacing: 1px;
}}
</style>
</head>
<body>
<div class="header">
  <div class="accent-bar"></div>
  <div class="page-title">{title}</div>
</div>
<div class="kpi-grid">
  {kpi_cards_html}
</div>
<div class="narrative">
  <div class="narrative-text">{narrative}</div>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
</body>
</html>"""


TEMPLATE_COMPARISON = """<!DOCTYPE html>
<html lang="zh-HK">
<head>
<meta charset="UTF-8">
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
  font-family: {font};
  width: 1280px; height: 720px;
  background: linear-gradient(135deg, {primary} 0%, #0D4F7A 100%);
  display: flex; flex-direction: column; padding: 40px;
}}
.header {{
  display: flex; align-items: center; margin-bottom: 28px;
}}
.accent-bar {{
  width: 6px; height: 48px; background: {gold}; border-radius: 3px;
  margin-right: 20px;
}}
.page-title {{
  font-size: 28px; font-weight: 600; color: {white}; letter-spacing: 1px;
}}
.comparison-container {{
  flex: 1; display: flex; gap: 20px;
}}
.product-col {{
  flex: 1; background: {white}; border-radius: 20px; padding: 28px;
  display: flex; flex-direction: column;
}}
.product-badge {{
  display: inline-block; padding: 6px 16px; border-radius: 20px;
  font-size: 13px; font-weight: 600; letter-spacing: 1px;
  margin-bottom: 20px; align-self: flex-start;
}}
.product-name {{
  font-size: 22px; font-weight: 700; color: {dark}; margin-bottom: 16px;
}}
.comparison-table {{
  flex: 1;
}}
.row {{
  display: flex; justify-content: space-between; padding: 14px 0;
  border-bottom: 1px solid #F0F0F0; font-size: 14px;
}}
.row:last-child {{ border-bottom: none; }}
.row-label {{ color: #888; }}
.row-value {{ color: {dark}; font-weight: 600; }}
.highlight-row {{
  background: linear-gradient(90deg, rgba(24,137,141,0.08), transparent);
  border-radius: 8px; padding: 14px 12px;
}}
.narrative-bar {{
  margin-top: 24px; background: linear-gradient(135deg, {teal}, {primary});
  color: {white}; padding: 20px; border-radius: 12px; text-align: center;
}}
.narrative-text {{ font-size: 18px; font-weight: 500; }}
</style>
</head>
<body>
<div class="header">
  <div class="accent-bar"></div>
  <div class="page-title">{title}</div>
</div>
<div class="comparison-container">
  {columns_html}
</div>
<div class="narrative-bar">
  <div class="narrative-text">{narrative}</div>
</div>
</body>
</html>"""


# ─── SlideRenderer主类 ──────────────────────────────────────

class SlideRenderer:
    """Playwright截图管线"""

    def __init__(
        self,
        output_dir: str = "/tmp/slide_renders",
        viewport_width: int = 1280,
        viewport_height: int = 720,
        timeout_ms: int = 30000,
    ):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.viewport_width = viewport_width
        self.viewport_height = viewport_height
        self.timeout_ms = timeout_ms
        self._playwright = None
        self._browser = None

    # ─── Playwright生命周期 ────────────────────────────────

    async def _ensure_playwright(self):
        """懒加载Playwright"""
        if self._playwright is None:
            from playwright.async_api import async_playwright
            self._playwright = await async_playwright().start()
        if self._browser is None:
            self._browser = await self._playwright.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox"]
            )

    async def _close(self):
        """关闭浏览器"""
        if self._browser:
            await self._browser.close()
            self._browser = None

    # ─── 核心渲染方法 ──────────────────────────────────────

    async def render_async(self, slide_spec: dict) -> str:
        """
        异步渲染一张幻灯片
        slide_spec: {
            "type": "area_chart" | "kpi_cards" | "comparison" | "table",
            "title": str,
            "narrative": str,
            "data": {...}  # 类型相关数据
        }
        返回: PNG文件路径
        """
        await self._ensure_playwright()

        html = self._build_html(slide_spec)
        page = await self._browser.new_page(
            viewport={"width": self.viewport_width, "height": self.viewport_height}
        )

        try:
            await page.set_content(html, timeout=self.timeout_ms)
            # 等待Chart.js渲染完成
            if slide_spec.get("type") in ("area_chart", "line_chart", "bar_chart"):
                await page.wait_for_function(
                    "typeof Chart !== 'undefined' && document.querySelectorAll('canvas').length > 0",
                    timeout=10000
                )
                # 额外等待动画
                await asyncio.sleep(1.5)

            # 生成PNG
            output_path = self.output_dir / f"slide_{slide_spec.get('_id', 'tmp')}.png"
            await page.screenshot(
                path=str(output_path),
                type="png",
                full_page=False,
            )
            return str(output_path)

        finally:
            await page.close()

    def render(self, slide_spec: dict) -> str:
        """同步封装"""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # 没有运行中的loop，创建新的
            return asyncio.run(self.render_async(slide_spec))
        else:
            # 已有loop，在新线程中运行
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(asyncio.run, self.render_async(slide_spec))
                return future.result()

    # ─── HTML构建 ─────────────────────────────────────────

    def _build_html(self, spec: dict) -> str:
        t = spec["type"]
        title = spec.get("title", "")
        narrative = spec.get("narrative", "")

        common = {
            "font": FONT_FAMILY,
            "primary": BRAND_COLORS["primary"],
            "teal": BRAND_COLORS["accent_teal"],
            "gold": BRAND_COLORS["accent_gold"],
            "white": BRAND_COLORS["text_light"],
            "dark": BRAND_COLORS["text_dark"],
        }

        if t in ("area_chart", "line_chart"):
            return self._build_area_chart(spec, title, narrative, common)
        elif t == "kpi_cards":
            return self._build_kpi_cards(spec, title, narrative, common)
        elif t == "comparison":
            return self._build_comparison(spec, title, narrative, common)
        elif t == "table":
            return self._build_table(spec, title, narrative, common)
        else:
            return self._build_simple(spec, title, narrative, common)

    def _build_area_chart(self, spec, title, narrative, c):
        data = spec.get("data", {})
        years = data.get("years", list(range(1, 21)))
        values = data.get("values", [100] * len(years))

        highlights = spec.get("highlights", [])
        highlights_html = ""
        for h in highlights[:4]:
            if isinstance(h, dict):
                highlights_html += f"""
        <div class="highlight-item">
          <span class="highlight-label">{h.get('label','')}</span>
          <span class="highlight-value">{h.get('value','')}</span>
        </div>"""
            else:
                highlights_html += f"""
        <div class="highlight-item">
          <span class="highlight-label">{h}</span>
          <span class="highlight-value">—</span>
        </div>"""

        return TEMPLATE_AREA_CHART.format(
            title=title,
            narrative=narrative,
            years_json=json.dumps(years),
            values_json=json.dumps(values),
            highlights_html=highlights_html,
            **c
        )

    def _build_kpi_cards(self, spec, title, narrative, c):
        cards = spec.get("kpis", [])
        cards_html = ""
        for kpi in cards:
            badge_color = kpi.get("badge_color", c["teal"])
            cards_html += f"""
    <div class="kpi-card">
      <div class="kpi-label">{kpi.get('label','')}</div>
      <div class="kpi-value">{kpi.get('value','')}<span class="kpi-unit">{kpi.get('unit','')}</span></div>
      <div class="kpi-sub">{kpi.get('sub','')}</div>
    </div>"""

        return TEMPLATE_KPI_CARDS.format(
            title=title,
            narrative=narrative,
            kpi_cards_html=cards_html,
            **c
        )

    def _build_comparison(self, spec, title, narrative, c):
        columns = spec.get("columns", [])
        columns_html = ""
        for col in columns:
            badge_color = col.get("badge_color", c["teal"])
            rows_html = ""
            for row in col.get("rows", []):
                rows_html += f"""
      <div class="row">
        <span class="row-label">{row.get('label','')}</span>
        <span class="row-value">{row.get('value','')}</span>
      </div>"""

            columns_html += f"""
  <div class="product-col">
    <div class="product-badge" style="background:{badge_color}20; color:{badge_color}">
      {col.get('badge','')}
    </div>
    <div class="product-name">{col.get('name','')}</div>
    <div class="comparison-table">{rows_html}</div>
  </div>"""

        return TEMPLATE_COMPARISON.format(
            title=title,
            narrative=narrative,
            columns_html=columns_html,
            **c
        )

    def _build_table(self, spec, title, narrative, c):
        # 简化表格模板
        rows = spec.get("rows", [])
        header = spec.get("header", [])
        header_html = "".join(f"<th>{h}</th>" for h in header)
        rows_html = ""
        for row in rows:
            rows_html += "<tr>" + "".join(f"<td>{v}</td>" for v in row) + "</tr>"

        return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: {c['font']}; width: 1280px; height: 720px;
  background: linear-gradient(135deg, {c['primary']} 0%, #0D4F7A 100%);
  display: flex; flex-direction: column; padding: 40px; }}
.header {{ display: flex; align-items: center; margin-bottom: 28px; }}
.accent-bar {{ width: 6px; height: 48px; background: {c['gold']}; border-radius: 3px; margin-right: 20px; }}
.page-title {{ font-size: 28px; font-weight: 600; color: {c['white']}; }}
.table-wrap {{ flex: 1; background: white; border-radius: 16px; overflow: hidden; }}
table {{ width: 100%; border-collapse: collapse; }}
th {{ background: {c['primary']}; color: white; padding: 16px 20px; text-align: left; font-size: 14px; letter-spacing: 1px; }}
td {{ padding: 14px 20px; border-bottom: 1px solid #F0F0F0; font-size: 14px; color: {c['dark']}; }}
tr:last-child td {{ border-bottom: none; }}
tr:nth-child(even) td {{ background: #F8F9FA; }}
.narrative {{ margin-top: 24px; text-align: center; }}
.narrative-text {{ font-size: 20px; color: rgba(255,255,255,0.9); font-weight: 500; }}
</style></head>
<body>
<div class="header"><div class="accent-bar"></div><div class="page-title">{title}</div></div>
<div class="table-wrap"><table><thead><tr>{header_html}</tr></thead><tbody>{rows_html}</tbody></table></div>
<div class="narrative"><div class="narrative-text">{narrative}</div></div>
</body></html>"""

    def _build_simple(self, spec, title, narrative, c):
        return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: {c['font']}; width: 1280px; height: 720px;
  background: linear-gradient(135deg, {c['primary']} 0%, #0D4F7A 100%);
  display: flex; align-items: center; justify-content: center; flex-direction: column; padding: 48px; }}
.accent-bar {{ width: 8px; height: 64px; background: {c['gold']}; border-radius: 4px; margin-bottom: 32px; }}
.page-title {{ font-size: 36px; font-weight: 700; color: {c['white']}; text-align: center; margin-bottom: 20px; }}
.narrative-text {{ font-size: 22px; color: rgba(255,255,255,0.85); text-align: center; max-width: 800px; line-height: 1.6; }}
</style></head>
<body>
<div class="accent-bar"></div>
<div class="page-title">{title}</div>
<div class="narrative-text">{narrative}</div>
</body></html>"""


# ─── 批量渲染 ──────────────────────────────────────────────

async def render_all_slides(slide_specs: list[dict], output_dir: str = "/tmp/slide_renders") -> list[str]:
    """批量渲染多张幻灯片"""
    renderer = SlideRenderer(output_dir=output_dir)
    paths = []
    for i, spec in enumerate(slide_specs):
        spec["_id"] = i
        try:
            path = await renderer.render_async(spec)
            paths.append(path)
            print(f"  ✓ Slide {i+1}: {path}")
        except Exception as e:
            print(f"  ✗ Slide {i+1} failed: {e}")
            paths.append("")
    await renderer._close()
    return paths


def render_all_slides_sync(slide_specs: list[dict], output_dir: str = "/tmp/slide_renders") -> list[str]:
    """批量渲染（同步封装）"""
    return asyncio.get_event_loop().run_until_complete(render_all_slides(slide_specs, output_dir))


# ─── CLI入口 ──────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="SlideRenderer — Playwright截图管线")
    parser.add_argument("--spec", type=str, help="JSON格式的幻灯片规格")
    parser.add_argument("--spec-file", type=str, help="幻灯片规格JSON文件")
    parser.add_argument("--output-dir", type=str, default="/tmp/slide_renders")
    args = parser.parse_args()

    if args.spec:
        spec = json.loads(args.spec)
        renderer = SlideRenderer(output_dir=args.output_dir)
        path = asyncio.get_event_loop().run_until_complete(renderer.render_async(spec))
        print(path)
        asyncio.get_event_loop().run_until_complete(renderer._close())
    elif args.spec_file:
        with open(args.spec_file) as f:
            specs = json.load(f)
        paths = render_all_slides_sync(specs, args.output_dir)
        print("\\n".join(paths))
    else:
        # 测试模式：渲染示例幻灯片
        test_specs = [
            {
                "_id": 0,
                "type": "area_chart",
                "title": "账户价值增长",
                "narrative": "时间是最好的朋友，复利是最大的杠杆",
                "data": {
                    "years": [1, 5, 10, 15, 20, 25, 30],
                    "values": [500000, 580000, 720000, 950000, 1350000, 1900000, 2800000]
                },
                "highlights": [
                    {"label": "回本年份", "value": "第5年"},
                    {"label": "20年倍数", "value": "2.7x"},
                    {"label": "30年倍数", "value": "5.6x"},
                    {"label": "IRR", "value": "6.2%"}
                ]
            },
            {
                "_id": 1,
                "type": "kpi_cards",
                "title": "方案核心指标",
                "narrative": "用数据说话，让选择更清晰",
                "kpis": [
                    {"label": "年缴保费", "value": "100,000", "unit": "USD", "sub": "每年"},
                    {"label": "缴费期", "value": "5", "unit": "年", "sub": "短期规划"},
                    {"label": "回本年份", "value": "7", "unit": "年", "sub": "快速回本"},
                    {"label": "20年账户价值", "value": "135", "unit": "万USD", "sub": "稳健增值"},
                    {"label": "30年账户价值", "value": "280", "unit": "万USD", "sub": "代代传承"},
                    {"label": "预期IRR", "value": "6.2", "unit": "%", "sub": "超越定存"},
                ]
            }
        ]
        print("Testing SlideRenderer with sample slides...")
        paths = render_all_slides_sync(test_specs, args.output_dir)
        print("\nRendered files:")
        for p in paths:
            if p:
                size = os.path.getsize(p)
                print(f"  {p} ({size:,} bytes)")
