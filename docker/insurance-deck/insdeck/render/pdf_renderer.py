"""
PDF 渲染器 - 通过 Chrome headless 把 HTML 转 PDF
如Chrome不可用, 降级到 weasyprint
"""
import os
import subprocess
import shutil
import tempfile
from typing import Dict


def _try_chrome_html_to_pdf(html_path: str, pdf_path: str) -> bool:
    """尝试用 Chrome headless 转 PDF (注意: headless --print-to-pdf 不触发 @media print)

    顺序: 1) Playwright (chromium headless shell, 不被 macOS jetsam 杀)
          2) 系统 Google Chrome (--print-to-pdf, 在某些 macOS 会被 SIGKILL)
          3) weasyprint (依赖 libgobject)
    """
    # 0) 预处理 HTML
    import re as _re, tempfile as _tmp
    with open(html_path, 'r', encoding='utf-8') as f:
        html = f.read()
    html = _re.sub(r'<div class="toolbar"[^>]*>.*?</div>', '', html, flags=_re.DOTALL)
    html = _re.sub(
        r"font-family:\s*'STHeiti Medium',\s*'PingFang SC',\s*'Microsoft YaHei',\s*'Calibri',\s*sans-serif",
        "font-family: 'Hiragino Sans GB', 'Heiti SC', 'STHeiti Medium', 'PingFang SC', 'Microsoft YaHei', 'Calibri', sans-serif",
        html
    )
    page_style = '''<style>
@page { size: 1280px 720px; margin: 0; }
.slide { page-break-after: always; box-shadow: none !important; }
.slide:last-child { page-break-after: auto; }
</style>'''
    if '</head>' in html:
        html = html.replace('</head>', page_style + '</head>')
    else:
        html = page_style + html
    pdf_safe_html = _tmp.mktemp(suffix='.html')
    with open(pdf_safe_html, 'w', encoding='utf-8') as f:
        f.write(html)
    file_url = f'file://{pdf_safe_html}'

    # 1) Playwright (优先, 不被 macOS jetsam 杀)
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
            except Exception:
                # 无 chromium 时降级
                raise
            try:
                page = browser.new_page(viewport={'width': 1280, 'height': 720})
                page.goto(file_url, wait_until='networkidle', timeout=30000)
                page.pdf(path=pdf_path, width='1280px', height='720px',
                         margin={'top': '0', 'right': '0', 'bottom': '0', 'left': '0'},
                         print_background=True)
            finally:
                browser.close()
        if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 1000:
            return True
    except Exception as e:
        # 静默失败, 尝试下一个
        pass

    # 2) 系统 Chrome (可能被 macOS 杀, 但有时也能用)
    chrome_paths = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        shutil.which("google-chrome"),
        shutil.which("chromium"),
        shutil.which("chrome"),
    ]
    chrome = next((p for p in chrome_paths if p and os.path.exists(p)), None)
    if chrome:
        try:
            result = subprocess.run(
                [chrome, '--headless', '--disable-gpu', '--no-sandbox',
                 '--no-pdf-header-footer',
                 '--font-render-hinting=none',
                 '--enable-font-antialiasing',
                 '--disable-dev-shm-usage',
                 '--virtual-time-budget=10000',
                 f'--print-to-pdf={pdf_path}', file_url],
                capture_output=True, timeout=180
            )
            if result.returncode == 0 and os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 1000:
                return True
        except (subprocess.TimeoutExpired, Exception):
            pass

    # 3) weasyprint
    return _try_weasyprint_raw(html, pdf_path)
    # 临时文件最后清理
    try: os.unlink(pdf_safe_html)
    except: pass


def _try_weasyprint_raw(html: str, pdf_path: str) -> bool:
    """weasyprint 渲染预处理后的 HTML (toolbar 已移除, page style 已注入)"""
    try:
        from weasyprint import HTML
        import tempfile as _tmp
        wp_html = _tmp.mktemp(suffix='.html')
        with open(wp_html, 'w', encoding='utf-8') as f:
            f.write(html)
        try:
            HTML(filename=wp_html).write_pdf(pdf_path)
        finally:
            try: os.unlink(wp_html)
            except: pass
        return os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 1000
    except Exception:
        return False


def _try_weasyprint(html_path: str, pdf_path: str) -> bool:
    """降级: weasyprint (中文支持好, 但无 headless Chrome 的 toolbar/字体问题)"""
    try:
        from weasyprint import HTML
        # 同 Chrome 路径: 移除 toolbar, 注入 page style
        import re as _re
        with open(html_path, 'r', encoding='utf-8') as f:
            html = f.read()
        html = _re.sub(r'<div class="toolbar"[^>]*>.*?</div>', '', html, flags=_re.DOTALL)
        # weasyprint 字体 fallback 比 Chrome headless 更可靠
        # macOS: 'Hiragino Sans GB' / 'Heiti SC' 都能找到
        page_style = '''<style>
@page { size: 1280px 720px; margin: 0; }
.slide { page-break-after: always; box-shadow: none !important; }
.slide:last-child { page-break-after: auto; }
</style>'''
        if '</head>' in html:
            html = html.replace('</head>', page_style + '</head>')
        import tempfile as _tmp
        wp_html = _tmp.mktemp(suffix='.html')
        with open(wp_html, 'w', encoding='utf-8') as f:
            f.write(html)
        try:
            HTML(filename=wp_html).write_pdf(pdf_path)
        finally:
            try: os.unlink(wp_html)
            except: pass
        return os.path.exists(pdf_path)
    except Exception:
        return False


def render_pdf(data: Dict, output_path: str, html_path: str = None) -> str:
    """
    主入口: HTML → PDF
    如果有html_path则用之, 否则先调 html_renderer 生成临时HTML
    """
    from .html_renderer import render_html
    if html_path and os.path.exists(html_path):
        tmp_html = html_path
        cleanup = False
    else:
        tmp_html = tempfile.mktemp(suffix='.html')
        render_html(data, tmp_html)
        cleanup = True
    try:
        if _try_chrome_html_to_pdf(tmp_html, output_path):
            return output_path
        if _try_weasyprint(tmp_html, output_path):
            return output_path
        raise RuntimeError("PDF 渲染失败：未找到 Chrome / weasyprint")
    finally:
        if cleanup and os.path.exists(tmp_html):
            os.unlink(tmp_html)
