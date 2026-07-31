#!/usr/bin/env python3
"""
Wiki Knowledge Enrichment Module for Insurance PPT Generator
======================================================================
从 ~/wiki/entities/*.md 读取公司实体数据，为PPT生成注入品牌背书、产品叙事和术语解释。

用法:
    from wiki_knowledge import WikiKnowledge
    wk = WikiKnowledge()
    
    # 公司概览
    overview = wk.get_company_overview("aia")
    # → {"name": "友邦保险 (AIA)", "overview": "香港最大的人寿保险公司...", "products": [...]}
    
    # 产品定位一句话
    tagline = wk.get_product_tagline("prudential", "savings")
    # → "英资最大寿险公司，分红险产品见长"
    
    # 叙事文案生成
    narrative = wk.generate_narrative("aia", "ci", {"annual_premium": 5000, "sum_insured": 250000})
    # → "友邦保险「加裕智倍保」系列 — 港险最受欢迎危疾险之一..."
"""

import re
from pathlib import Path
from typing import Optional, Dict, List, Any

# ─── Wiki路径配置 ──────────────────────────────────────────
_WIKI_ROOT = Path.home() / "wiki"
_ENTITIES_DIR = _WIKI_ROOT / "entities"


def _slugify(name: str) -> str:
    """将公司名转换为slug: '友邦保险' → 'aia', '保诚保险' → 'prudential'"""
    # 已知映射表（来自entities目录文件）
    _NAME_TO_SLUG = {
        "友邦": "aia", "友邦保险": "aia",
        "保诚": "prudential", "保诚保险": "prudential",
        "宏利": "manulife", "宏利保险": "manulife",
        "万通": "yflife", "万通保险": "yflife",
        "安盛": "axa", "安盛保险": "axa",
        "富卫": "fwd", "富卫保险": "fwd",
        "永明": "sunlife", "永明保险": "sunlife",
        "太平": "taipinglife", "太平人寿": "taipinglife",
        "中银": "boclife", "中银人寿": "boclife",
        "周大福": "ctflife", "周大福人寿": "ctflife",
        "富邦": "fubon", "富邦人寿": "fubon",
        "中国人寿": "chinalife",
        "太保": "cpic", "中国太保": "cpic",
        "忠利": "generali",
        "蓝十字": "blue",
        "安达人寿": "chubb",
        "瑞士保险": "zurich",
        "立桥": "lwlife",
    }
    name = name.strip()
    if name in _NAME_TO_SLUG:
        return _NAME_TO_SLUG[name]
    # fuzzy match: first two chars
    for key, slug in _NAME_TO_SLUG.items():
        if name.startswith(key) or key.startswith(name):
            return slug
    # slugify fallback
    s = re.sub(r'[\W\s]+', '', name).lower()
    return s[:12]


