#!/usr/bin/env python3
"""宏利新加坡 IUL 专用 OCR 提取器 (fitz + tesseract)
PDF 全图片, 需 OCR 识别表格文字

用法: python3 extract_manulife_iul_ocr.py <pdf_path>
"""
import json, re, sys, os
import fitz
import pytesseract
from PIL import Image
import io

def number(v):
    if v in ("", "-", None, "None", "N/A"): return 0
    try: return float(str(v).replace(",", "").replace("$", "").replace(" ", "").replace(",", ""))
    except: return 0

def ocr_image(img_bytes):
    """OCR 图片返回文字 (单图异常不中断整个流程)"""
    try:
        img = Image.open(io.BytesIO(img_bytes))
        # 放大以提高 OCR 精度
        w, h = img.size
        img = img.resize((w * 2, h * 2), Image.LANCZOS)
        # 关键: tesseract 错误流可能含非 UTF-8 字节, 包 try/except 防止单页崩
        text = pytesseract.image_to_string(img, lang='eng', config='--psm 6')
        return text
    except Exception as e:
        return f"[OCR_ERROR: {type(e).__name__}: {str(e)[:80]}]"

def extract_manulife_iul(pdf_path):
    doc = fitz.open(pdf_path)

    # OCR 所有页面
    all_text = ""
    for i in range(len(doc)):
        images = doc[i].get_images(full=True)
        for img_idx, img in enumerate(images):
            xref = img[0]
            base_img = doc.extract_image(xref)
            img_bytes = base_img["image"]
            text = ocr_image(img_bytes)
            all_text += f"\n--- Page {i} Image {img_idx} ---\n{text}"

    doc.close()

    # 如果所有页都 OCR 失败, 返回空结果而不是抛异常
    if "[OCR_ERROR" in all_text and "Age" not in all_text and "Premium" not in all_text:
        # 大部分图片都失败, 提示改用 M3 多模态
        print(f"[warn] OCR failed on most pages, recommend M3 multimodal", file=sys.stderr)

    # 提取摘要信息
    info = {}
    m = re.search(r'(?:Age|年齡)[：:.\s]*(\d+)', all_text)
    if m: info['age'] = int(m.group(1))
    m = re.search(r'(?:Face|保障額|保额)[：:.\s]*\$?([0-9,]+)', all_text)
    if m: info['sum_insured'] = number(m.group(1))
    m = re.search(r'(?:Annual Premium|年缴|保费)[：:.\s]*\$?([0-9,]+)', all_text)
    if m: info['annual_premium'] = number(m.group(1))
    if 'Female' in all_text or '女' in all_text: info['gender'] = 'Female'
    elif 'Male' in all_text or '男' in all_text: info['gender'] = 'Male'

    # 解析表格行: 寻找数字行
    rows = []
    lines = all_text.split('\n')
    for line in lines:
        # 匹配格式: 年份 年龄 金额 金额 金额 ...
        nums = re.findall(r'[\d,]+(?:\.\d+)?', line.replace(',', ''))
        if len(nums) >= 5:
            try:
                yr = int(nums[0])
                if yr <= 0 or yr > 200: continue
                age = int(nums[1]) if len(nums) > 1 else 0
                premium = number(nums[2]) if len(nums) > 2 else 0
                vals = [number(n) for n in nums[3:]]
                # 尝试识别列: 现金价值/账户价值/身故赔偿
                cv = vals[0] if len(vals) > 0 else 0
                acct = vals[1] if len(vals) > 1 else 0
                db = vals[2] if len(vals) > 2 else (vals[1] if len(vals) > 1 else 0)

                rows.append({
                    "policy_year": yr,
                    "total_premium_paid": premium,
                    "non_guaranteed_cash_value": cv,
                    "non_guaranteed_account_value": acct,
                    "death_benefit": db,
                    "source_page": 0,
                })
            except:
                continue

    # 去重
    seen = set()
    unique = []
    for r in sorted(rows, key=lambda x: x['policy_year']):
        if r['policy_year'] not in seen:
            seen.add(r['policy_year'])
            unique.append(r)

    result = {
        "benefit_illustration": unique,
        "summary": {
            "insured_age": info.get('age', 0),
            "insured_gender": info.get('gender', ''),
            "annual_premium": info.get('annual_premium', 0),
            "sum_insured": info.get('sum_insured', 0),
        },
        "diagnostics": {"parser": "manulife-iul-ocr", "rows_found": len(unique)},
    }
    return result

if __name__ == "__main__":
    pdf = sys.argv[1]
    result = extract_manulife_iul(pdf)
    print(json.dumps(result, default=str))
