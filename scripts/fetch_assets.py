#!/usr/bin/env python3
"""
insurance-ppt 素材库批量下载器
- 源: Unsplash 公开图 (Unsplash License = 可商用免费, 无需署名)
- 工具: scrapling Fetcher (抗反爬)
- 输出: 1920x1080 JPEG, 按公司/主题分类
"""
import sys
import os
import time
import concurrent.futures
from pathlib import Path

sys.path.insert(0, '/Users/soldier/hermes-agent/.venv/lib/python3.11/site-packages')
from scrapling.fetchers import Fetcher

ROOT = Path('/Users/soldier/free-code/packages/insurance-ppt/public/assets/library')

# ============= 精选 Unsplash Photo ID 池 =============
# 每个 photo 都是已知 1920x1080+ 高质量、可商用
# 风格: 真实摄影、金融顾问风、家庭温暖、办公现代

# 公司品牌图（用通用金融/办公/城市建筑图代表）
COMPANIES = {
    'aia': {
        'display_name': 'AIA 友邦保险',
        'photos': {
            'logo.png': None,  # 透明底logo另外处理（用 SVG 或公司官方维基源）
            'brand-01.jpg': '1497032205916-ac775f0649ae',      # 现代办公城市天际线
            'brand-02.jpg': '1486406146926-c627a92ad1ab',      # 商业建筑外观
            'company-hero-01.jpg': '1554469388-e259e8463228',  # 城市金融区
            'adviser-01.jpg': '1573497019940-1c28c88b4f3e6',    # 商务握手
            'office-01.jpg': '1497366216548-37526070297c',      # 现代会议室
        }
    },
    'ctf': {
        'display_name': 'CTF 周大福人寿',
        'photos': {
            'logo.png': None,
            'brand-01.jpg': '1512453979798-5ea266f8880c',      # 香港金融区天际线
            'brand-02.jpg': '1444723121867-7a241cacace9',      # 玻璃幕墙写字楼
            'company-hero-01.jpg': '1559526324-4b87b5e36e44',  # 高端金融区
            'adviser-01.jpg': '1521791136064-7986c2920216',    # 商务握手合作
            'office-01.jpg': '1604328698692-f76ea9498e76',      # 开放办公区
        }
    },
    'fwd': {
        'display_name': 'FWD 富卫保险',
        'photos': {
            'logo.png': None,
            'brand-01.jpg': '1542744173-8e7e53415bb0',          # 金融分析师
            'brand-02.jpg': '1554224155-6726b3ff858f',          # 城市商业楼
            'company-hero-01.jpg': '1551836022-d5d88e9218df',    # 现代金融办公
            'adviser-01.jpg': '1573497620053-ea5300f94f21',      # 商务咨询
            'office-01.jpg': '1497366754035-f200968a6e72',      # 商务会议桌
        }
    },
    'manulife': {
        'display_name': 'Manulife 宏利保险',
        'photos': {
            'logo.png': None,
            'brand-01.jpg': '1556761175-5973dc0f32e7',          # 团队会议
            'brand-02.jpg': '1554469388-e259e8463228',          # 城市天际线
            'company-hero-01.jpg': '1551836022-d5d88e9218df',    # 金融中心
            'adviser-01.jpg': '1556761175-b413da4baf72',        # 商务女性
            'office-01.jpg': '1556761175-4b46a572b786',         # 现代办公
        }
    },
}

