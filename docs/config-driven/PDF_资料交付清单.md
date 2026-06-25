# PDF资料交付清单（储蓄险V1）

## 1. 公司资料（每家公司）
- 年报/中报（最新）
- 评级/财务实力披露
- 公司简介或品牌事实表

## 2. 产品资料（每个产品）
- 产品手册/产品摘要
- 条款/合同样本
- 如有：分红实现率、总现金价值比率

## 3. 官方计划书案例（每个产品）
- 不提领案例 >= 3份（不同年龄/性别/缴费）
- 提领案例 >= 2份（有起领年龄、年提领、累计提领、提后现价）

## 4. 文件命名建议
- company_report_YYYYMM.pdf
- product_brochure_{product_id}_{lang}.pdf
- proposal_{product_id}_{age}_{gender}_{payterm}_{withdraw|no_withdraw}.pdf

## 5. 元数据CSV字段
- company_id
- product_id
- doc_type（company_report/rating/brochure/wording/proposal_case）
- language（zh-hk/zh-cn/en）
- currency（USD/HKD/SGD）
- insured_age
- insured_gender
- pay_term
- is_withdrawal_case
- effective_date