class WikiKnowledge:
    """内存缓存的wiki知识库读取器"""
    
    def __init__(self, lazy: bool = True):
        """
        lazy=True: 首次调用时才加载（推荐）
        lazy=False: 初始化时全部加载到内存
        """
        self._cache: Dict[str, Dict] = {}
        self._loaded = False
        self._lazy = lazy
    
    def _ensure_loaded(self):
        if self._loaded:
            return
        self._load_all()
        self._loaded = True
    
    def _load_all(self):
        """将所有entities加载到内存字典"""
        if not _ENTITIES_DIR.exists():
            return
        # 白名单slug列表（已知有效的entity名称）
        KNOWN_SLUGS = {"周大福人寿", "富卫", "AIA", "友邦", "宏利", "Manulife",
                       "保诚", "Prudential", "永明", "Sunlife", "安盛", "AXA",
                       "太平", "中银", "Chow Tai Fook Life", "FWD Group",
                       "AIA Group", "Manulife Hong Kong", "Prudential plc",
                       "Sun Life Financial", "AXA Hong Kong", "Taiping Life",
                       "Bank of China Life"}

        for f in _ENTITIES_DIR.glob("*.md"):
            slug = f.stem
            # 跳过不在白名单中的文件
            if KNOWN_SLUGS and slug not in KNOWN_SLUGS:
                continue
            self._cache[slug] = self._parse_entity(f)
    
    def _parse_entity(self, path: Path) -> Dict[str, Any]:
        """解析单个entity markdown文件"""
        content = path.read_text(encoding="utf-8")
        lines = content.split("\n")
        
        # Parse frontmatter
        in_fm = False
        fm = {}
        body_lines = []
        in_body = False
        
        for line in lines:
            if line.strip() == "---":
                in_fm = not in_fm
                in_body = not in_fm
                continue
            if in_fm and ":" in line:
                key, val = line.split(":", 1)
                fm[key.strip()] = val.strip().strip('"')
            elif in_body:
                body_lines.append(line)
        
        body = "\n".join(body_lines)
        
        # Extract ## subsections
        sections = {}
        current_heading = None
        current_content = []
        
        for line in body_lines:
            m = re.match(r'^## (.+)$', line)
            if m:
                if current_heading:
                    sections[current_heading] = "\n".join(current_content).strip()
                current_heading = m.group(1)
                current_content = []
            elif current_heading:
                current_content.append(line)
        if current_heading:
            sections[current_heading] = "\n".join(current_content).strip()
        
        return {
            "path": str(path),
            "title": fm.get("title", path.stem),
            "tags": [t.strip() for t in fm.get("tags", "").strip("[]").split(",") if t.strip()],
            "confidence": fm.get("confidence", "medium"),
            "sections": sections,
            "body": body,
        }
    
    def _best_match(self, query: str) -> Optional[str]:
        """模糊匹配公司名/slug → 最可能的entity slug"""
        if query in self._cache:
            return query
        # Try slugify
        slug = _slugify(query)
        if slug in self._cache:
            return slug
        # Try contains in title
        q_lower = query.lower()
        for slug, info in self._cache.items():
            if q_lower in info["title"].lower() or q_lower in slug:
                return slug
        return None
    
    # ─── Public API ────────────────────────────────────────
    
    def get_company_overview(self, company_name_or_slug: str) -> Optional[Dict]:
        """
        返回公司概览信息
        {
            "name": "友邦保险 (AIA)",
            "slug": "aia",
            "overview": "香港最大的人寿保险公司之一...",
            "key_products": ["充裕未来", "盈御多元货币计划", ...],
            "tags": ["保险公司", "储蓄险", "危疾险", ...],
            "brand_line": "香港最大人寿保险公司，亚太区18个市场"
        }
        """
        if self._lazy:
            self._ensure_loaded()
        
        slug = self._best_match(company_name_or_slug)
        if not slug or slug not in self._cache:
            return None
        
        info = self._cache[slug]
        sections = info["sections"]
        
        # Extract key products from ## 主要产品线 section
        key_products = []
        prod_section = sections.get("主要产品线", "")
        for line in prod_section.split("\n"):
            m = re.search(r'「([^」]+)」', line)
            if m:
                key_products.append(m.group(1))
        
        # Build overview from ## 概览
        overview = sections.get("概览", info["body"][:300]).strip()
        
        # Brand line: first sentence of overview
        brand_line = overview.split("。")[0] + "。" if "。" in overview else overview
        
        return {
            "name": info["title"],
            "slug": slug,
            "overview": overview,
            "key_products": key_products[:6],
            "tags": info["tags"],
            "brand_line": brand_line,
            "confidence": info["confidence"],
        }
    
    def get_product_tagline(self, company_name_or_slug: str, plan_type: str) -> Optional[str]:
        """
        返回产品定位一句话（用于PPT图表注释）
        plan_type: "savings" | "ci" | "iul" | "medical"
        """
        if self._lazy:
            self._ensure_loaded()
        
        slug = self._best_match(company_name_or_slug)
        if not slug:
            return None
        
        info = self._cache.get(slug, {})
        sections = info.get("sections", {})
        
        # Map plan_type → section heading
        type_map = {
            "savings": "储蓄险",
            "ci": "危疾险",
            "iul": "万用寿险",
            "medical": "医疗险",
        }
        heading = type_map.get(plan_type, plan_type)
        
        section = sections.get(heading, "")
        if not section:
            return None
        
        # First bullet that contains a product name
        for line in section.split("\n"):
            if "「" in line:
                # Return the product line cleaned
                line = re.sub(r'^[-*]\s*', '', line).strip()
                return line
        
        return section.split("\n")[0] if section else None
    
    def generate_narrative(self, company_name_or_slug: str, plan_type: str,
                           numbers: Dict[str, Any] = None) -> str:
        """
        生成销售叙事文案（用于叙事框）
        
        Args:
            company_name_or_slug: "aia" / "友邦保险"
            plan_type: "savings" | "ci" | "iul"
            numbers: 可选，传入关键数字用于个性化
                    e.g. {"annual_premium": 5000, "sum_insured": 250000}
        
        Returns:
            产品专属叙事文案（1-2句话）
        """
        if self._lazy:
            self._ensure_loaded()
        
        slug = self._best_match(company_name_or_slug)
        info = self._cache.get(slug, {}) if slug else {}
        sections = info.get("sections", {})
        
        plan_type_to_heading = {
            "savings": "储蓄险",
            "ci": "危疾险",
            "iul": "万用寿险",
            "medical": "医疗险",
        }
        heading = plan_type_to_heading.get(plan_type, plan_type)
        
        # Build narrative from product section + brand overview
        brand = info.get("title", company_name_or_slug)
        prod_section = sections.get(heading, "")
        
        # Extract flagship product
        flagship = ""
        for line in prod_section.split("\n"):
            m = re.search(r'「([^」]+)」.*— (.+)', line)
            if m:
                flagship, desc = m.group(1), m.group(2)
                break
        
        narratives = {
            "savings": (
                f"{brand}的{flagship or '储蓄险'}，"
                f"以复利累积为核心，适合教育金、退休规划和长期财富增值。"
                if flagship else f"{brand}的储蓄险计划，以复利累积为核心，助您实现长期财务目标。"
            ),
            "ci": (
                f"{brand}的{flagship or '危疾险'}，"
                f"保障全面、赔付及时，是家庭风险管理的基石。"
                if flagship else f"{brand}的危疾保障计划，为您和家人提供全面的健康风险防护。"
            ),
            "iul": (
                f"{brand}的{flagship or '指数型万用寿险'}，"
                f"双账户结构兼顾保证与增长潜力，挂钩S&P 500指数，适合长期传承规划。"
                if flagship else f"{brand}的万用寿险产品，双账户兼顾保证与增长，适合长期传承规划。"
            ),
        }
        
        base = narratives.get(plan_type, f"{brand}的家庭保障方案，守护您和家人的未来。")
        
        if numbers:
            # Personalize with actual numbers if provided
            if "annual_premium" in numbers and "sum_insured" in numbers:
                ap = numbers["annual_premium"]
                si = numbers["sum_insured"]
                base += f"年缴 ${ap:,.0f}，即可获得 ${si:,.0f} 的全面保障。"
        
        return base
    
    def get_comparison_context(self, company_name_or_slug: str) -> Optional[str]:
        """获取竞品对比上下文（用于comparison table注释）"""
        if self._lazy:
            self._ensure_loaded()
        
        slug = self._best_match(company_name_or_slug)
        if not slug:
            return None
        
        info = self._cache.get(slug, {})
        sections = info.get("sections", {})
        related = sections.get("相关公司", "")
        
        # Parse [[wikilinks]] → company names
        companies = re.findall(r'\[\[([^\]]+)\]\]', related)
        if companies:
            return "竞争产品：" + " / ".join(companies[:3])
        return None
    
    def get_all_slugs(self) -> List[str]:
        """返回所有已加载的公司slug列表"""
        if self._lazy:
            self._ensure_loaded()
        return list(self._cache.keys())
    
    def has_company(self, company_name_or_slug: str) -> bool:
        """检查公司是否在wiki中存在"""
        if self._lazy:
            self._ensure_loaded()
        return self._best_match(company_name_or_slug) is not None
    
    def get_all_companies(self) -> List[Dict]:
        """返回所有公司的简要信息列表"""
        if self._lazy:
            self._ensure_loaded()
        return [
            {
                "slug": slug,
                "name": info["title"],
                "tags": info["tags"],
                "confidence": info["confidence"],
            }
            for slug, info in self._cache.items()
        ]


