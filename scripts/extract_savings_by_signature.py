#!/usr/bin/env python3
"""
按 PDF 签名（公司+产品）专用提取器

输入:
  --pdf <path>
  --signature <id>          # 例: ctf-mw2iua-v1
  --page-summary <N>         # 投保摘要页 (1-based)
  --pages-no-withdraw <list>  # 不提领表页
  --pages-withdraw <list>     # 提领表页
  --pages-withdraw-remainder <list>  # 提领后剩余价值表 (AIA专用)
  --year-horizon <N>          # 演示口径年 (默认 80)

输出: JSON
{
  "ok": true,
  "summary": {...},
  "no_withdraw": {Y: {Paid, Rev, Term, Total, Guar_CV, IRR, Simple, Mult}},
  "withdraw": {Y: {Paid, Annual_WD, Cum_WD, Total, ...}},
  "diagnostics": {warnings: [], parser: "..."}
}
"""
import argparse
import contextlib
import io
import json
import re
import sys
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

import pdfplumber
import fitz  # for summary page text


def _parse_multi(cell) -> List[int]:
    """Cell可能含多值用\\n分隔"""
    if not cell:
        return []
    out = []
    for x in str(cell).split("\n"):
        s = x.strip().replace(",", "").replace("-", "").replace(" ", "")
        if s and (s.replace(".", "").isdigit()):
            try:
                v = int(float(s))
                out.append(v)
            except ValueError:
                pass
    return out


def _parse_y(cell) -> List[int]:
    """解析Y值, 处理 '65岁' 格式"""
    if not cell:
        return []
    out = []
    for x in str(cell).split("\n"):
        s = x.strip().replace("岁", "").strip()
        if s.isdigit():
            out.append(int(s))
    return out


def _parse_int(s: str) -> Optional[int]:
    """单值整数解析 (用于 X-clustering 后逐 cell 解析)"""
    if not s:
        return None
    s = s.strip().replace(",", "").replace("-", "").replace(" ", "")
    if not s or not s.replace(".", "").isdigit():
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def _cluster_words_xy(page: fitz.Page) -> List[List[Tuple[float, str]]]:
    """PyMuPDF get_text('words') → 按 X 聚列 + Y 聚行的二维 [[(x, text), ...], ...]

    解决 pdfplumber 解析失败的中文储蓄险 PDF (列被竖排堆叠时 pdfplumber 输出 1 列空字符串)
    """
    words = page.get_text("words")
    if not words:
        return []
    rows_by_y: Dict[float, List[Tuple[float, str]]] = defaultdict(list)
    for w in words:
        x0, y0 = w[0], w[1]
        text = w[4]
        if not text or not text.strip():
            continue
        # 行 Y 坐标用 round(0) 聚簇, 避免浮点漂移
        rows_by_y[round(y0, 0)].append((x0, text))
    sorted_ys = sorted(rows_by_y.keys())
    return [sorted(rows_by_y[y], key=lambda c: c[0]) for y in sorted_ys]


def _header_contains(page, keywords: List[str]) -> bool:
    text = page.extract_text() or ""
    return all(kw in text for kw in keywords)


def _any_kw_in_page(page, keywords: List[str]) -> bool:
    """OR 模式: 任一关键词在页面文本里即返回 True (用于简体+繁体双支持)"""
    text = page.extract_text() or ""
    return any(kw in text for kw in keywords)


