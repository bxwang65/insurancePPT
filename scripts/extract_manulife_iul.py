#!/usr/bin/env python3
"""
Manulife 新加坡 IUL 专用提取器 (OCR, eng + chi_tra)
PDF 全图片 (CJS 字体子集化), 需 tesseract OCR 识别

Manulife IUL PDF 结构 (基于 14 份样本 100% 一致):
  Page 1: 保單摘要 (Policy Summary)
    - 保單名稱: Male/Female
    - 受保人的風險等級: Non-Smoker Standard
    - 上一次生日年齡: N
    - 所居住的國家/城市: CHINA
    - 居住代號: P
    - 最低首期保費: US$XXX
    - 一開始的身故利益: US$XXX (保单面值)
    - 忠誠紅利派息率: 0.80%* p.a. 從第11年至第N年
    - 指數賬戶 100% (含 S&P 500 / S&P PRISM / Hang Seng / Euro Stoxx 50 / S&P GSCI Gold ER)
  Page 2-5: 附屬說明 (Supplementary Illustration)
    - 兩個連續場景: 最高收費 (page 2-3) + 當前收費 (page 3-4 或 4-5)
    - 7 列: 保單年度/結束年齡, 保費進度安排, 保單價值減去退保收費, 最低退保價值, 退保價值, 保單面值, 身故利益
  Page 6: 輸入摘要 (Input Summary)
    - 受保人姓名, 性別, 年齡, 風險等級, 保單面值
    - 從第1年至第X年 (X 即為繳費年期)

用法: python3 extract_manulife_iul.py <pdf_path>
输出: JSON 同 extract_sunlife_iul.py 格式
"""
import json
import os
import re
import sys
import io
import contextlib
from pathlib import Path
import fitz
from PIL import Image
import subprocess
import tempfile

os.environ.setdefault("PYMUPDF_LOG", "no")


def _ocr_with_tesseract(img: Image.Image, lang: str = 'eng+chi_tra') -> str:
    """
    OCR via subprocess (pytesseract 在某些环境会因 tesseract stderr 含二进制数据而崩溃)
    关键: tesseract 在 macOS 沙盒下不能读 /tmp 路径, 改用包内 .tess_tmp/ 目录
    """
    tmp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".tess_tmp")
    tmp_dir = os.path.realpath(tmp_dir)
    os.makedirs(tmp_dir, exist_ok=True)

    tmp_path = os.path.join(tmp_dir, "page.png")
    img.save(tmp_path, format='PNG')

    try:
        # 关键: tesseract 写 stdout.txt, cwd=tmp_dir
        result = subprocess.run(
            ['tesseract', tmp_path, 'stdout', '-l', lang, '--psm', '6'],
            capture_output=True,
            timeout=60,
            cwd=tmp_dir,
        )
        return result.stdout.decode('utf-8', errors='replace')
    finally:
        for ext in ('', '.txt'):
            try:
                os.unlink(tmp_path + ext)
            except OSError:
                pass

@contextlib.contextmanager
def _silence_stdout():
    saved = sys.stdout
    try:
        sys.stdout = io.StringIO()
        yield
    finally:
        sys.stdout = saved


def number(v):
    """解析数字: 22,250 → 22250, US$1,000,000 → 1000000, - → 0"""
    if v in ("", "-", None, "N/A", "##"):
        return 0
    try:
        return float(str(v).replace(",", "").replace("$", "").replace("US$", "").replace(" ", "").replace("USD", ""))
    except (ValueError, AttributeError):
        return 0


def ocr_page(doc, page_idx, dpi=2.5, lang='eng+chi_tra'):
    """OCR 单页: fitz 渲染 → PIL Image → tesseract via subprocess"""
    page = doc[page_idx]
    mat = fitz.Matrix(dpi, dpi)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    return _ocr_with_tesseract(img, lang=lang)