# ─── 全局单例（进程内复用）─────────────────────────────────
_wiki_instance: Optional[WikiKnowledge] = None

def get_wiki() -> WikiKnowledge:
    """获取wiki知识库单例（延迟加载）"""
    global _wiki_instance
    if _wiki_instance is None:
        _wiki_instance = WikiKnowledge(lazy=True)
    return _wiki_instance


# ─── 快速测试入口 ──────────────────────────────────────────
if __name__ == "__main__":
    wk = WikiKnowledge(lazy=False)
    print(f"✅ Loaded {len(wk._cache)} company entities\n")
    
    # Test AIA
    overview = wk.get_company_overview("aia")
    if overview:
        print(f"🏢 {overview['name']}")
        print(f"   品牌语: {overview['brand_line']}")
        print(f"   核心产品: {overview['key_products']}")
        print()
    
    # Test narrative generation
    narrative = wk.generate_narrative("aia", "ci", {"annual_premium": 5000, "sum_insured": 250000})
    print(f"💬 重疾险叙事:\n   {narrative}\n")
    
    narrative = wk.generate_narrative("yflife", "iul")
    print(f"💬 IUL叙事:\n   {narrative}\n")
    
    # Test tagline
    tagline = wk.get_product_tagline("prudential", "savings")
    print(f"🏷️ 保诚储蓄定位: {tagline}")