def extract_summary(pdf_path: str, page_idx: int) -> Dict:
    """提取投保摘要 (兼容港陆两式, 1-based → 0-based)"""
    doc = fitz.open(pdf_path)
    if page_idx < 1 or page_idx > doc.page_count:
        page_idx = 1
    text = doc[page_idx - 1].get_text()
    doc.close()
    summary = {
        "insured_name": None, "insured_age": None, "insured_gender": None,
        "product_name": None, "product_code": None, "currency": None,
        "annual_premium": None, "annual_premium_with_levy": None,
        "payment_years": None, "coverage_period": None,
        "premium_total": None,
    }

    # 受保人 (港: 擬受保人 / 陆: 受保人姓名)
    # 关键: 用 \S+ (非空白) 限制, 避免抓多行
    m = re.search(r"擬受保人\s*[：:]?\s*(\S+)", text)
    if not m: m = re.search(r"受保人姓名\s*[：:]\s*(\S+)", text)
    if m and m.group(1).strip():
        nm = m.group(1).strip()
        if "性别" not in nm and "性別" not in nm and len(nm) < 30:
            summary["insured_name"] = nm
    # AIA 风格: "受保人姓名：\n性别：男" → 没有 name, 跳到 "VIP 先生 1" 单独
    if not summary.get("insured_name"):
        # 找 "VIP 女士/先生" 风格 (中文全名)
        m = re.search(r"(VIP\s*(?:先生|女士))", text)
        if m: summary["insured_name"] = m.group(1).strip()
    if not summary.get("insured_name"):
        m = re.search(r"姓名\s*[：:]?\s*([^\n:]+?)(?=\s*\n)", text)
        if m and m.group(1).strip() and len(m.group(1).strip()) < 30:
            summary["insured_name"] = m.group(1).strip()

    # 性别 + 年龄 (港: 性別 / 年齡 / 收費標準: 男 / 58 / 非吸煙)
    m = re.search(r"性別\s*/\s*年齡\s*/\s*收費標準\s*[：:]\s*(\S+)\s*/\s*(\d+)\s*/", text)
    if m:
        summary["insured_gender"] = m.group(1)
        summary["insured_age"] = int(m.group(2))
    if not summary.get("insured_age"):
        # 关键: \s 默认不匹配 \n, 用 [\s\S] 兼容多行
        m = re.search(r"年龄\s*[：:]?[\s\S]*?(\d+)", text)
        if m: summary["insured_age"] = int(m.group(1))
    if not summary.get("insured_gender"):
        m = re.search(r"性別\s*[：:]\s*(\S+)", text)
        if not m: m = re.search(r"性别\s*[：:]\s*(\S+)", text)
        if m: summary["insured_gender"] = m.group(1)

    # 产品名 (锚定保險計劃向前抓取)
    m = re.search(r"「([^」]+)」\s*(?:儲蓄|储蓄)(?:壽險|寿险)計劃?", text)
    if m:
        summary["product_name"] = "「" + m.group(1).replace(chr(10), "").strip() + "」"
    if not summary.get("product_name"):
        m = re.search(r"「([^」]+)」\s*保險計劃?", text)
        if m:
            summary["product_name"] = "「" + m.group(1).replace(chr(10), "").strip() + "」"
    if not summary.get("product_name"):
        m = re.search(r"「([^」]+)」\s*储蓄寿险计划\d", text)
        if m:
            summary["product_name"] = "「" + m.group(1).replace(chr(10), "").strip() + "」"
    if not summary.get("product_name"):
        # 通用: 找"保險計劃"前的最后中文片段
        m = re.search(r"([一-龥][一-龥\s\n]{1,15})保險計劃", text)
        if m:
            raw = m.group(1)
            # 取最后 2-8 个连续中文 (排除 "基本計劃 (a)" 之类)
            cleaned = re.sub(r"[\s\n()（）a-zA-Z0-9]+", "", raw)
            # 取 cleaned 末尾最长 6 字
            summary["product_name"] = "「" + cleaned[-6:] + "保險計劃」" if len(cleaned) >= 4 else "「" + cleaned + "」"

    # 货币
    m = re.search(r"(?:貨幣|保单货币|保單貨幣)\s*[：:]\s*(\S+)", text)
    if m:
        c = m.group(1)
        if "美元" in c: summary["currency"] = "USD"
        elif "港幣" in c or "港元" in c: summary["currency"] = "HKD"
        elif "人民币" in c or "人民幣" in c: summary["currency"] = "RMB"
        else: summary["currency"] = c

    # 缴费年期
    # 关键: 每个分支必须有 group(1) 才能提取数字; line 148 旧版没有 group 会抛 IndexError
    payment_patterns = [
        r"保費繳付期\s*[：:]\s*(\d+)\s*年",
        r"保費繳付年期\s*[：:]?\s*(\d+)\s*年",  # CTF 独有格式 (原版无 group, 已修)
        r"保费供款年期\s*[：:]?\s*(\d+)\s*年",
        r"保費供款年期\s*[：:]?\s*(\d+)\s*年",
        r"缴费年期\s*[：:]\s*(\d+)\s*年",
        r"(\d+)\s*年\s*缴(?:费|付)",
        r"(\d+)\s*年\s*供",
        r"(\d+)\s*年\s*\n\s*至\d+\s*岁",
    ]
    for pat in payment_patterns:
        m = re.search(pat, text)
        if m:
            try:
                v = int(m.group(1))
                if 1 <= v <= 30:
                    summary["payment_years"] = v
                    break
            except (IndexError, ValueError):
                continue

    # 保障年期
    m = re.search(r"保障至年齡\s*[：:]\s*(\S+)", text)
    if m: summary["coverage_period"] = m.group(1)
    if not summary.get("coverage_period"):
        m = re.search(r"(\d+)\s*年\s*\n?\s*至(\d+)\s*岁", text)
        if m: summary["coverage_period"] = f"至{m.group(2)}岁"
    if not summary.get("coverage_period") and ("終身" in text or "终身" in text):
        summary["coverage_period"] = "终身"

    # 年保费 - 多种格式兼容 (CTF 传统 / AIA 表格列 / AIA 简体 + 旧版数字)
    # 注: AIA 环宇盈活等 plan 的"年缴保费"在表格列里, 值在表头后几百字符内才出现
    #     之前限定 \s*[：:] 紧跟数字, 表格格式 (换行 + 其他列头 + 数字) 会失败
    #     之前限定 \d{2,3},\d{3}\.00, AIA 数字 .09/.49 等含征费小数都失败
    #
    # 顺序: 先取 annual_premium_with_levy (排除 levy 值), 再取 annual_premium
    # 首年实缴总保费（含折扣/征费）优先从明确字段读取
    # 注: AIA 简体 "投保时年缴总保费" 在 v3 之前漏了, 加 简体优先
    m = re.search(r"投保时年缴总保费\s*[：:]?\s*([\d,]+\.?\d*)", text)
    if not m:
        m = re.search(r"總額（包括投保時每年保費之保費徵費）\s*([\d,]+\.?\d*)", text)
    if not m:
        m = re.search(r"投保時每年總保費\s*\(.*?\)\s*([\d,]+\.?\d*)", text)
    if not m:
        m = re.search(r"投保時每年總保費\s*[：:]?\s*([\d,]+\.?\d*)", text)
    if not m:
        m = re.search(r"总额\s*\(1\)\s*\+\s*\(2\)\s*[：:]\s*([\d,]+\.?\d*)", text)
    if not m:
        m = re.search(r"总额（包括投保时每年保费之保费征费）\s*([\d,]+\.?\d*)", text)
    levy_amount = None
    if m:
        levy_amount = float(m.group(1).replace(",", ""))
        summary["annual_premium_with_levy"] = levy_amount

    # Pattern 1a: 繁简 "年繳保費/年缴保费" 紧跟冒号 (CTF/部分 AIA 旧格式)
    m = re.search(r"年繳保費\s*[：:]\s*([\d,]+\.?\d*)", text)
    if not m: m = re.search(r"年缴保费\s*[：:]\s*([\d,]+\.?\d*)", text)
    if m:
        v = float(m.group(1).replace(",", ""))
        if levy_amount is None or v != levy_amount:
            summary["annual_premium"] = v
    # Pattern 1b: AIA 表格列 (header → 跨过其他列头 → 第一个 NN,NNN.XX)
    # 关键: NN,NNN 格式 (5,250/50,506 等保额/基本金额) 不带小数, 不会匹配 \.\d{2}
    if not summary.get("annual_premium"):
        m = re.search(r"年繳保費[\s\S]{0,500}?(\d{1,3}(?:,\d{3})+\.\d{2})", text)
        if not m: m = re.search(r"年缴保费[\s\S]{0,500}?(\d{1,3}(?:,\d{3})+\.\d{2})", text)
        if m:
            v = float(m.group(1).replace(",", ""))
            if levy_amount is None or v != levy_amount:
                summary["annual_premium"] = v
    # Pattern 2: 重复 2+ 次的 NN,NNN.XX (港式名义金额 = 每年保费)
    # 注: 之前限定 .00, 已放宽接受任何 .XX (含征费小数)
    if not summary.get("annual_premium"):
        cands = re.findall(r"(\d{1,3}(?:,\d{3})+\.\d{2})", text)
        from collections import Counter
        cnt = Counter(cands)
        for v, n in cnt.most_common(3):
            if n >= 2:
                vf = float(v.replace(",", ""))
                if levy_amount is None or vf != levy_amount:
                    summary["annual_premium"] = vf
                    break
    # Pattern 3: 单次 NN,NNN.XX, 放宽到 1000-110000 (AIA 5-pay 也常见 $5,000+ 范围)
    if not summary.get("annual_premium"):
        cands = re.findall(r"(\d{1,3}(?:,\d{3})+\.\d{2})", text)
        for c in cands:
            v = float(c.replace(",", ""))
            if 1000 < v < 110000:
                if levy_amount is None or v != levy_amount:
                    summary["annual_premium"] = v
                    break

    # ─── 投保时保额 sum_insured ───
    # AIA 表格列 header "投保时保额(2)" 或 繁體 "投保時保額(2)"
    # 注: 第一个 NN,NNN (无小数也可) 在 header 之后正确 = 保额 (5,250)
    #     因为 text 顺序里 保额列 在 年缴保费列之前, data row 第一个 NN,NNN = 保额
    # 排除 annual_premium 值 (避免重复)
    if not summary.get("sum_insured"):
        m = re.search(r"投保時保額\s*\(\s*2\s*\)\s*[\s\S]{0,500}?(\d{1,3}(?:,\d{3})+(?:\.\d+)?)", text)
        if not m:
            m = re.search(r"投保时保额\s*\(\s*2\s*\)\s*[\s\S]{0,500}?(\d{1,3}(?:,\d{3})+(?:\.\d+)?)", text)
        if m:
            v = float(m.group(1).replace(",", ""))
            if (summary.get("annual_premium") is None or v != summary["annual_premium"]) \
                    and (levy_amount is None or v != levy_amount):
                summary["sum_insured"] = v

    if summary.get("annual_premium") and summary.get("payment_years"):
        summary["premium_total"] = round(summary["annual_premium"] * summary["payment_years"], 2)
    return summary