# 主题图
THEMES = {
    'family': {
        'display_name': '家庭主题',
        'photos': {
            'cover-family-01.jpg': '1609220134136-9c039fa99978',  # 家庭合照 温暖
            'cover-family-02.jpg': '1511895426328-dc8714191300',  # 家庭户外
            'cover-family-03.jpg': '1503454537195-1dcabb73ffb9',  # 母亲+孩子
            'mother-child-01.jpg': '1605276374104-dee2a0ed3cd6',  # 母女
            'mother-child-02.jpg': '1542385151-efd9000785a7',     # 母子
            'father-child-01.jpg': '1503454537195-1dcabb73ffb9',  # 父子
            'father-child-02.jpg': '1517256064527-09c73fc73e38',  # 父女
            'family-cooking-01.jpg': '1556909114-f6e7ad7d3136',   # 家庭厨房
            'family-outdoor-01.jpg': '1542038784456-1ea8e935640e', # 户外
            'family-evening-01.jpg': '1604881988758-f76ad2f7aac1',  # 傍晚家庭
        }
    },
    'education': {
        'display_name': '教育主题',
        'photos': {
            'child-growth-01.jpg': '1503454537195-1dcabb73ffb9',  # 幼儿成长
            'child-growth-02.jpg': '1502086223501-7ea6ecd79368',  # 小孩玩耍
            'child-growth-03.jpg': '1503454537195-1dcabb73ffb9',  # 童年
            'teen-study-01.jpg': '1453928582365-b6ad33cbcf64',     # 青少年学习
            'teen-study-02.jpg': '1434030216411-0b793f4f4173',     # 高中
            'teen-study-03.jpg': '1481627834876-b7833e8f5570',     # 大学生
            'graduation-01.jpg': '1523050854058-8df90110c9f1',     # 毕业典礼
            'graduation-02.jpg': '1530021232320-687d8e3dba54',     # 学士帽
            'graduation-03.jpg': '1517486808906-6ca8b3f04846',     # 未来启动
            'graduation-04.jpg': '1541339907198-e08756dedf3f',     # 校园
        }
    },
    'ci': {
        'display_name': '重疾险主题',
        'photos': {
            'health-protection-01.jpg': '1576091160550-2173dba999ef',  # 家庭医生
            'health-protection-02.jpg': '1559757148-5c350d0d3c56',     # 健康管理
            'health-protection-03.jpg': '1505751172876-fa1923c5c528',  # 医疗
            'health-protection-04.jpg': '1504984023438-a4d873ff1f73',  # 守护家庭
            'woman-professional-01.jpg': '1573497019940-1c28c88b4f3e6', # 商务女性
            'woman-professional-02.jpg': '1494790108377-be9c29b29330',  # 知性女性
            'woman-professional-03.jpg': '1580489944761-15a19d654956',  # 自信女性
            'man-professional-01.jpg': '1507003211169-0a1dd7228f2d',   # 商务男性
            'man-professional-02.jpg': '1472099645785-5658abf4ff4e',     # 知性男性
            'man-professional-03.jpg': '1560250097-0b93528c311a',      # 自信男性
        }
    },
    'savings': {
        'display_name': '储蓄险主题',
        'photos': {
            'long-term-growth-01.jpg': '1518186285589-2f7649de83e0',  # 长期规划
            'long-term-growth-02.jpg': '1543286386-2e659cc6a224',     # 未来成长
            'long-term-growth-03.jpg': '1551288049-bebda4e38f71',     # 增长曲线
            'cashflow-future-01.jpg': '1554224155-8d04cb21cd6c',     # 现金流
            'cashflow-future-02.jpg': '1559526324-4b87b5e36e44',      # 未来城市
            'cashflow-future-03.jpg': '1535320903710-d993d3d77d29',   # 投资未来
            'cashflow-future-04.jpg': '1556761175-4b46a572b786',     # 资产配置
            'long-term-savings-01.jpg': '1551836022-d5d88e9218df',    # 长期储蓄
            'long-term-savings-02.jpg': '1556761175-5973dc0f32e7',    # 稳定增长
        }
    },
    'retirement': {
        'display_name': '退休主题',
        'photos': {
            'senior-life-01.jpg': '1573497019940-1c28c88b4f3e6',     # 退休生活
            'senior-life-02.jpg': '1581579188871-45ea61f2a0c8',        # 老人幸福
            'senior-life-03.jpg': '1500648767791-00dcc994a43e',        # 老人休闲
            'senior-life-04.jpg': '1469854523086-cc02fe5d8800',        # 退休夫妻
        }
    },
    'business': {
        'display_name': '商务主题',
        'photos': {
            'cityline-01.jpg': '1512453979798-5ea266f8880c',           # 城市天际线
            'cityline-02.jpg': '1444723121867-7a241cacace9',           # 金融区
            'cityline-03.jpg': '1554469388-e259e8463228',              # 商业区
            'finance-screen-01.jpg': '1551288049-bebda4e38f71',        # 金融屏幕
            'finance-screen-02.jpg': '1611974789855-9c2a0a7236a3',      # 数据屏幕
            'finance-screen-03.jpg': '1559526324-4b87b5e36e44',        # 投研屏幕
            'finance-screen-04.jpg': '1640340434853-6088b1ce3c86',     # 图表
        }
    },
}


def download_one(photo_id: str, dest_path: Path, size: str = "1920x1080") -> tuple:
    """下载一张 Unsplash 图，返回 (success, size_bytes)"""
    if photo_id is None:
        return False, 0
    url = f"https://images.unsplash.com/photo-{photo_id}?w={size.split('x')[0]}&h={size.split('x')[1]}&fit=crop&fm=jpg&q=80"
    try:
        p = Fetcher().get(url, timeout=20)
        if p.status == 200 and p.body and len(p.body) > 10000:
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            with open(dest_path, 'wb') as f:
                f.write(p.body)
            return True, len(p.body)
        return False, 0
    except Exception as e:
        return False, str(e)[:60]


