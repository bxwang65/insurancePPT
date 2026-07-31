# insdeck v0.1.0

官方保险计划书 (PDF) → 客户正式版储蓄险演示文稿

**核心特性:**
- PDF为唯一数据源 (pdfplumber按列精确提取)
- 显式公司-产品匹配 (避免产品混用错误)
- 7条Fidelity硬性检查 (无占位符/口径/数字回溯)
- 4种输出格式: PPTX (可编辑) / HTML (单文件) / JSON / PDF
- 内联CSS HTML可作小程序H5/微信分享

---

## 安装

```bash
cd packages/insurance-deck
pip install -r requirements.txt
```

依赖: `pdfplumber` `python-pptx` `PyMuPDF` (Pillow可选)

## 使用

### 交互式 (4步引导)
```bash
python insdeck.py
# 1. 输入PDF路径 (可拖入)
# 2. 自动检测公司+产品, 确认
# 3. 自动提取+验证, 显示fidelity报告
# 4. 选择导出格式 (1-5)
```

### 命令行 (跳过确认)
```bash
python insdeck.py "/path/to/计划书.pdf" --auto --format 5
```

参数:
- `pdf` (位置): PDF路径
- `--auto` / `-y`: 跳过所有确认
- `--format` / `-f`: 1=pptx 2=html 3=json 4=pdf 5=all
- `--out` / `-o`: 输出目录 (默认 `outputs`)

## 输出示例

```
outputs/
├── VIP_1岁_MW2IUA_正式版.pptx    76KB  可编辑, 12页
├── VIP_1岁_MW2IUA_正式版.html    53KB  单文件, 浏览器/微信/小程序
├── VIP_1岁_MW2IUA_正式版.json    53KB  结构化数据 (RAG/数据库)
└── VIP_1岁_MW2IUA_正式版.pdf     274KB  高清打印
```

## 架构

```
insdeck/
├── config/company_kb.py        公司-产品知识库 (新增产品只改这一个文件)
├── extract/
│   ├── pdf_reader.py           pdfplumber按列对齐提取
│   └── savings_normalizer.py   标准化 + 7条fidelity检查
├── render/
│   ├── pptx_renderer.py        python-pptx原生
│   ├── html_renderer.py        单文件CSS+JS (离线可用)
│   ├── json_renderer.py        结构化数据
│   └── pdf_renderer.py         HTML→PDF (Chrome headless或weasyprint)
├── templates/style_tokens.py   焦糖棕配色常量
└── cli.py                      4步引导交互
```

## Fidelity 检查清单

1. ✓ 公司-产品匹配 (必须在知识库)
2. ✓ 不提领表存在 (Y1-Y80 完整)
3. ✓ 提领表存在 (如PDF含提领演示)
4. ✓ 关键数字交叉验证 (8个里程碑)
5. ✓ 无占位符残留 (undefined/TODO/lorem等)
6. ✓ 保障年期口径 (至128岁)
7. ✓ 演示口径 (至80年, 注明)

## 新增产品

只需在 `insdeck/config/company_kb.py` 加键:

```python
"aia": {
    "name_zh": "友邦保险（香港）",
    "name_en": "AIA International Limited",
    "short": "AIA",
    "rating": "AIA Co. aa-",
    "products": {
        "WE2": {
            "name_zh": "「财富挚2」储蓄保险计划",
            "type": "savings",
            "currency": "USD",
            "pdf_signatures": {
                "title_keywords": ["财富", "挚", "WE2"],
                "first_page_must_contain": ["受保人", "保单货币"],
            },
            "presentation_pages": {
                "no_withdraw": [2, 3],
                "withdraw": [30, 31, 32, 33],
            },
        },
    },
},
```

无需改其他代码 — `detect_company_product` 自动识别。

## 设计原则

- **PDF为唯一数据源**: 任何数字必须能逐项回溯到PDF页码
- **拒绝占位符**: 不输出 undefined / 待补充 / 模板残留
- **小颗粒模块化**: 数据层/渲染层完全解耦
- **离线可用**: HTML单文件不依赖CDN
- **小程序友好**: 表格用纯 `<table>`, 图表用纯CSS

## 已知限制

- v0.1.0 只支持周大福 (CTF) 「匠·传承2」尊尚版
- PDF 渲染需要 Chrome (系统已装) 或 `pip install weasyprint`
- Fidelity 8/8 全过的"完美"标识需用户人工核对 (PDF舍入差异正常)

## 测试

```bash
python insdeck.py "/path/to/匠心傳承儲蓄計劃2尊尚版.pdf" --auto --format 5
# 预期: 4个文件输出, fidelity 6/8+ (差异属舍入)
```

## Roadmap (v0.2+)

- [ ] AIA / Prudential / Manulife 产品支持
- [ ] Figma 模板导入 (替换配色)
- [ ] 小程序直接渲染适配 (去掉动画/简化)
- [ ] AI 叙事增强 (NotebookLM 集成)
- [ ] Web界面 (FastAPI + 简单HTML前端)