def extract_summary_page1(text):
    """
    从 page 1 OCR 文本提取摘要信息
    返回: { insured_age, insured_gender, annual_premium, sum_insured, premium_payment_years, index_accounts }
    """
    info = {}

    # 性别: "保單名稱" 后面是 Male 或 Female
    m = re.search(r'保單\s*名稱\s*(Male|Female|男|女)', text)
    if m:
        info['insured_gender'] = 'Male' if m.group(1) in ('Male', '男') else 'Female'
    else:
        # 备选: 直接搜 Male/Female
        if 'Female' in text:
            info['insured_gender'] = 'Female'
        elif 'Male' in text:
            info['insured_gender'] = 'Male'

    # 年龄: "上一次生日年齡" 后跟数字
    m = re.search(r'上\s*一\s*次\s*生\s*日\s*年\s*齡\s*[:：]?\s*(\d+)', text)
    if m:
        info['insured_age'] = int(m.group(1))
    else:
        # 备选: 风险等级后面的数字 (OCR 经常把 "上一次生日年齡" 乱码)
        # 模式: "...風險等級: Non-Smoker Standard ... 数字"
        m = re.search(r'(?:風險\s*等\s*級|風\s*險\s*等\s*級)[：:\s]*(?:Non-Smoker\s+Standard)?\s*[A-Z\s]*[A-Z]?[:：]?\s*(\d{1,3})', text)
        if m:
            age = int(m.group(1))
            if 0 < age < 120:
                info['insured_age'] = age

    # 身故利益 (保单面值): "一開始的身故利益 US$X,XXX,XXX.XX"
    m = re.search(r'一\s*開\s*始\s*的\s*身\s*故\s*利\s*益\s*US?\$?([\d,]+\.?\d*)', text)
    if m:
        info['sum_insured'] = number(m.group(1))

    # 最低首期保费 (单年保费)
    m = re.search(r'最\s*低\s*首\s*期\s*保\s*費\s*US?\$?([\d,]+\.?\d*)', text)
    if m:
        info['min_initial_premium'] = number(m.group(1))

    # 缴费年期: 從第N年至第M年 → M = 缴费年期
    m = re.search(r'從\s*第\s*(\d+)\s*年\s*至\s*第\s*(\d+)\s*年', text)
    if m:
        info['premium_payment_years'] = int(m.group(2))
    else:
        # 趸交 (1x) 没有 "從第X年至第Y年" 字样
        info['premium_payment_years'] = None

    # 指数账户配置
    info['index_accounts'] = extract_index_accounts(text)

    return info


def extract_index_accounts(text):
    """
    从 page 1 提取指数账户配置
    Manulife 固定账户 0%, 然后是各指数子账户
    """
    accounts = []

    # 固定账户
    if '固定賬戶' in text or '固定账户' in text:
        # 模式: 固定賬戶 0% 每年 2.00% (保证) 每年 4.20% (当前)
        seg = text[text.find('固定賬戶'):] if '固定賬戶' in text else text[text.find('固定账户'):]
        rates = re.findall(r'每\s*年\s*(\d+(?:\.\d+)?)\s*%', seg)
        accounts.append({
            "name": "固定账户",
            "allocation": 0,
            "current_assumed_rate": f"{rates[-1]}%" if rates else "4.20%",
            "guaranteed_floor_rate": "2.00%",
            "cap_rate": None,
            "participation_rate": None,
        })

    # S&P 500 Plus 指数子账户
    if 'S&P 500 Plus' in text:
        seg = text[text.find('S&P 500 Plus'):text.find('S&P PRISM')] if 'S&P PRISM' in text else text[text.find('S&P 500 Plus'):]
        # 模式: 100% 100% 0.00% 每年 7.65%
        m = re.search(r'(\d+)\s*%\s+(\d+)\s*%\s+(\d+(?:\.\d+)?)\s*%\s*每\s*年\s*(\d+(?:\.\d+)?)\s*%', seg)
        if m:
            accounts.append({
                "name": "S&P 500 Plus",
                "allocation": number(m.group(1)),
                "current_assumed_rate": f"{m.group(4)}%",
                "guaranteed_floor_rate": f"{m.group(3)}%",
                "cap_rate": None,
                "participation_rate": f"{m.group(2)}%",
            })
        else:
            accounts.append({
                "name": "S&P 500 Plus",
                "allocation": 100,
                "current_assumed_rate": "7.65%",
                "guaranteed_floor_rate": "0.00%",
                "cap_rate": None,
                "participation_rate": "100%",
            })

    # S&P PRISM 指数子账户
    if 'S&P PRISM' in text:
        seg = text[text.find('S&P PRISM'):text.find('S&P 500')] if 'S&P 500' in text else text[text.find('S&P PRISM'):]
        m = re.search(r'(\d+)\s*%\s+(\d+)\s*%', seg)
        if m:
            accounts.append({
                "name": "S&P PRISM",
                "allocation": number(m.group(1)),
                "current_assumed_rate": "7.55%",
                "guaranteed_floor_rate": "0.00%",
                "cap_rate": None,
                "participation_rate": f"{m.group(2)}%",
            })
        else:
            accounts.append({
                "name": "S&P PRISM",
                "allocation": 0,
                "current_assumed_rate": "7.55%",
                "guaranteed_floor_rate": "0.00%",
                "cap_rate": None,
                "participation_rate": "146%",
            })

    return accounts


