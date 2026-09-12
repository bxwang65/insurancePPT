# 各保司优惠计算器

## 项目位置
`~/Desktop/AI insurance Backup/pages/my/training-admin-web/test-insurance-calc/index.html`

## 关键文件
- **`index.html`** — 主文件（配置+引擎+UI）
- **`/tmp/full_verify.js`** — 端到端验证脚本（16个测试用例）
- **`/tmp/batch_verify3.py`** — 折扣率批量验证（779个数据点）

## 计算引擎结构
所有计算逻辑在 `index.html` 的 `<script>` 中：
1. `window.CONFIG` — 配置数据（discount/prepayment等）
2. `getDiscountRate()` / `getExtraDiscount()` / `getPrepayRate()` — 辅助函数
3. `calculate()` — 主函数，按 `companyId` 分分支

## 各公司预缴公式分支（calculate函数内）
| companyId | 分支 | 说明 |
|-----------|------|------|
| youbang | 累积复利 | 预缴1年/4年不同算法 |
| ansheng | 累积复利 | premium*totalYears作本金 |
| hongli | 累积复利 | 减首年折扣 |
| fuwei | 累积复利 | 5年/3年/2年缴不同 |
| baocheng | 全额保费标准PV | premium/(1+r)^n |
| taiping | 全额保费标准PV | 同保C |
| **yongming** | **可变利率折现** | **首年5%+后续4.3%，首年用全额保费，再减保费回赠** |
| **wantong** | **可变利率折现** | **firstYearTiers+otherYears，首年折扣已含，不减保费回赠** |
| 其他 | 折扣后金额标准PV | 通用公式 |

## 可变利率折现通用算法（适用于firstYear+otherYears模式）
```
对每个未来年份 k（1到prepayYears）：
  折现因子 = (1 + r1) × (1 + r2)^(k-1)
  折现值 = 该年实际保费 / 折现因子
prepayLumpSum = 第一年实缴 + 所有折现值之和
```
- yongming: 第一年实缴=全额保费，再加总后统一减保费回赠
- wantong: 第一年实缴=折扣后金额，不加不减

## 季度更新利率流程
1. 拿到新Excel表格
2. 修改 `window.CONFIG` 中的 discount / prepayment 数值
3. 运行验证脚本确保匹配
4. **不需要修改** calculate() 中的公式逻辑

## 永M特殊注意
永M的prepayment配置使用 `firstYear`/`otherYears` 格式（不是 `rate`），其他公司用 `rate` 或 tiers。
