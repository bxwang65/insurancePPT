# 新产品接入工作流

## 概述

每接入一个新保险公司的产品，按以下流程操作。每一步都有复核检查点，避免遗漏。

## 工作流

```
接收PDF → ①分析结构 → ②配解析器 → ③注册签名 → ④生成测试 → ⑤复核
```

### ① 分析 PDF 结构

```bash
python3.11 -c "
import fitz
doc = fitz.open('计划书.pdf')
print(f'页数: {doc.page_count}')
for i in range(doc.page_count):
    txt = doc[i].get_text()
    tables = doc[i].find_tables().tables
    print(f'第{i+1}页: {len(tables)}个表格')
"
```

**检查项：**
- [ ] 首页关键词（产品名、公司、受保人）
- [ ] 退保价值表在第几页、几列
- [ ] 提领表在第几页、几列
- [ ] 表格是横排还是竖排

### ② 配 fitz 解析器

如果现有解析器不支持该表格格式，在 `scripts/extract_savings_tables.py` 新增：

```python
def parse_xxx_base(page, page_num):
    """公司名 产品格式: x列/竖排"""
    rows = []
    # 使用 text 或 table detection
    return rows
```

**复核检查点：**
- [ ] 字段名与 schema 一致（`policy_year`, `total_premium_paid`, `guaranteed_cash_value` 等）
- [ ] 输出行数：退保价值至少覆盖 Y1~Y30+
- [ ] 提领数据：包含 `annual_withdrawal`, `total_withdrawn`, `surrender_value_after`
- [ ] 竖排表格需正确处理合并单元格

**已有解析器对照：**
| 解析器 | 适用格式 | 示例产品 |
|--------|---------|---------|
| `parse_base` | 12列横排 | CTF匠心传承 |
| `parse_cpic_base` | 6列竖排（值每行一个） | CPIC世代悅享3 |
| `parse_cpic_withdrawal` | 11列竖排提领表 | CPIC世代悅享3 |
| `parse_ctf_base_surrender_text` | CTF竖排文本 | CTF匠心传承 |

### ③ 注册签名

在 `src/extraction/signatures/registry.ts` 新增：

```typescript
{
  id: "公司-产品代码-v1",
  companyId: "company_id",
  productCode: "产品代码",
  productName: "产品名称",
  planType: "savings" | "ci" | "iul",
  currency: "USD",
  titleKeywords: ["关键词1", "关键词2"],
  firstPageMustContain: ["受保人", "保单货币"],
  pageTargets: {
    summary: 1,
    noWithdraw: [2],
    withdraw: [7, 8, 9],
  },
  crossCheckBaseline: [
    { label: "Y5 退保总额", policyYear: 5, field: "total_surrender_value", expected: 325310, tolerance: 100 },
  ],
}
```

**复核检查点：**
- [ ] `titleKeywords` 与首页文字匹配（区分繁简体）
- [ ] `pageTargets` 页码从1开始
- [ ] `crossCheckBaseline` 至少3个关键年份
- [ ] `productCode` 与产品代码一致
- [ ] `companyId` 在 `COMPANY_BRAND_PROFILES` 中存在
- [ ] 公司资产目录存在（logo.png, company-hero-01.jpg）

### ④ 测试

```bash
# 直接测试 fitz 提取
python3.11 scripts/extract_savings_tables.py "计划书.pdf" | python3 -m json.tool

# 测试签名匹配
bun run scripts/test_pdf_signatures.ts --pdf "计划书.pdf"

# 测试完整流程
curl -X POST http://localhost:3000/api/upload -F "files=@计划书.pdf" -F "types=savings"
curl -X POST http://localhost:3000/api/parse/$sid ...
curl -X POST http://localhost:3000/api/generate-enhanced/$sid ...
```

### ⑤ 复核清单（生成PPT后逐项检查）

| 检查项 | 通过标准 | 失败处理 |
|--------|---------|---------|
| 封面 | 公司名/Logo/产品名正确 | 检查 companyId 和品牌配置 |
| 公司介绍页 | 评级/成立年份/业务线显示 | 补全 COMPANY_BRAND_PROFILES |
| 产品特点页 | 缴付年期/金额正确 | 检查提取数据 |
| 增长图 | 只显示前30年 ✅ | 检查 `_get_data_for_chart` |
| 不提领表 | 退保价值列有数据 | 检查 fitz 解析器输出 |
| 提领表 | 已缴保费列有数据 | 检查 `parse_xxx_withdrawal` 是否含 `total_premium_paid` |
| 对比图 | 提领vs不提领正确 | 检查 withdrawal 和 no_withdraw 数据 |
| 折线图 | Y轴格式百万单位 | 检查 `number_format = '$#,##0,, "M"'` |
| 尾页 | 简洁无 sparkles | 检查 `_slide_ending` / `_slide_ending_combined` |

### 常犯错误清单

| 错误 | 表现 | 预防 |
|------|------|------|
| 产品名错字 | 签名匹配失败 | 用 `extract_first_n_pages.py` 验证首页文字 |
| 繁简体混淆 | "現金" vs "现金" 关键词不匹配 | 同时检查繁简体 |
| 缺少 `total_premium_paid` | 提领表该列为空 | 解析器必须输出该字段 |
| 角标/公司名用错 | 显示上一家公司的logo | 检查 `companyId` 传递是否正确 |
| cover image 覆盖 | 自带文字的图覆盖了原图 | cover image 应该只含装饰图案 |
| 缓存未清 | 修改不生效 | `rm -f .cache/insurance-ppt/*.json` |
| 退出码非0但JSON有效 | 签名快路径失败 | 已修复 `pdf-first-pages.ts` 优先解析 stdout |

## 当前已接入产品

见 `docs/PRODUCT_SIGNATURES.md`