def extract_illustration_pages(doc, max_pages=6, base_age=50):
    """
    OCR pages 2-6 (附屬說明), 提取 7 列利益表
    选取 "當前收費" 场景 (跳过 最高收費)

    返回: [{policy_year, age, planned_premium, account_value_less_fee,
            min_surrender_value, surrender_value, sum_insured, death_benefit, source_page}, ...]
    """
    all_rows = []

    for page_idx in range(1, min(max_pages + 1, len(doc))):
        try:
            text = ocr_page(doc, page_idx, dpi=2.5)
        except Exception as e:
            print(f"[warn] OCR page {page_idx+1} failed: {e}", file=sys.stderr)
            continue

        # 检测场景: 最高收費 vs 當前收費
        # 关键: OCR 在字符间可能加空格, 用 \s* 兼容
        is_current = bool(re.search(r'當\s*前\s*假\s*設', text)) and bool(re.search(r'當\s*前\s*收\s*費', text))
        is_max = bool(re.search(r'最\s*高\s*收\s*費', text))

        if is_max and not is_current:
            # 最高收費场景, 跳过
            continue
        if not is_current and not is_max:
            # 不是利益表页, 跳过
            continue

        # 解析表格行 (base_age 用于 OCR 掉 "1/" 前缀时反推 year)
        rows = parse_table_lines(text, source_page=page_idx + 1, base_age=base_age)
        all_rows.extend(rows)

    return all_rows


def parse_table_lines(text, source_page, base_age=50):
    """
    解析 OCR 文本中的表格行
    7 列数字行格式: "1/51 22,250 14,732 0 0 0 1,000,000 1,000,000"

    OCR 经常:
    - 把 "1/" 前缀吃掉 ("51 32,350 19,088 ..." → age only)
    - 数字间加空格
    - 把 0 拆成 "0 "

    兼容三种模式:
    A. "1/51 NUMBERS" → year=1, age=51
    B. "51 NUMBERS" → age=51, year=age-base_age (用受保人年龄反推)
    C. "11/61 NUMBERS" → year=11, age=61
    """
    rows = []
    lines = text.split('\n')

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # 模式 A 或 C: "DIGITS/DIGITS NUMS"
        m = re.match(r'^(\d+)\s*/\s*(\d+)\s+(.+)$', line)
        if m:
            year = int(m.group(1))
            age = int(m.group(2))
            rest = m.group(3)
        else:
            # 模式 B: "DIGITS NUMS" (无 slash, 第一列就是 age)
            m = re.match(r'^(\d+)\s+(.+)$', line)
            if not m:
                continue
            age = int(m.group(1))
            rest = m.group(2)
            if not (0 < age < 200):
                continue
            nums_check = re.findall(r'[\d,]+', rest)
            if len(nums_check) < 6:
                continue
            # 关键: 用受保人年龄反推 year (age = base_age + year)
            year = age - base_age
            if year < 1:
                continue

        # 提取数字
        nums = re.findall(r'[\d,]+', rest)
        if len(nums) < 6:
            continue

        # 合理性检查
        if not (0 < year < 200 and 0 < age < 200):
            continue

        # 关键: Manulife IUL 表的列定义 (基于14份样本 100% 一致)
        # 7 列数字: 保費 | 保單價值 | 保單價值減退保收費 | 最低退保價值 | 退保價值 | 保單面值 | 身故利益
        # nums[0] = 保費 (planned_premium)
        # nums[1] = 保單價值 (account_value, 完整账户价值, 含未来费用)
        # nums[2] = 保單價值減退保收費 (account_value_less_fee)
        # nums[3] = 最低退保價值 (min_surrender_value)
        # nums[4] = 退保價值 (surrender_value) ← 用户标记的"表格第6列", 关键修复点
        # nums[5] = 保單面值 (sum_insured)
        # nums[6] = 身故利益 (death_benefit)
        # 旧版错误: 假设 6 列布局, 把 最低退保價值 当成 退保價值 (off-by-one)
        if len(nums) >= 7:
            # 标准 7 列布局: 跳过 nums[1] (保單價值)
            rows.append({
                'policy_year': year,
                'age': age,
                'planned_premium': number(nums[0]),
                'account_value': number(nums[1]),  # 新增: 完整账户价值
                'account_value_less_fee': number(nums[2]),
                'min_surrender_value': number(nums[3]),
                'surrender_value': number(nums[4]),  # 关键修复: 旧版读 nums[3]
                'sum_insured': number(nums[5]),  # 旧版读 nums[4] (错误)
                'death_benefit': number(nums[6] if len(nums) >= 7 else nums[5]),  # 旧版读 nums[5]
                'source_page': source_page,
            })
        else:
            # 6 列布局 (罕见, 旧版 PDF): 不含 保單價值 列
            rows.append({
                'policy_year': year,
                'age': age,
                'planned_premium': number(nums[0]),
                'account_value_less_fee': number(nums[1]),
                'min_surrender_value': number(nums[2]),
                'surrender_value': number(nums[3]),
                'sum_insured': number(nums[4]),
                'death_benefit': number(nums[5]),
                'source_page': source_page,
            })

    return rows


