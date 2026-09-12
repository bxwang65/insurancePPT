#!/usr/bin/env python3
"""
生成 per-company AI 背景图 (Pollinations.ai 免 key), 写入 themes/<company>.json 的 images 字段
也支持另存到 assets/<company>_<key>.jpg 走 fallback 路径

用法:
  python3 generate_theme_images.py manulife         # 单公司
  python3 generate_theme_images.py --all            # 全部 themes/
  python3 generate_theme_images.py --key chapter02  # 只重生成 chapter02
"""
import sys
import os
import json
import time
import urllib.request
import urllib.parse
from pathlib import Path

THEMES_DIR = Path(__file__).parent / "themes"
ASSETS_DIR = Path(__file__).parent / "assets"

# Pollinations.ai (免 key, DeepSeek 风格 diffusion)
POLLINATIONS_URL = "https://image.pollinations.ai/prompt/{prompt}?width=1600&height=900&nologo=true&model=flux"

def download_image(prompt: str, out_path: Path, timeout: int = 60):
    """下载 Pollinations 生成的图, 保存到 out_path"""
    encoded = urllib.parse.quote(prompt, safe="")
    url = POLLINATIONS_URL.format(prompt=encoded)
    print(f"  fetching: {prompt[:60]}...")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        if len(data) < 5000:
            print(f"  WARN response too small ({len(data)} bytes), skipping")
            return False
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(data)
        print(f"  saved: {out_path} ({len(data)//1024} KB)")
        return True
    except Exception as e:
        print(f"  ERROR: {e}")
        return False


def process_company(company_id: str, only_key: str = None) -> bool:
    """处理单个公司主题 — 下载图, 嵌入 base64 到 themes/<company>.json"""
    theme_path = THEMES_DIR / f"{company_id}.json"
    if not theme_path.exists():
        print(f"[ERR] {theme_path} not found")
        return False
    theme = json.loads(theme_path.read_text(encoding="utf-8"))
    prompts = theme.get("image_prompts", {})
    if not prompts:
        print(f"[WARN] {company_id}: no image_prompts in theme")
        return False

    # key → image field name in template
    key_map = {"header": "header", "chapter02": "chapter02", "chapter06": "chapter06"}

    theme_images = theme.get("images", {}) or {}
    updated = 0
    for key, prompt in prompts.items():
        if only_key and key != only_key:
            continue
        # 优先保存到 assets/<company>_<key>.jpg (回退路径) + 也嵌入到 theme.images
        asset_path = ASSETS_DIR / f"{company_id}_{key}.jpg"
        ok = download_image(prompt, asset_path)
        if not ok:
            print(f"  skipping {key} for {company_id}")
            continue
        # 嵌入 base64 (限大小, 超 200KB 用缩略)
        import base64
        data = asset_path.read_bytes()
        if len(data) > 200_000:
            # 简单的 JPEG 压缩 (Pillow) 缩到 200KB 以内
            try:
                from PIL import Image
                import io
                img = Image.open(io.BytesIO(data))
                img.thumbnail((1280, 720))
                buf = io.BytesIO()
                img.save(buf, "JPEG", quality=78, optimize=True)
                data = buf.getvalue()
                asset_path.write_bytes(data)
            except ImportError:
                pass
        theme_images[key_map.get(key, key)] = base64.b64encode(data).decode("ascii")
        updated += 1
        time.sleep(2)  # 礼貌 delay, 防 Pollinations 限流

    theme["images"] = theme_images
    theme_path.write_text(json.dumps(theme, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] {company_id}: updated {updated} images")
    return True


def main():
    args = sys.argv[1:]
    if not args:
        print("用法: python3 generate_theme_images.py <company_id|--all> [--key header|chapter02|chapter06]")
        sys.exit(1)

    only_key = None
    if "--key" in args:
        idx = args.index("--key")
        only_key = args[idx + 1]
        args = args[:idx] + args[idx+2:]

    if args[0] == "--all":
        companies = sorted(p.stem for p in THEMES_DIR.glob("*.json"))
        for c in companies:
            print(f"\n=== {c} ===")
            process_company(c, only_key=only_key)
            time.sleep(1)
    else:
        process_company(args[0], only_key=only_key)


if __name__ == "__main__":
    main()
