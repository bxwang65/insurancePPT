"""
CLI 主入口: 4步引导交互
1. 上传PDF
2. 选公司+产品 (自动检测, 需确认)
3. 自动提取+验证+预览
4. 选择导出格式 (PPTX/HTML/JSON/PDF/全部)
"""
import os
import sys
import json
from pathlib import Path
from typing import Optional

from .config.company_kb import detect_company_product, list_all_products, COMPANIES
from .extract.savings_normalizer import build_normalized_data
from .render.pptx_renderer import render_pptx
from .render.html_renderer import render_html
from .render.json_renderer import render_json
from .render.pdf_renderer import render_pdf


def _prompt(msg: str, default: str = '') -> str:
    """带默认值的输入"""
    suffix = f' [{default}]' if default else ''
    val = input(f'{msg}{suffix}: ').strip()
    return val or default


def _confirm(msg: str, default: bool = True) -> bool:
    suffix = '[Y/n]' if default else '[y/N]'
    val = input(f'{msg} {suffix}: ').strip().lower()
    if not val: return default
    return val in ('y', 'yes', '是', 'Y')


def _print_fidelity(msgs):
    print()
    print('─' * 50)
    print('Fidelity Check')
    print('─' * 50)
    for m in msgs:
        print(f'  {m}')


def _safe_filename(name: str) -> str:
    """清掉危险字符"""
    import re
    s = re.sub(r'[<>:"/\\|?*\n\r\t]', '', name)
    s = re.sub(r'\s+', '_', s)
    return s[:80]


def cmd_detect(pdf_path: str, auto: bool = False) -> Optional[dict]:
    """步骤 1+2: 检测公司+产品"""
    from .extract.pdf_reader import get_first_n_pages_text
    print()
    print('─' * 50)
    print(f'正在扫描: {pdf_path}')
    print('─' * 50)
    text = get_first_n_pages_text(pdf_path, 2)
    result = detect_company_product(text)
    if not result:
        print('✗ 自动检测失败')
        print()
        print('  可手动选择以下产品:')
        for p in list_all_products():
            print(f'    - {p["company_zh"]} / {p["product_zh"]} ({p["product_code"]})')
        return None
    comp_id, prod_code, prod_info = result
    comp = COMPANIES[comp_id]
    print(f'  ✓ 公司: {comp["short"]} ({comp["name_zh"]})')
    print(f'  ✓ 产品: {prod_info["name_zh"]}')
    print(f'  ✓ 计划代号: {prod_code}')
    print(f'  ✓ 货币: {prod_info["currency"]}')
    if not auto and not _confirm('  确认?', default=True):
        return None
    return {'company_id': comp_id, 'product_code': prod_code, 'product_info': prod_info}


def cmd_extract_and_preview(pdf_path: str, sel: dict) -> dict:
    """步骤 3: 提取+校验"""
    print()
    print('─' * 50)
    print('正在提取 + 验证 (约 8-12 秒) ...')
    print('─' * 50)
    data = build_normalized_data(pdf_path, sel['company_id'], sel['product_code'], sel['product_info'])
    _print_fidelity(data['meta']['fidelity_msgs'])

    s = data['summary']
    s = data['summary']
    currency = s.get('currency') or data['meta'].get('product_currency') or 'USD'
    print(f'  受保人: {s.get("insured_name")} ({s.get("insured_age")}岁 / {s.get("insured_gender")})')
    print(f'  缴费年期: {s.get("payment_years")}年 / 年保费: {currency} {(s.get("annual_premium") or 0):,.0f}')
    print(f'  总保费: {currency} {data["paid_total"]:,.0f}')
    print(f'  保障年期: {s.get("coverage_period")}')
    print()
    nw = data['no_withdraw']; wd = data['withdraw']
    if nw:
        nw_range = f'Y{min(int(k) for k in nw)}-Y{max(int(k) for k in nw)}'
        print(f'  不提领表: {nw_range} ({len(nw)}行)')
    if wd:
        wd_range = f'Y{min(int(k) for k in wd)}-Y{max(int(k) for k in wd)}'
        print(f'  提领表:   {wd_range} ({len(wd)}行)')
    return data