def dedup_and_normalize(all_rows):
    """
    去重 (按 policy_year) + 累加累计保费
    同一个保单年度可能在多页出现 (跨页), last-occurrence wins
    """
    if not all_rows:
        return []

    by_year: dict = {}
    for r in sorted(all_rows, key=lambda x: (x['policy_year'], x['source_page'])):
        by_year[r['policy_year']] = r  # 后到覆盖先到

    unique = [by_year[y] for y in sorted(by_year.keys())]

    # 累加累计保费
    cumulative = 0.0
    for r in unique:
        cumulative += r.get('planned_premium', 0)
        r['cumulative_premium_paid'] = cumulative

    return unique


def detect_payment_term(unique_rows):
    """
    数据驱动识别缴费年期: 统计 planned_premium > 0 的连续行数
    趸交 → 1, 5年 → 5, 10年 → 10
    (优于 page 1 "從第X年至第Y年" 提取, 因为后者可能是忠诚红利期 11-57 不是缴费年期)
    """
    if not unique_rows:
        return 0
    pay_years = 0
    for r in unique_rows:
        if r.get('planned_premium', 0) > 0:
            pay_years += 1
        else:
            break  # 连续非零行结束
    return pay_years


def extract_manulife_iul(pdf_path):
    """主入口"""
    with _silence_stdout():
        doc = fitz.open(pdf_path)
        page_count = len(doc)

        # 1. OCR page 1 拿摘要
        page1_text = ocr_page(doc, 0, dpi=2.5)
        summary = extract_summary_page1(page1_text)

        # 2. OCR pages 2-8 拿利益表 (22页版本主场景可能跨多页)
        #    标准 6 页版本只到 page 5, 多读无害
        base_age = summary.get('insured_age', 50) or 50
        all_rows = extract_illustration_pages(doc, max_pages=min(8, page_count), base_age=base_age)

        doc.close()

    # 3. 去重 + 累加
    unique_rows = dedup_and_normalize(all_rows)

    # 4. 自动识别缴费年期 (数据驱动, 不依赖 page 1 的 "從第X年至第Y年" 字段, 那个可能是忠诚红利期)
    pay_years = detect_payment_term(unique_rows)

    # 5. 关键: annual_premium 从数据取 (比 raw 提取的 min_initial_premium 更可靠)
    first_year_premium = next((r['planned_premium'] for r in unique_rows if r['planned_premium'] > 0), 0)
    if first_year_premium == 0:
        first_year_premium = summary.get('min_initial_premium', 0)

    # 6. 年龄 fallback: 如果 page 1 OCR 没拿到年龄, 从 illustration 数据反推 (Y1的age - 1)
    if not summary.get('insured_age') and unique_rows:
        first = unique_rows[0]
        if first.get('age', 0) > 1:
            summary['insured_age'] = first['age'] - 1

    # 6. 累计保费
    total_premium = unique_rows[-1].get('cumulative_premium_paid', 0) if unique_rows else 0

    result = {
        "benefit_illustration": unique_rows,
        "summary": {
            "insured_age": summary.get('insured_age', 0),
            "insured_gender": summary.get('insured_gender', ''),
            "annual_premium": first_year_premium,
            "sum_insured": summary.get('sum_insured', 0),
            "index_accounts": summary.get('index_accounts', []),
            "payment_term_years": pay_years,
            "payment_term_label": "趸交" if pay_years == 1 else f"{pay_years}年",
            "total_premium_paid": total_premium,
        },
        "diagnostics": {
            "parser": "manulife-iul-ocr",
            "rows_found": len(unique_rows),
            "pages_scanned": page_count,
        }
    }
    return result


if __name__ == "__main__":
    pdf = sys.argv[1]
    with _silence_stdout():
        result = extract_manulife_iul(pdf)
    print(json.dumps(result, default=str, ensure_ascii=False))