def extract_no_withdraw_ctf(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """CTF 不提领表 (6列: Y, Paid, Guar_CV, Rev, Term, Total)
    官方页头: '3. 基本计划 – 说明摘要' + '退保发还金额' + '缴付保费'
    列序: [Y, Paid, Guar, Rev, Term, Total]
    """
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg in page_indices:
            if pg < 1 or pg > len(pdf.pages):
                continue
            page = pdf.pages[pg - 1]
            text = page.extract_text() or ""
            # 简体 + 繁体双支持, 用 OR 逻辑
            # 简体: "3. 基本计划" + "退保发还金额" + "缴付保费"
            # 繁体: "3. 基本計劃" + (退保發還金額 / 已繳付保費總額)
            # 关键: 不要求 3 个关键词全中, 任一即可 (表结构判断交给 row 级 _parse_multi)
            # 排除明显不是数据表的页 (封面/说明页)
            has_section = any(kw in text for kw in ["3. 基本计划", "3. 基本計劃", "說明摘要", "退保發還金額", "退保发还金额", "保證現金價值", "保证现金价值"])
            has_surrender_or_paid = any(kw in text for kw in [
                "退保发还金额", "退保發還金額", "退保權益", "退保价值",
                "已繳付保費總額", "已繳保費總額",
                "现金价值", "現金價值",
                "繳付保費", "缴付保费", "已繳付保費", "已繳保費",
                "保費繳付", "保费缴付", "應付保費",
                "保單年度", "保单年度", "年期", "退保", "身故",
            ])
            if not (has_section or has_surrender_or_paid):
                continue
            # 排除提领页 (P11-P15 的提取款項/現金提取表是 withdraw, 不应进 no_withdraw)
            if any(kw in text for kw in ["现金提取", "現金提取", "款項提取", "提取款項"]):
                continue
            for t in page.extract_tables():
                if not t or len(t) < 4:
                    continue
                for r in t:
                    if not r or len(r) < 6:
                        continue
                    ys = _parse_multi(r[0])
                    if not ys or not (1 <= ys[0] <= 128):
                        continue
                    paid = _parse_multi(r[1])
                    guar = _parse_multi(r[2])
                    rev = _parse_multi(r[3])
                    term = _parse_multi(r[4])
                    total = _parse_multi(r[5])
                    n = min(len(ys), len(paid), len(guar), len(rev), len(term), len(total))
                    for k in range(n):
                        y = ys[k]
                        if 1 <= y <= 128 and y not in rows:
                            rows[y] = {
                                "Y": y, "Age": y, "Paid": paid[k],
                                "Guar_CV": guar[k], "Rev": rev[k],
                                "Term": term[k], "Total": total[k],
                                "SourcePage": pg,
                            }
    return rows


def extract_no_withdraw_chinalife(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """中国人寿傲珑盛世 C540 (USD 5-pay, 演示最长130年)

    PDF 布局: Page 2-4 是「退保发还金额 + 身故赔偿额」并列双表 (11 列同 Y 行)
    列序: [Y, Paid, Guar, Rev_CV, Term_CV, Total_CV, Guar_D, Rev_D, Term_D, Total_D, Final]

    取前 6 列做不提取演示 (Total_CV = Guar + Rev + Term)
    Page 2 通常含 Y1-Y9, Page 3 重复不同情景 (悲观/乐观), Page 4 身故; 只取 Page 2 的退保表
    """
    rows = {}
    doc = fitz.open(pdf_path)
    for pg in page_indices:
        if pg < 1 or pg > doc.page_count:
            continue
        page = doc[pg - 1]
        text = page.get_text()
        # 仅取退保发还金额页 (Page 3/4 是不同情景, 不是默认演示)
        if "退保發還金額" not in text and "退保发还金额" not in text:
            continue
        # Page 3 标记悲观/乐观情景, 跳过
        if "悲觀情景" in text or "悲观情景" in text or "樂觀情景" in text or "乐观情景" in text:
            continue
        # Page 4 是身故, 跳过
        if "身故賠償額" in text and "退保" not in text:
            continue
        rows_list = _cluster_words_xy(page)
        for row in rows_list:
            if len(row) < 6:
                continue
            y_str = row[0][1].strip().replace("歲", "").replace("岁", "")
            if not y_str.isdigit():
                continue
            y = int(y_str)
            if not (1 <= y <= 130) or y in rows:
                continue
            paid = _parse_int(row[1][1])
            guar = _parse_int(row[2][1])
            rev = _parse_int(row[3][1])
            term = _parse_int(row[4][1])
            total = _parse_int(row[5][1])
            if paid is None or total is None:
                continue
            rows[y] = {
                "Y": y, "Age": y, "Paid": paid,
                "Guar_CV": guar or 0,
                "Rev": rev or 0,
                "Term": term or 0,
                "Total": total,
                "SourcePage": pg,
            }
    doc.close()
    return rows


def extract_no_withdraw_pru(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """保誠「信守明天」多元貨幣計劃 TRST (USD 5-pay, 演示100年)

    PDF 布局:
      - Page 2: 默认演示 退保价值 (6列, Y1-Y30)
      - Page 11: 备注 (跳过)
      - Pages 12-14: 补充说明 退保价值 (6列, Y1-Y95+)
      - Pages 3-5: 身故/不同投资回报 (跳过)
      - Pages 15-16: 补充说明 身故 (跳过)
    表头 (多行): "保證金額 (A)" + "累積歸原紅利 (B)" + "終期紅利 (C)" + "總額 (A)+(B)+(C)"
    列序: [Y, Paid, Guar, Rev, Term, Total]
    """
    rows = {}
    doc = fitz.open(pdf_path)
    for pg in page_indices:
        if pg < 1 or pg > doc.page_count:
            continue
        page = doc[pg - 1]
        text = page.get_text()
        # 仅取退保价值页 (Page 3-5 是身故/不同投资回报, Page 11 是备注, Page 15+ 是身故)
        if "退保" not in text or "保證金額" not in text or "累積歸原紅利" not in text or "終期紅利" not in text:
            continue
        # 排除 身故 page: 找页头中的 "身故" 标识 (避免误杀 备注里提到 身故 的 退保 页)
        # PRU 身故页 section 头: "3. 基本計劃 – 身故賠償之説明摘要" / "5. 基本計劃 – 身故賠償 – 不同投資回報" /
        #                        "基本計劃補充說明 – 身故賠償之説明摘要"
        if "3. 基本計劃 – 身故賠償" in text or "3. 基本計劃-身故" in text \
                or "5. 基本計劃 – 身故" in text or "5. 基本計劃-身故" in text \
                or "基本計劃補充說明 – 身故" in text or "基本計劃補充說明-身故" in text:
            continue
        # 排除 退保 不同投资回报页: "4. 基本計劃 – 退保價值 – 不同投資回報" (避免误杀 备注里提到 投资回报 的 退保 页)
        if "4. 基本計劃 – 退保" in text or "4. 基本計劃-退保" in text:
            continue
        rows_list = _cluster_words_xy(page)
        for row in rows_list:
            if len(row) < 6:
                continue
            y_str = row[0][1].strip()
            # 跳过 "65歲"/"ANB" 等非 Y 纯数字格式
            if not y_str.isdigit():
                continue
            y = int(y_str)
            if not (1 <= y <= 110) or y in rows:
                continue
            paid = _parse_int(row[1][1])
            guar = _parse_int(row[2][1])
            rev = _parse_int(row[3][1])
            term = _parse_int(row[4][1])
            total = _parse_int(row[5][1])
            if paid is None or total is None:
                continue
            # 验证 Total = Guar + Rev + Term (允许 ±1 整数舍入)
            if guar is not None and rev is not None and term is not None:
                expected = guar + rev + term
                if abs(expected - total) > max(2, total * 0.001):
                    continue  # 异常行, 跳过
            rows[y] = {
                "Y": y, "Age": y, "Paid": paid,
                "Guar_CV": guar or 0,
                "Rev": rev or 0,
                "Term": term or 0,
                "Total": total,
                "SourcePage": pg,
            }
    doc.close()
    return rows


def extract_no_withdraw_china_taiping_1121(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """中国太平「頤·樂享」儲蓄保險計劃(尊享版) 1121NWLP7 (USD 5-pay, 演示130年)

    PDF 布局:
      - Page 3: 默认演示 退保权益 (7列, Y1-Y30 + 65歲/70歲... sparse)
      - Pages 7-10: 补充说明 退保权益 (7列, Y1-Y122+ 完整)
      - Pages 4-6: 身故/不同投资回报 (跳过)
      - Page 11+: 身故/文字/提领 (跳过)
    表头 (多行): "保證現金價值 (B)" + "復歸紅利現金價值 (C)" + "終期分紅現金價值 (D)" +
                  "額外終期分紅現金價值 (E)" + "總額 =(B)+(C)+(D)+(E)"
    列序: [Y, Paid, Guar=B, Rev=C, Term=D, Extra_Term=E, Total]
    内部映射: Term_internal = D + E
    """
    rows = {}
    doc = fitz.open(pdf_path)
    for pg in page_indices:
        if pg < 1 or pg > doc.page_count:
            continue
        page = doc[pg - 1]
        text = page.get_text()
        # 仅取退保权益页 (含 額外終期分紅 = 7 列特征)
        if "退保權益" not in text or "保證現金價值" not in text or "復歸紅利" not in text:
            continue
        if "額外終期分紅" not in text:
            continue  # 退保权益表特有 7 列
        # 排除 身故 page: 找页头中的 "身故權益" 标识 (避免误杀 备注里提到 身故 的 退保 页)
        # 太平 身故页 section 头: "3. 基本計劃 - 說明摘要 (身故權益)" /
        #                         "5. 基本計劃 - 身故權益 - 不同投資回報"
        if "說明摘要 (身故權益)" in text or "身故權益 - 不同" in text or "身故權益-不同" in text:
            continue
        # 排除 退保 不同投资回报页: "4. 基本計劃 - 退保權益 - 不同投資回報"
        if "退保權益 - 不同" in text or "退保權益-不同" in text:
            continue
        rows_list = _cluster_words_xy(page)
        for row in rows_list:
            if len(row) < 7:
                continue
            y_str = row[0][1].strip()
            # 跳过 "65歲"/"ANB" 等非 Y 纯数字格式
            if not y_str.isdigit():
                continue
            y = int(y_str)
            if not (1 <= y <= 140) or y in rows:
                continue
            paid = _parse_int(row[1][1])
            guar = _parse_int(row[2][1])  # B
            rev = _parse_int(row[3][1])   # C
            term = _parse_int(row[4][1])  # D
            extra = _parse_int(row[5][1]) if len(row) > 5 else None  # E
            total = _parse_int(row[6][1]) if len(row) > 6 else None
            if paid is None or total is None:
                continue
            # 验证 Total = B + C + D + E
            if guar is not None and rev is not None and term is not None and extra is not None:
                expected = guar + rev + term + extra
                if abs(expected - total) > max(2, total * 0.001):
                    continue
            rows[y] = {
                "Y": y, "Age": y, "Paid": paid,
                "Guar_CV": guar or 0,
                "Rev": rev or 0,
                "Term": (term or 0) + (extra or 0),  # 合并 D + E
                "Total": total,
                "SourcePage": pg,
            }
    doc.close()
    return rows


def extract_no_withdraw_taiping(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """中国太平鑫安逸 AAXNA1U (USD 3-pay, 30年演示)

    PDF 布局: Page 2 是「保證退保价值 + 保證身故赔偿」表 (4 列 + 30 行)
    列序: [Y, Paid, Guar_CV, Guar_Death]
    无分红演示 → Rev=0, Term=0, Total = Guar_CV
    """
    rows = {}
    doc = fitz.open(pdf_path)
    for pg in page_indices:
        if pg < 1 or pg > doc.page_count:
            continue
        page = doc[pg - 1]
        text = page.get_text()
        if "保證退保價值" not in text and "保证退保价值" not in text:
            continue
        rows_list = _cluster_words_xy(page)
        for row in rows_list:
            if len(row) < 4:
                continue
            y_str = row[0][1].strip()
            if not y_str.isdigit():
                continue
            y = int(y_str)
            if not (1 <= y <= 50) or y in rows:
                continue
            paid = _parse_int(row[1][1])
            guar_cv = _parse_int(row[2][1])
            if paid is None or guar_cv is None:
                continue
            rows[y] = {
                "Y": y, "Age": y, "Paid": paid,
                "Guar_CV": guar_cv,
                "Rev": 0,
                "Term": 0,
                "Total": guar_cv,
                "SourcePage": pg,
            }
    doc.close()
    return rows


def extract_withdraw_ctf(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """CTF 提领表 (11列: Age, Y, Paid, Annual_WD, Cum_WD, Guar_CV, _, Rev, Term, Total, Total+WD)"""
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg in page_indices:
            if pg < 1 or pg > len(pdf.pages):
                continue
            page = pdf.pages[pg - 1]
            # 简体/繁体/通用关键词: 含"提取/退保/部退"任一 + 有数字表 视为提领页
            if not _any_kw_in_page(page, [
                "现金提取", "現金提取", "款項提取", "提取款項", "提取金额", "提取金額",
                "退保发还", "退保發還", "退保價值", "退保价值",
                "部份退保", "部分退保", "现金提取后", "現金提取後",
                "提款", "提取说明", "提取說明",
            ]):
                continue
            for t in page.extract_tables():
                if not t or len(t) < 4:
                    continue
                for r in t:
                    if not r or len(r) < 10:
                        continue
                    ages = _parse_multi(r[0])
                    ys = _parse_multi(r[1])
                    if not ys or not (1 <= ys[0] <= 128):
                        continue
                    paid = _parse_multi(r[2])
                    annual = _parse_multi(r[3])
                    cum = _parse_multi(r[4])
                    guar = _parse_multi(r[5]) if len(r) > 5 else []
                    rev = _parse_multi(r[7]) if len(r) > 7 else []
                    term = _parse_multi(r[8]) if len(r) > 8 else []
                    total = _parse_multi(r[9]) if len(r) > 9 else []
                    n = min(len(ys), len(paid), len(annual), len(cum))
                    for k in range(n):
                        y = ys[k]
                        if 1 <= y <= 128 and y not in rows:
                            rows[y] = {
                                "Y": y, "Age": ages[k] if k < len(ages) else y,
                                "Paid": paid[k], "Annual_WD": annual[k], "Cum_WD": cum[k],
                                "Guar_CV": guar[k] if k < len(guar) else 0,
                                "Rev": rev[k] if k < len(rev) else 0,
                                "Term": term[k] if k < len(term) else 0,
                                "Total": total[k] if k < len(total) else 0,
                                "SourcePage": pg,
                            }
    return rows


def extract_no_withdraw_aia(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """AIA 多页 (P12-15): 详细说明 (退保/身故) + 现金价值 (可套现)

    Header 匹配: "保单年度 终结" (身故) / "保单年度 现金价值" / "保单年度 可套现"
    """
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg in page_indices:
            if pg < 1 or pg > len(pdf.pages):
                continue
            page = pdf.pages[pg - 1]
            # 宽松匹配: 任何含 "保单年度" + "身故/退保/现金价值/可套现/总额" 的页
            txt = page.extract_text() or ""
            if "保单年度" not in txt:
                continue
            if not any(kw in txt for kw in ["退保", "现金价值", "可套现", "身故", "总额"]):
                continue
            for t in page.extract_tables():
                if not t or len(t) < 4:
                    continue
                for r in t[3:]:  # 跳表头
                    if not r or len(r) < 6:
                        continue
                    ys = _parse_y(r[0])
                    if not ys:
                        continue
                    paid = _parse_multi(r[1])
                    guar = _parse_multi(r[2]) if len(r) > 2 else []
                    rev_term = (_parse_multi(r[3]) if len(r) > 3 else []) + (_parse_multi(r[4]) if len(r) > 4 else [])
                    total = _parse_multi(r[5]) if len(r) > 5 else []
                    n = min(len(ys), len(paid), len(total))
                    for k in range(n):
                        y = ys[k]
                        if y not in rows:
                            rows[y] = {
                                "Y": y, "Age": y, "Paid": paid[k],
                                "Guar_CV": guar[k] if k < len(guar) else 0,
                                "Rev": rev_term[0] if rev_term else 0,
                                "Term": rev_term[1] if len(rev_term) > 1 else 0,
                                "Total": total[k],
                            }
    return rows


def extract_no_withdraw_aia_huanyu(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    rows = {}
    doc = fitz.open(pdf_path)
    for pg in page_indices:
        if pg < 1 or pg > doc.page_count:
            continue
        page = doc[pg - 1]
        text = page.get_text()
        if "详细说明" not in text or "退保发还金额" not in text:
            continue
        with contextlib.redirect_stdout(io.StringIO()):
            tables = page.find_tables().tables
        for table in tables:
            extracted = table.extract()
            if not extracted or len(extracted[0]) < 12:
                continue
            for age, year, paid, guaranteed, bonus, dividend, total, death in table_rows(
                table, [0, 1, 2, 3, 4, 5, 6, 11]
            ):
                year_num = integer(year)
                if year_num <= 0:
                    continue
                rows[year_num] = {
                    "Y": year_num,
                    "Age": integer(age),
                    "Paid": number(paid),
                    "Guar_CV": number(guaranteed),
                    "Rev": number(bonus),
                    "Term": number(dividend),
                    "Total": number(total),
                    "Death": number(death),
                    "SourcePage": pg,
                }
    doc.close()
    return rows


def extract_withdraw_aia(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """AIA 6列 (P16-18): Age, Y, Wd_Guar, Wd_Rev, Wd_Term, Wd_Total"""
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg in page_indices:
            if pg < 1 or pg > len(pdf.pages):
                continue
            page = pdf.pages[pg - 1]
            if not _header_contains(page, ["现金提取"]):
                continue
            for t in page.extract_tables():
                if not t or len(t) < 4:
                    continue
                for r in t[3:]:
                    if not r or len(r) < 6:
                        continue
                    ages = _parse_multi(r[0])
                    ys = _parse_multi(r[1])
                    if not ys:
                        continue
                    a = _parse_multi(r[2])
                    b = _parse_multi(r[3]) if len(r) > 3 else []
                    c = _parse_multi(r[4]) if len(r) > 4 else []
                    tot = _parse_multi(r[5]) if len(r) > 5 else []
                    n = min(len(ys), len(tot))
                    for k in range(n):
                        y = ys[k]
                        if y not in rows:
                            annual_total = tot[k]
                            rows[y] = {
                                "Y": y, "Age": ages[k] if k < len(ages) else y,
                                "Paid": 0, "Annual_WD": annual_total, "Cum_WD": 0,
                                "Guar_CV": a[k] if k < len(a) else 0,
                                "Rev": (b[k] if k < len(b) else 0) + (c[k] if k < len(c) else 0),
                                "Term": 0, "Total": annual_total, "Total_WD": 0,
                            }
    # 累计 = sum 累加
    cum = 0
    for y in sorted(rows.keys()):
        cum += rows[y]["Annual_WD"]
        rows[y]["Cum_WD"] = cum
    return rows


def extract_withdraw_remainder_aia(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """AIA 9列 (P19-21): Age, Y, Paid, Wd_Amount, _, _, _, _, Remain_Total"""
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg in page_indices:
            if pg < 1 or pg > len(pdf.pages):
                continue
            page = pdf.pages[pg - 1]
            if not _header_contains(page, ["退保发还"]):
                continue
            if _header_contains(page, ["身故"]):
                continue
            for t in page.extract_tables():
                if not t or len(t) < 4:
                    continue
                for r in t[3:]:
                    if not r or len(r) < 9:
                        continue
                    ages = _parse_multi(r[0])
                    ys = _parse_multi(r[1])
                    if not ys:
                        continue
                    paid = _parse_multi(r[2])
                    remain_total = _parse_multi(r[8]) if len(r) > 8 else []
                    n = min(len(ys), len(remain_total))
                    for k in range(n):
                        y = ys[k]
                        if y not in rows:
                            rows[y] = {
                                "Y": y, "Age": ages[k] if k < len(ages) else y,
                                "Paid": paid[k] if k < len(paid) else 0,
                                "Total": remain_total[k],
                            }
    return rows


def extract_no_withdraw_manulife(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """Manulife 宏挚家 不提领表 (8列: Y, Paid, Guar_CV, Term, Total, Death_Guar, Death_Term, Death_Total)
    官方页头: '宏X家傳承保險計劃' + '說明 – 退保價值及身故賠償' + '保證現金價值' + '終期紅利'
    """
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg in page_indices:
            if pg < 1 or pg > len(pdf.pages):
                continue
            page = pdf.pages[pg - 1]
            text = page.extract_text() or ""
            if "保證現金價值" not in text or "終期紅利" not in text:
                continue
            if "現金提取" in text or "款項提取" in text:
                continue  # 排除提领页
            for t in page.extract_tables():
                if not t or len(t) < 4:
                    continue
                for r in t:
                    if not r or len(r) < 6:
                        continue
                    ys = _parse_multi(r[0])
                    if not ys or not (1 <= ys[0] <= 128):
                        continue
                    paid = _parse_multi(r[1])
                    guar = _parse_multi(r[2])  # 保證現金價值
                    term = _parse_multi(r[3])  # 終期紅利
                    total = _parse_multi(r[4])  # 退保總額 (A+B)
                    n = min(len(ys), len(paid), len(total))
                    for k in range(n):
                        y = ys[k]
                        if 1 <= y <= 128 and y not in rows:
                            rows[y] = {
                                "Y": y, "Age": y, "Paid": paid[k],
                                "Guar_CV": guar[k] if k < len(guar) else 0,
                                "Rev": 0,  # 宏挚家无复归红利
                                "Term": term[k] if k < len(term) else 0,
                                "Total": total[k],
                                "SourcePage": pg,
                            }
    return rows


def extract_withdraw_manulife(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """Manulife 宏挚家 提领表 (9列: Y, Paid, Annual_WD, _, _, _, _, _, Remain_Total)
    页头: '款項提取說明 – 退保價值' + '該年提取款項' + '款項提取后的退保價值'
    列序: [Y, Paid, Annual_WD, _, Sum_Guar, Sum_Term, Sum_Total, Remain_Guar, Remain_Term, Remain_Total]
    实际为 10 列, 取关键列
    """
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg in page_indices:
            if pg < 1 or pg > len(pdf.pages):
                continue
            page = pdf.pages[pg - 1]
            text = page.extract_text() or ""
            if "款項提取" not in text or "退保價值" not in text:
                continue
            for t in page.extract_tables():
                if not t or len(t) < 4:
                    continue
                for r in t:
                    if not r or len(r) < 6:
                        continue
                    ys = _parse_multi(r[0])
                    if not ys or not (1 <= ys[0] <= 128):
                        continue
                    paid = _parse_multi(r[1])
                    annual = _parse_multi(r[2]) if len(r) > 2 else []
                    # 剩余退保总额在最后一列或倒数第二列
                    remain_total = _parse_multi(r[-1]) if len(r) > 1 else []
                    n = min(len(ys), len(paid), len(remain_total))
                    for k in range(n):
                        y = ys[k]
                        if 1 <= y <= 128 and y not in rows:
                            annual_wd = annual[k] if k < len(annual) else 0
                            rows[y] = {
                                "Y": y, "Age": y, "Paid": paid[k],
                                "Annual_WD": annual_wd, "Cum_WD": 0,
                                "Guar_CV": 0, "Rev": 0, "Term": 0,
                                "Total": remain_total[k],
                                "SourcePage": pg,
                            }
    # 累计 = 累加
    cum = 0
    for y in sorted(rows.keys()):
        cum += rows[y]["Annual_WD"]
        rows[y]["Cum_WD"] = cum
    return rows


def _ia_irr_cap(currency: str) -> float:
    """HK IA IRR 上限: 港元 6.0%, 非港元 6.5%"""
    c = (currency or "USD").upper().strip()
    return 0.06 if c in ("HKD", "港币", "港元", "港幣") else 0.065


def _ma_irr_bisect(npv, lo: float = -0.99, hi: float = 1.0):
    """二分法求根"""
    f_lo, f_hi = npv(lo), npv(hi)
    if f_lo * f_hi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = npv(mid)
        if abs(f_mid) < 1e-6 or (hi - lo) < 1e-10:
            return mid
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2


def calc_irr_ma(years: int, total: float, paid_total: float, pay_years: int = 0, currency: str = "USD"):
    """M-A NPV IRR (不提领). 现金流: -P at t=0..n-1, +SV at t=year. 封顶 HK IA."""
    if years <= 0 or total <= 0 or paid_total <= 0:
        return None
    n = pay_years if pay_years >= 1 else 1
    annual = paid_total / n
    if annual <= 0:
        return None
    cf = [(0.0, -annual)]
    for i in range(1, n):
        cf.append((float(i), -annual))
    cf.append((float(years), total))
    cap = _ia_irr_cap(currency)
    irr = _ma_irr_bisect(lambda r: sum(a / (1 + r) ** t for t, a in cf))
    return min(irr, cap) if irr is not None else None


def calc_irr_ma_withdraw(years: int, total_received: float, paid_total: float,
                         pay_years: int = 0, currency: str = "USD",
                         start_wd_yr: int = 0, annual_wd: float = 0):
    """M-A NPV IRR (提领). 现金流: 保费同 calc_irr_ma; 从 start_wd_yr 起每年末 +aw, 终年 +aw+SV."""
    if years <= 0 or total_received <= 0 or paid_total <= 0:
        return None
    n = pay_years if pay_years >= 1 else 1
    annual = paid_total / n
    if annual <= 0:
        return None
    cap = _ia_irr_cap(currency)
    cf = [(0.0, -annual)]
    for i in range(1, n):
        cf.append((float(i), -annual))
    if start_wd_yr > 0 and annual_wd > 0 and years >= start_wd_yr:
        for w in range(start_wd_yr, years):
            cf.append((float(w), annual_wd))
        cf.append((float(years), total_received))
    else:
        cf.append((float(years), total_received))
    irr = _ma_irr_bisect(lambda r: sum(a / (1 + r) ** t for t, a in cf))
    return min(irr, cap) if irr is not None else None


def enrich(rows: Dict[int, Dict], paid_total: float, pay_years: int = 0, currency: str = "USD") -> Dict[int, Dict]:
    """加 M-A IRR / 单利 / 倍数. 与 docker/insurance-deck/insdeck/extract/savings_normalizer.py 完全一致."""
    # 找提领起始年 (M-A 提领公式需要)
    start_wd_yr, annual_wd = 0, 0
    for yk in sorted(int(k) for k in rows.keys()):
        aw = rows[yk].get("Annual_WD", 0) or 0
        if yk > 0 and aw > 0:
            start_wd_yr, annual_wd = yk, aw
            break
    for y, r in rows.items():
        yi = int(y)
        total = r.get("Total", 0) or 0
        if "Cum_WD" in r:
            received = (r.get("Cum_WD", 0) or 0) + total
            r["Total_Received"] = received
            r["Mult"] = received / paid_total if paid_total else 0
            r["IRR"] = calc_irr_ma_withdraw(yi, received, paid_total, pay_years, currency, start_wd_yr, annual_wd)
            r["Simple"] = (received - paid_total) / paid_total / yi if (paid_total and yi > 0) else None
        else:
            r["Mult"] = total / paid_total if paid_total else 0
            r["IRR"] = calc_irr_ma(yi, total, paid_total, pay_years, currency)
            r["Simple"] = (total - paid_total) / paid_total / yi if (paid_total and yi > 0) else None
    return rows


def _numeric_tokens_from_page(pdf_path: str, page_indices: List[int], header_marker: str) -> Dict[int, List[str]]:
    doc = fitz.open(pdf_path)
    pages: Dict[int, List[str]] = {}
    for pg in page_indices:
        if pg < 1 or pg > doc.page_count:
            continue
        text = doc[pg - 1].get_text()
        if header_marker not in text:
            continue
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        try:
            start = next(i for i, ln in enumerate(lines) if ln == header_marker) + 1
        except StopIteration:
            continue
        tokens: List[str] = []
        for ln in lines[start:]:
            if re.fullmatch(r"\d{1,3}(?:,\d{3})*(?:\.\d+)?", ln):
                tokens.append(ln)
        pages[pg] = tokens
    doc.close()
    return pages


def extract_no_withdraw_fwd(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    rows: Dict[int, Dict] = {}
    pages = _numeric_tokens_from_page(pdf_path, page_indices, "(A)+(B)+(C)")
    for pg, tokens in pages.items():
        width = 7
        for i in range(0, len(tokens) - width + 1, width):
            chunk = tokens[i:i + width]
            year = int(chunk[0].replace(",", ""))
            age = int(chunk[1].replace(",", ""))
            if not (1 <= year <= 200 and 0 <= age <= 150):
                continue
            paid, guar, rev, term, total = [int(float(x.replace(",", ""))) for x in chunk[2:7]]
            if year not in rows:
                rows[year] = {
                    "Y": year,
                    "Age": age,
                    "Paid": paid,
                    "Guar_CV": guar,
                    "Rev": rev,
                    "Term": term,
                    "Total": total,
                    "SourcePage": pg,
                }
    return rows


def extract_withdraw_fwd(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    rows: Dict[int, Dict] = {}
    pages = _numeric_tokens_from_page(pdf_path, page_indices, "(A)+(B)+(C)+(D)")
    for pg, tokens in pages.items():
        width = 10
        for i in range(0, len(tokens) - width + 1, width):
            chunk = tokens[i:i + width]
            year = int(chunk[0].replace(",", ""))
            age = int(chunk[1].replace(",", ""))
            if not (1 <= year <= 200 and 0 <= age <= 150):
                continue
            paid = int(float(chunk[2].replace(",", "")))
            annual = int(float(chunk[3].replace(",", "")))
            nominal = int(float(chunk[4].replace(",", "")))
            guar = int(float(chunk[5].replace(",", "")))
            rev = int(float(chunk[6].replace(",", "")))
            term = int(float(chunk[7].replace(",", "")))
            locked = int(float(chunk[8].replace(",", "")))
            total = int(float(chunk[9].replace(",", "")))
            if year not in rows:
                rows[year] = {
                    "Y": year,
                    "Age": age,
                    "Paid": paid,
                    "Annual_WD": annual,
                    "Cum_WD": 0,
                    "Guar_CV": guar,
                    "Rev": rev,
                    "Term": term,
                    "Locked": locked,
                    "Nominal": nominal,
                    "Total": total,
                    "SourcePage": pg,
                }
    cum = 0
    for year in sorted(rows.keys()):
        cum += rows[year]["Annual_WD"]
        rows[year]["Cum_WD"] = cum
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--signature", required=True, help="例: ctf-mw2iua-v1")
    ap.add_argument("--company", required=True, help="ctf/aia/pru/manulife/fwd")
    ap.add_argument("--page-summary", type=int, default=1)
    ap.add_argument("--pages-no-withdraw", default="")
    ap.add_argument("--pages-withdraw", default="")
    ap.add_argument("--pages-withdraw-remainder", default="")
    args = ap.parse_args()

    def parse_pages(s: str) -> List[int]:
        return [int(x) for x in s.split(",") if x.strip().isdigit()]

    pages_nw = parse_pages(args.pages_no_withdraw)
    pages_wd = parse_pages(args.pages_withdraw)
    pages_wd_rem = parse_pages(args.pages_withdraw_remainder)

    try:
        summary = extract_summary(args.pdf, args.page_summary)
        if args.company == "ctf":
            no_wd = extract_no_withdraw_ctf(args.pdf, pages_nw)
            wd = extract_withdraw_ctf(args.pdf, pages_wd) if pages_wd else {}
        elif args.company == "aia":
            # 临时回退: aia-huanyu5-v1 之前调 aia_huanyu (有 bug), 改用通用 aia extractor
            no_wd = extract_no_withdraw_aia(args.pdf, pages_nw)
            wd = extract_withdraw_aia(args.pdf, pages_wd) if pages_wd else {}
            if pages_wd_rem and wd:
                rem = extract_withdraw_remainder_aia(args.pdf, pages_wd_rem)
                for y, r in rem.items():
                    if y in wd and r.get("Total"):
                        wd[y]["Total"] = r["Total"]
                        if r.get("Paid"):
                            wd[y]["Paid"] = r["Paid"]
        elif args.company == "manulife":
            no_wd = extract_no_withdraw_manulife(args.pdf, pages_nw)
            wd = extract_withdraw_manulife(args.pdf, pages_wd) if pages_wd else {}
        elif args.company == "fwd":
            no_wd = extract_no_withdraw_fwd(args.pdf, pages_nw)
            wd = extract_withdraw_fwd(args.pdf, pages_wd) if pages_wd else {}
        elif args.company == "chinalife":
            # 中国人寿傲珑盛世 (C540): X-clustering 11列取前6列 (退保发还金额)
            no_wd = extract_no_withdraw_chinalife(args.pdf, pages_nw)
            wd = {}  # C540 默认演示无提领场景
        elif args.company == "china-taiping":
            # 中国太平: 按 signature.productCode 分流 (颐年乐享 vs 鑫安逸)
            if args.signature == "china-taiping-1121nwlp7-v1":
                # 颐年乐享尊享版 1121NWLP7: 7列 (B+C+D+E) X-clustering
                no_wd = extract_no_withdraw_china_taiping_1121(args.pdf, pages_nw)
                wd = {}  # 默认演示无提领场景
            else:
                # 鑫安逸 (AAXNA1U): X-clustering 4列 (保證 only, 无分红)
                no_wd = extract_no_withdraw_taiping(args.pdf, pages_nw)
                wd = {}
        elif args.company == "pru":
            # 保诚: 按 signature.productCode 分流 (信守明天 vs 隽富)
            if args.signature == "pru-trst-v1":
                # 信守明天 TRST: 6列 X-clustering (Page 2 + 12-14)
                no_wd = extract_no_withdraw_pru(args.pdf, pages_nw)
                wd = {}  # 默认演示无提领场景
            else:
                # 隽富 CAESARS: 复用 CTF 通用提取器 (旧产品格式简单)
                no_wd = extract_no_withdraw_ctf(args.pdf, pages_nw)
                wd = extract_withdraw_ctf(args.pdf, pages_wd) if pages_wd else {}
        else:
            # 通用 fallback: 复用 CTF 提取器（部分产品格式相同）
            no_wd = extract_no_withdraw_ctf(args.pdf, pages_nw)
            wd = extract_withdraw_ctf(args.pdf, pages_wd) if pages_wd else {}

        paid_total = int(summary.get("premium_total") or 500000)
        pay_years = int(summary.get("payment_years") or 0)
        currency = summary.get("currency") or "USD"
        enrich(no_wd, paid_total, pay_years, currency)
        enrich(wd, paid_total, pay_years, currency)

        diagnostics = {
            "warnings": [],
            "parser": f"signature-extractor/{args.signature}",
            "noWithdrawRows": len(no_wd),
            "withdrawRows": len(wd),
        }
        if len(no_wd) < 20:
            diagnostics["warnings"].append(f"不提领表仅 {len(no_wd)} 行，预期 ≥20")
        print(json.dumps({
            "ok": True,
            "summary": summary,
            "paid_total": paid_total,
            "no_withdraw": {str(k): v for k, v in no_wd.items()},
            "withdraw": {str(k): v for k, v in wd.items()},
            "diagnostics": diagnostics,
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e), "signature": args.signature}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
