"""
PPT style definitions for insurance proposal presentations.
Each style defines colors, fonts, layouts for the entire deck.
"""

STYLES = {
    "professional": {
        "name": "专业风",
        "colors": {
            "bg_dark": "#0D1B2A",
            "bg_light": "#F5F7FA",
            "bg_card": "#14273E",
            "accent": "#C8963E",
            "accent_gold": "#C8963E",
            "accent2": "#00D4AA",
            "accent_teal": "#00D4AA",
            "accent_blue": "#4FC3F7",
            "text_white": "#FFFFFF",
            "text_dark": "#1A1A2E",
            "text_gray": "#B0BEC5",
            "text_body": "#E0E0E0",
            "chart_1": "#C8963E",
            "chart_2": "#00D4AA",
            "chart_3": "#4FC3F7",
            "success": "#66BB6A",
            "warning": "#FFA726",
        },
        "fonts": {
            "title": "Calibri",
            "body": "PingFang SC",
            "size_title": 36,
            "size_heading": 22,
            "size_subheading": 18,
            "size_body": 14,
            "size_small": 11,
        },
        "layout": {
            "corner_radius": 8,
            "card_radius": 8,
            "card_shadow": True,
            "header_bar": True,
        }
    },
    "fresh": {
        "name": "清新风",
        "colors": {
            "bg_dark": "#1A3A3A",
            "bg_light": "#F3F8F8",
            "bg_card": "#FFFFFF",
            "accent": "#26A69A",
            "accent_gold": "#26A69A",
            "accent2": "#80CBC4",
            "accent_teal": "#80CBC4",
            "accent_blue": "#42A5F5",
            "text_white": "#FFFFFF",
            "text_dark": "#1F2A2E",
            "text_gray": "#78909C",
            "text_body": "#37474F",
            "chart_1": "#26A69A",
            "chart_2": "#FF7043",
            "chart_3": "#42A5F5",
            "success": "#66BB6A",
            "warning": "#FFA726",
        },
        "fonts": {
            "title": "Calibri",
            "body": "PingFang SC",
            "size_title": 36,
            "size_heading": 22,
            "size_subheading": 18,
            "size_body": 13,
            "size_small": 10,
        },
        "layout": {
            "corner_radius": 12,
            "card_radius": 12,
            "card_shadow": True,
            "header_bar": False,
        }
    },
    "minimal": {
        "name": "简洁风",
        "colors": {
            "bg_dark": "#1A1A2E",
            "bg_light": "#F6F6FA",
            "bg_card": "#FFFFFF",
            "accent": "#E94560",
            "accent_gold": "#E94560",
            "accent2": "#0F3460",
            "accent_teal": "#0F3460",
            "accent_blue": "#16213E",
            "text_white": "#FFFFFF",
            "text_dark": "#2B2D42",
            "text_gray": "#8D99AE",
            "text_body": "#2B2D42",
            "chart_1": "#E94560",
            "chart_2": "#0F3460",
            "chart_3": "#16213E",
            "success": "#2ECC71",
            "warning": "#F39C12",
        },
        "fonts": {
            "title": "Calibri",
            "body": "PingFang SC",
            "size_title": 40,
            "size_heading": 24,
            "size_subheading": 18,
            "size_body": 13,
            "size_small": 10,
        },
        "layout": {
            "corner_radius": 4,
            "card_radius": 4,
            "card_shadow": False,
            "header_bar": True,
        }
    },
    "warm": {
        "name": "温暖风",
        "colors": {
            "bg_dark": "#3E2723",
            "bg_light": "#FFF8F1",
            "bg_card": "#FFF8E1",
            "accent": "#FF6F00",
            "accent_gold": "#FF6F00",
            "accent2": "#FFB300",
            "accent_teal": "#FFB300",
            "accent_blue": "#8D6E63",
            "text_white": "#FFFFFF",
            "text_dark": "#4E342E",
            "text_gray": "#A1887F",
            "text_body": "#4E342E",
            "chart_1": "#FF6F00",
            "chart_2": "#FFB300",
            "chart_3": "#8D6E63",
            "success": "#43A047",
            "warning": "#E53935",
        },
        "fonts": {
            "title": "Calibri",
            "body": "PingFang SC",
            "size_title": 36,
            "size_heading": 22,
            "size_subheading": 18,
            "size_body": 13,
            "size_small": 10,
        },
        "layout": {
            "corner_radius": 10,
            "card_radius": 10,
            "card_shadow": False,
            "header_bar": False,
        }
    }
}


def get_style(name="professional"):
    """Get style config by name, fallback to professional."""
    return STYLES.get(name, STYLES["professional"])
