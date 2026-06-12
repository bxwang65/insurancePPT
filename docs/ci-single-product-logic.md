# CI 单产品生成逻辑

## 一、数据来源

### 1.1 提取流程
```
PDF → fitz(PyMuPDF) 文本提取 → LLM(DeepSeek) JSON输出
     → Zod Schema 验证 → session.extractions 存储
     → fitz 表格覆盖（99行CI表格数据）→ 最终数据
```

### 1.2 关键字段（CiYearlyRowSchema）
| 字段 | 类型 | 说明 |
|------|------|------|
| policy_year | number | 保单年度 |
| total_premium_paid | number | 累计已缴保费 |
| death_benefit | number | 身故赔偿额（含额外赔偿） |
| source_page | number | 来源页码 |

### 1.3 缺失字段（渲染器会fallback）
`total_surrender_value` / `guaranteed_cash_value` — **CI schema 没有这两个字段**，表中不要显示退保价值，改为显示「基本保额 vs 总身故赔偿」。

---

## 二、渲染器幻灯片序列（12页）

```
 1. 封面（公司+产品名+客户名）
 2. 公司介绍
 3. CI篇章页「守护家庭·风险保障篇」
 4. CI公司页
 5. CI概要（年缴保费/保障总额/保障年期/受保人）
 6. 【保单摘要表】年龄/年度/保费/基本保额/总身故赔偿
 7. 【保障项目详解】6项卡片：
    - 严重疾病保障（100%保额）
    - 首N年额外赔偿（60%保额，通常20年）
    - 早期危疾保障（50%保额）
    - 保障还原利益
    - 严重都市疾病额外保障（癌症+中风+心脏病）
    - 严重都市疾病无限次增值
 8. 【保费vs保额折线图】
 9. 免责声明
10. 数据来源
11. 总结
12. 尾页
```

---

## 三、数据准确性保障

### 3.1 受保人信息
```
ci_data.insured → name/age/gender
fallback: meta.insured_age
```

### 3.2 保费/保额
```
premium = ci_summary.annual_premium || ci_policy.annual_premium
coverage = ci_summary.sum_insured || ci_policy.sum_insured
pay_yrs = ci_summary.payment_years || ci_policy.premium_payment_period
```

### 3.3 升级保障
```
upgrade_amt = ci_data.upgrade_benefit_amount  （可能为0，表示无升级）
upgrade_yrs = ci_data.upgrade_benefit_years   （可能为0）
如果 upgrade_amt=0，用 coverage × 0.6 作为默认值
如果 upgrade_yrs=0，默认为20年
```

### 3.4 保障项目补充策略
渲染器使用硬编码的守護家倍198保障项目，再补充AI提取的项目（去重）：
```python
all_items = [
    严重疾病保障（100%）,
    首N年额外赔偿（60%）,
    早期危疾保障（50%）,
    保障还原利益（100%）,
    严重都市疾病额外保障（100%/次）,
    严重都市疾病无限次增值（100%/次）,
    保费豁免,
]
# 补充AI提取的其他项目（去重）
for item in ci_items:
    if item.label not in existing_labels:
        all_items.append(item)
```

产品切换时，需要修改 `all_items` 数组中的保障项目内容。

---

## 四、常见问题与修复

### 4.1 公司信息错误
- **问题**: 生成时用了 `companyId: "aia"`，实际是 CTF
- **修复**: 前端上传时选择正确公司，或生成时传入正确 companyId
- **IUL 公司列表**: transamerica / sunlife / manulife（已做前端过滤）
- **CI/储蓄公司**: 从 config/companies/*.json 加载

### 4.2 XML 非法字符
- **问题**: 受保人姓名含 U+FFFF 等 XML 非法字符
- **修复**: `sanitizeForXml()` 函数过滤 `[\x00-\x08\x0B\x0C\x0E-\x1F\uD800-\uDFFF\uFFFE\uFFFF]`
- **注意**: `primaryData` 和写入 temp JSON 前都要 sanitize

### 4.3 退保现价显示为0
- **问题**: CI schema 没有 `total_surrender_value` 字段
- **修复**: CI 表中不显示退保价值，改为「基本保额 vs 总身故赔偿」

### 4.4 字符串数字
- **问题**: AI 输出 `"66,355"` 字符串导致 Zod 验证失败
- **修复**: 所有数字字段用 `z.preprocess(numCoerce, z.number())` 兼容

---

## 五、切换其他CI产品时需要检查

1. 产品名称/保额/年缴/缴费期 → 数据提取是否准确
2. 额外赔偿比例和年限 → upgrade_benefit_amount / upgrade_benefit_years
3. 保障项目列表 → 修改 all_items 数组内容
4. 公司ID是否正确 → 上传时选择
5. 保费征费是否包含 → 注意 total_premium_with_levy 字段
