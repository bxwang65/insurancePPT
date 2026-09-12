"""
公司-产品知识库 (Company-Product Knowledge Base)

每个产品包含PDF自动识别签名 (signatures):
- title_match: 必须出现在PDF首页的关键词
- code_match: 计划代号 (如MW2IUA)

新增产品: 在对应公司下加一个键, 不需改其他代码
新增公司: 在COMPANIES下加一个键
"""
from typing import Dict, List, Optional, Tuple


COMPANIES: Dict[str, Dict] = {
    "ctf": {
        "name_zh": "周大福人寿保险有限公司",
        "name_en": "CTF Life Insurance Company Limited",
        "short": "周大福人寿",
        "short_en": "CTF LIFE",
        "rating": "A.M. Best a- (优秀)",
        "brand_profile": {
            "founded_year": "1985",
            "founded_label": "成立年份",
            "founded_sub": "立足香港近40年",
            "rating_agency": "A.M. Best",
            "rating_value": "a-",
            "rating_label": "财务实力评级",
            "rating_sub": "信用评级稳健 a-",
            "series_label": "匠心传承",
            "series_value": "系列",
            "series_sub": "财富传承专家",
            "series_products": "匠心系列产品",
            "business_lines": [
                "· 人寿保险 — 储蓄寿险 / 定期寿险 / 终身寿险",
                "· 健康保险 — 重疾保障 / 医疗险",
                "· 财富传承 — 匠心传承系列 / 万用寿险",
                "· 强积金 / 团体保险 — 企业员工保障",
            ],
            "brand_background": [
                "· 周大福集团旗下人寿保险公司",
                "· 郑氏家族控股，信誉悠久",
                "· 立足香港，服务亚太区客户",
                "· 核心理念：稳健传承 · 财富增值",
            ],
            "data_source": "周大福人寿官网 ctflife.com.hk · A.M. Best 公开资料",
        },
        "products": {
            "MW2IUA": {
                "name_zh": "「匠·传承」储蓄寿险计划2(尊尚版)",
                "name_short": "匠心传承2尊尚版",
                "type": "savings",
                "currency": "USD",
                "pdf_signatures": {
                    "title_keywords": ["匠", "传承", "尊尚版", "MW2IUA"],
                    "first_page_must_contain": ["受保人", "保障摘要"],
                },
                "presentation_pages": {
                    "summary": 0,           # 投保资料 (0-indexed)
                    "no_withdraw": [1, 2],  # 第3部分 (PDF p2-3 = 0-indexed 1-2)
                    "no_withdraw_death": [16, 17, 18],
                    "withdraw": [41, 42, 43, 44, 45, 46, 47, 48, 49],  # 第5部分
                    "withdraw_death": [46, 47, 48, 49],
                    "notes": [19, 20, 21],
                },
            },
        },
    },
    "aia": {
        "name_zh": "友邦保险（香港）有限公司",
        "name_en": "AIA International Limited (Hong Kong)",
        "short": "友邦保险",
        "short_en": "AIA HK",
        "rating": "AIA Co. aa- (Very Strong)",
        "brand_profile": {
            "founded_year": "1931",
            "founded_label": "成立年份",
            "founded_sub": "亚洲最大独立上市人寿集团",
            "rating_agency": "S&P",
            "rating_value": "AA-",
            "rating_label": "财务实力评级",
            "rating_sub": "S&P AA- (Very Strong)",
            "series_label": "环宇盈活",
            "series_value": "系列",
            "series_sub": "环球财富管理专家",
            "series_products": "环宇盈活系列产品",
            "business_lines": [
                "· 人寿保险 — 储蓄寿险 / 定期寿险 / 终身寿险",
                "· 健康保险 — 重疾保障 AIA Vitality / 医疗险",
                "· 财富传承 — 环宇盈活 / 财富挚2 / 简爱延续",
                "· 强积金 / 团体保险 — 企业员工保障",
            ],
            "brand_background": [
                "· 泛亚地区最大独立上市人寿保险集团",
                "· 业务覆盖亚太区18个市场",
                "· 立足香港，服务全球高净值客户",
                "· 核心理念：健康长久好生活",
            ],
            "data_source": "AIA HK 官网 aia.com.hk · S&P 公开资料",
        },
        "products": {
            "HUANYU5": {
                "name_zh": "「环宇盈活」储蓄保险计划（5年缴费）",
                "name_short": "环宇盈活5年缴",
                "type": "savings",
                "currency": "USD",
                "pdf_signatures": {
                    "title_keywords": ["盈活", "5 年缴费", "受保人"],
                    "first_page_must_contain": ["盈活", "受保人"],
                },
                "presentation_pages": {
                    "summary": 0,
                    "no_withdraw": [1],
                    "no_withdraw_pessimistic": [2, 3],
                    "withdraw": [15, 16, 17],
                    "withdraw_remainder": [18, 19, 20],
                    "notes": [4, 5, 6],
                },
                "extract_options": {
                    "withdraw_total_per_year": 35000,
                    "withdraw_start_y": 1,
                },
            },
        },
    },
}


def detect_company_product(pdf_text: str) -> Optional[Tuple[str, str, Dict]]:
    """
    根据PDF前2页文字自动识别公司+产品
    返回 (company_id, product_code, product_info) 或 None
    """
    for comp_id, comp in COMPANIES.items():
        for prod_code, prod in comp.get("products", {}).items():
            sig = prod.get("pdf_signatures", {})
            # 检查title关键词
            kws = sig.get("title_keywords", [])
            if all(kw in pdf_text for kw in kws):
                # 检查必含项
                must = sig.get("first_page_must_contain", [])
                if all(m in pdf_text for m in must):
                    return comp_id, prod_code, prod
    return None


def list_all_products() -> List[Dict]:
    """列出所有支持的产品 (CLI展示用)"""
    result = []
    for comp_id, comp in COMPANIES.items():
        for prod_code, prod in comp.get("products", {}).items():
            result.append({
                "company_id": comp_id,
                "company_zh": comp["name_zh"],
                "product_code": prod_code,
                "product_zh": prod["name_zh"],
                "type": prod["type"],
                "currency": prod["currency"],
            })
    return result
