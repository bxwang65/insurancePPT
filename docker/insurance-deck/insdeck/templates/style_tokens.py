"""
共享样式常量 — 5 套主题 + 字体
所有渲染器 (PPTX/HTML/JSON/PDF) 共用
"""
from typing import Dict, Optional

# ── 各主题调色板 ──────────────────────────────────────
THEMES = {
    # 焦糖棕 (默认, 温暖专业)
    "caramel": {
        "primary":       "#8D624F",
        "primary_dark":  "#5C3F32",
        "primary_light": "#B08A78",
        "dark_text":     "#332825",
        "body_text":     "#442E24",
        "mid_text":      "#5A514A",
        "bg_page":       "#EFE4DF",
        "bg_light":      "#FBF9F6",
        "bg_card":       "#FEFCF7",
        "accent":        "#D4B878",
        "accent_light":  "#E5CC9A",
        "accent_dark":   "#A38A50",
        "white":         "#FFFFFF",
        "gray_line":     "#D6CDC4",
        "green":         "#2A7A4F",
        "red":           "#A0413F",
        "blue":          "#1E6FB5",
    },
    # 券商风 (深蓝+金, 专业高端)
    "broker": {
        "primary":       "#0D1B2A",
        "primary_dark":  "#070F1A",
        "primary_light": "#1B2A4A",
        "dark_text":     "#0D1B2A",
        "body_text":     "#1A2A3A",
        "mid_text":      "#4A5A6A",
        "bg_page":       "#F0F2F5",
        "bg_light":      "#F8F9FB",
        "bg_card":       "#FFFFFF",
        "accent":        "#C8963E",
        "accent_light":  "#D4B078",
        "accent_dark":   "#8A6A2A",
        "white":         "#FFFFFF",
        "gray_line":     "#D0D5DB",
        "green":         "#1A7A4A",
        "red":           "#B03A3A",
        "blue":          "#1A5A9A",
    },
    # 商务风 (藏青+米金, 稳重内敛)
    "business": {
        "primary":       "#17324D",
        "primary_dark":  "#0E1F32",
        "primary_light": "#2A4866",
        "dark_text":     "#17324D",
        "body_text":     "#2A3A4A",
        "mid_text":      "#5A6A7A",
        "bg_page":       "#F3F6FB",
        "bg_light":      "#FAFCFE",
        "bg_card":       "#FFFFFF",
        "accent":        "#C9A86A",
        "accent_light":  "#DCC89A",
        "accent_dark":   "#9A7A4A",
        "white":         "#FFFFFF",
        "gray_line":     "#D0D8E0",
        "green":         "#2A7A5A",
        "red":           "#B04A3A",
        "blue":          "#2A5A8A",
    },
    # 中国风 (朱红+金, 东方雅致)
    "chinese": {
        "primary":       "#7B1E1E",
        "primary_dark":  "#4A1010",
        "primary_light": "#A02C2C",
        "dark_text":     "#3A1A1A",
        "body_text":     "#5A2A2A",
        "mid_text":      "#7A5A5A",
        "bg_page":       "#FBF6EF",
        "bg_light":      "#FDF9F4",
        "bg_card":       "#FFFCF8",
        "accent":        "#C8A24D",
        "accent_light":  "#DDC080",
        "accent_dark":   "#9A7A30",
        "white":         "#FFFFFF",
        "gray_line":     "#D8CCC0",
        "green":         "#2A6A4A",
        "red":           "#B03030",
        "blue":          "#3A5A8A",
    },
    # 水墨风 (青灰+白, 写意留白)
    "ink": {
        "primary":       "#1F2D3D",
        "primary_dark":  "#101A28",
        "primary_light": "#3A4D63",
        "dark_text":     "#1A2A3A",
        "body_text":     "#3A4A5A",
        "mid_text":      "#6A7A8A",
        "bg_page":       "#F5F6F8",
        "bg_light":      "#FAFBFC",
        "bg_card":       "#FFFFFF",
        "accent":        "#8FA3B8",
        "accent_light":  "#B0C0D0",
        "accent_dark":   "#5A7088",
        "white":         "#FFFFFF",
        "gray_line":     "#C8D0D8",
        "green":         "#3A7A5A",
        "red":           "#A04A3A",
        "blue":          "#4A6A8A",
    },
    # 简洁风 (极简灰+红, 现代简约)
    "minimal": {
        "primary":       "#1A1A2E",
        "primary_dark":  "#0E0E1A",
        "primary_light": "#2D2D44",
        "dark_text":     "#1A1A2E",
        "body_text":     "#3A3A4A",
        "mid_text":      "#6A6A7A",
        "bg_page":       "#F5F5F7",
        "bg_light":      "#FAFAFC",
        "bg_card":       "#FFFFFF",
        "accent":        "#E94560",
        "accent_light":  "#F07080",
        "accent_dark":   "#B02A40",
        "white":         "#FFFFFF",
        "gray_line":     "#D0D0D8",
        "green":         "#2A8A5A",
        "red":           "#D04040",
        "blue":          "#3A6A9A",
    },
}

DEFAULT_THEME = "caramel"

FONT_HEI = 'STHeiti Medium'
FONT_LATIN = 'Calibri'


def get_theme(name: Optional[str] = None) -> Dict[str, str]:
    """按名称取主题色板, 未知名称回退到默认"""
    key = (name or DEFAULT_THEME).lower().strip()
    return THEMES.get(key, THEMES[DEFAULT_THEME])