def cmd_export(data: dict, formats: list, output_dir: str = 'outputs',
               theme: str = 'caramel',
               cover_image: str = None,
               logo_path: str = None,
               company_images: list = None,
               scene_images: list = None) -> list:
    """步骤 4: 导出"""
    os.makedirs(output_dir, exist_ok=True)
    s = data['summary']
    name = s.get('insured_name') or 'VIP'
    age = s.get('insured_age', 1)
    base = _safe_filename(f"{name}_{age}岁_{data['meta']['product_code']}_正式版")
    results = []
    print()
    print('─' * 50)
    print('正在渲染...')
    print('─' * 50)

    for fmt in formats:
        if fmt == 'pptx':
            p = os.path.join(output_dir, base + '.pptx')
            render_pptx(data, p, theme=theme,
                        cover_image=cover_image,
                        logo_path=logo_path,
                        company_images=company_images,
                        scene_images=scene_images)
            results.append(p)
            print(f'  ✓ PPTX  → {p}')
        elif fmt == 'html':
            p = os.path.join(output_dir, base + '.html')
            render_html(data, p)
            results.append(p)
            print(f'  ✓ HTML  → {p}')
        elif fmt == 'json':
            p = os.path.join(output_dir, base + '.json')
            render_json(data, p)
            results.append(p)
            print(f'  ✓ JSON  → {p}')
        elif fmt == 'pdf':
            p = os.path.join(output_dir, base + '.pdf')
            try:
                render_pdf(data, p)
                results.append(p)
                print(f'  ✓ PDF   → {p}')
            except Exception as e:
                print(f'  ⚠ PDF 失败: {e}')
    return results


def main():
    import argparse
    parser = argparse.ArgumentParser(description='官方计划书 → 客户正式版储蓄险PPT/HTML/JSON/PDF')
    parser.add_argument('pdf', nargs='?', help='PDF 路径 (可省略则交互输入)')
    parser.add_argument('--format', '-f', default='5', help='导出格式 1=pptx 2=html 3=json 4=pdf 5=all')
    parser.add_argument('--out', '-o', default='outputs', help='输出目录')
    parser.add_argument('--auto', '-y', action='store_true', help='跳过确认')
    parser.add_argument('--theme', default='caramel', help='主题: caramel/broker/business/chinese/ink/minimal')
    parser.add_argument('--cover-image', help='封面背景图路径')
    parser.add_argument('--logo', help='公司 Logo PNG 路径')
    parser.add_argument('--company-images', nargs='*', help='公司介绍页照片路径')
    parser.add_argument('--scene-images', nargs='*', help='场景图路径')
    args = parser.parse_args()

    print()
    print('═' * 50)
    print('  insdeck v0.1.0')
    print('  官方计划书 → 客户正式版储蓄险PPT/HTML/JSON/PDF')
    print('═' * 50)

    # 步骤 1: PDF 路径
    if args.pdf:
        pdf_path = args.pdf.strip().strip('"').strip("'").strip()
    else:
        print()
        print('┌─ 步骤 1: 上传PDF ─────────────')
        print('│ 拖入路径或输入:')
        pdf_path = _prompt('│ >').strip().strip('"').strip("'").strip()
        print('└─')
    if not os.path.exists(pdf_path):
        print(f'✗ 文件不存在: {pdf_path}')
        sys.exit(1)

    # 步骤 2: 检测
    sel = cmd_detect(pdf_path, auto=args.auto)
    if not sel and not args.auto:
        print('✗ 已取消')
        sys.exit(1)
    if not sel:
        print('✗ 自动检测失败，请检查PDF或手动选择产品')
        sys.exit(1)

    # 步骤 3: 提取+验证
    data = cmd_extract_and_preview(pdf_path, sel)

    # 步骤 4: 选格式
    if args.format and args.auto:
        choice = args.format
    else:
        print()
        print('┌─ 步骤 4: 选择导出格式 ─────────')
        print('│  [1] PPTX (可编辑)')
        print('│  [2] HTML (单文件, 小程序H5可加载)')
        print('│  [3] JSON (结构化数据)')
        print('│  [4] PDF  (高清导出)')
        print('│  [5] 全部')
        print('└─')
        choice = _prompt('│ >', default='5')
    fmt_map = {'1': ['pptx'], '2': ['html'], '3': ['json'], '4': ['pdf'], '5': ['pptx', 'html', 'json', 'pdf']}
    formats = fmt_map.get(choice, ['pptx', 'html', 'json'])

    # 输出目录
    out_dir = args.out
    if not args.auto:
        print()
        out_dir = _prompt('输出目录', default='outputs')

    # 渲染
    results = cmd_export(data, formats, out_dir,
                         theme=args.theme,
                         cover_image=args.cover_image,
                         logo_path=args.logo,
                         company_images=args.company_images,
                         scene_images=args.scene_images)

    # 总结
    print()
    print('═' * 50)
    print(f'  ✓ 完成！共 {len(results)} 个文件')
    for r in results:
        size = os.path.getsize(r)
        print(f'    {r}  ({size:,} bytes)')
    print('═' * 50)


if __name__ == '__main__':
    main()