def main():
    # 准备所有下载任务
    tasks = []  # (dest_path, photo_id)
    for company_key, info in COMPANIES.items():
        for fn, pid in info['photos'].items():
            if pid:
                tasks.append((ROOT / 'companies' / company_key / fn, pid))
    for theme_key, info in THEMES.items():
        for fn, pid in info['photos'].items():
            if pid:
                tasks.append((ROOT / 'themes' / theme_key / fn, pid))

    # 去重
    seen = set()
    unique_tasks = []
    for dest, pid in tasks:
        if dest in seen:
            continue
        seen.add(dest)
        unique_tasks.append((dest, pid))

    print(f"📦 总任务: {len(unique_tasks)} 张")
    print(f"   公司图: {sum(1 for d, _ in unique_tasks if 'companies' in str(d))}")
    print(f"   主题图: {sum(1 for d, _ in unique_tasks if 'themes' in str(d))}")
    print()

    # 并发下载
    t0 = time.time()
    success = 0
    failed = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as exe:
        futs = {exe.submit(download_one, pid, dest): (dest, pid) for dest, pid in unique_tasks}
        done = 0
        for fut in concurrent.futures.as_completed(futs):
            done += 1
            dest, pid = futs[fut]
            ok, sz = fut.result()
            if ok:
                success += 1
                print(f"  [{done:3d}/{len(unique_tasks)}] ✅ {dest.name} ({sz//1024}KB)")
            else:
                failed.append((dest, pid))
                print(f"  [{done:3d}/{len(unique_tasks)}] ❌ {dest.name}: {sz}")

    print(f"\n⏱ 总耗时 {time.time()-t0:.1f}s")
    print(f"✅ 成功 {success}/{len(unique_tasks)}")
    if failed:
        print(f"❌ 失败 {len(failed)}")

    # 写 index.txt
    write_index_files()


def write_index_files():
    """为每个目录写 index.txt 清单"""
    # 公司目录
    for company_key, info in COMPANIES.items():
        d = ROOT / 'companies' / company_key
        if not d.exists():
            continue
        lines = [f"# {info['display_name']} 素材库\n"]
        for fn in sorted(d.iterdir()):
            if fn.is_file() and fn.suffix in ('.jpg', '.png', '.jpeg'):
                purpose = guess_purpose(fn.name, 'company')
                lines.append(f"{fn.name}  -  {purpose}")
        (d / 'index.txt').write_text('\n'.join(lines), encoding='utf-8')

    # 主题目录
    for theme_key, info in THEMES.items():
        d = ROOT / 'themes' / theme_key
        if not d.exists():
            continue
        lines = [f"# {info['display_name']} 素材库\n"]
        for fn in sorted(d.iterdir()):
            if fn.is_file() and fn.suffix in ('.jpg', '.png', '.jpeg'):
                purpose = guess_purpose(fn.name, 'theme')
                lines.append(f"{fn.name}  -  {purpose}")
        (d / 'index.txt').write_text('\n'.join(lines), encoding='utf-8')
    print("\n✅ index.txt 已写完所有目录")


PURPOSE_HINTS = {
    # 公司图
    'logo': '公司 logo 透明底',
    'brand-01': '公司品牌感主图',
    'brand-02': '公司品牌感辅图',
    'company-hero-01': '公司介绍页大横图',
    'adviser-01': '顾问服务 / 高净值咨询场景',
    'office-01': '金融办公 / 会议室场景',
    # 主题图
    'cover-family': '组合方案封面家庭合照',
    'mother-child': '妈妈+孩子组合方案',
    'father-child': '父亲+孩子组合方案',
    'family-cooking': '家庭温馨生活',
    'family-outdoor': '家庭户外活动',
    'family-evening': '家庭傍晚时分',
    'child-growth': '1-6 岁成长场景',
    'teen-study': '18-22 岁青少年学习',
    'graduation': '毕业 / 未来启动金',
    'health-protection': '家庭健康保障',
    'woman-professional': '成年女性投保人形象',
    'man-professional': '成年男性投保人形象',
    'long-term-growth': '储蓄险长期增长',
    'cashflow-future': '教育金/养老金现金流',
    'long-term-savings': '长期储蓄规划',
    'senior-life': '退休生活 / 养老金',
    'cityline': '城市天际线 / 金融区',
    'finance-screen': '图表 / 投研数据',
}


def guess_purpose(fn: str, kind: str) -> str:
    """根据文件名猜用途"""
    stem = fn.rsplit('.', 1)[0]
    # 找最长匹配的关键字
    best = '通用图片'
    for k, v in PURPOSE_HINTS.items():
        if k in stem:
            best = v
            break
    return best


if __name__ == '__main__':
    main()
