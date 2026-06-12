# Insurance PPT 配置驱动架构 V2

## 正式主链

```text
PDF upload
  -> deterministic table parser
  -> semantic LLM extraction
  -> normalized product model
  -> provenance ledger
  -> formal QA gate
  -> company/product/template config mapping
  -> outline + chart + approved image assets
  -> template clone edit or compatible renderer
  -> PPT/PDF export
```

正式导出遵循 fail-closed 原则：缺失关键数据、来源页码、PDF 哈希、公司识别或正式图片素材时阻断导出，不允许使用历史案例或模拟数字补齐。

## 已落地状态

- 公司资料索引：`data/company-knowledge-index.json`，当前已映射 21 家公司目录。
- 扫描版公司资料：可用 `bun run index:company-kb:ocr` 对无文本 PDF 的前两页执行中文 OCR，再重建摘要索引。
- 客户版公司证据：索引会标记 `public`、`internal`、`unknown`，正式检索仅允许 `public`，内部培训或机密材料不得进入客户版来源账本。
- 模板资产索引：`data/template-asset-index.json`，当前已登记券商风、商务风、简洁风、中国风、水墨风五套源模板。
- 中国风储蓄险：PPTX 已接入 `artifact-tool-exact-clone-edit`，每次导出强制执行模板保真检查。
- 模板克隆开关：按 `config/templates/*` 控制；若配置为 `cloneReady=true` 但对应渲染器未实现，系统会 fail-closed 直接阻断导出。
- 其他四套风格：仍保留兼容渲染链路，完成逐套页型审计前不得标记为精确克隆正式版。
- 重疾险与 IUL：标准模型、正式校验器和组合规划接口已接入主流水线；正式模板尚未审计，检测到相关产品时会 fail-closed 阻断导出。

## 配置目录

```text
config/companies/{company}.json
config/products/{company}/{product}.json
config/templates/{plan_type}/{style}.json
config/bundles/{bundle}.json
```

公司资料和产品资料与视觉皮肤解耦。新增公司不需要复制五份 PPT 模板；新增产品只需要配置别名、公司归属、产品类型和必选模块。

## 储蓄险 V1 标准模型

- 保单信息：姓名、年龄、性别、币种、年缴、缴费年期、总缴保费、保障期限
- 不提领利益表：保单年度、年龄、已缴保费、保证价值、复归红利、终期分红、总退保价值
- 官方提领表：保单年度、年龄、年度领取、累计领取、提领后基本金额、提领后保证价值、提领后总退保价值
- 来源账本：PDF SHA256、解析器版本、每行来源页码、公司资料文件、图片来源

## 多产品扩展

新增重疾险和 IUL 时复用相同五层：

1. `parser`: 官方 PDF 数字抽取
2. `normalizer`: 产品专属标准模型
3. `validator`: 产品专属正式导出门禁
4. `mapper`: 标准模型映射到模板槽位
5. `renderer`: 页面协议渲染

组合方案只负责页面编排，不重新计算单产品数字。组合规则由 `config/bundles/*.json` 定义。

## 商用部署边界

当前本地文件系统适用于开发验收。多人线上部署必须替换为：

- 对象存储：上传 PDF、导出 PPT/PDF、图片资产
- 数据库：用户、租户、session、抽取版本、模板版本、审计日志
- 任务队列：PDF 解析、图表生成、PPT 渲染
- 租户权限：资料库隔离、下载鉴权、速率限制
- 监控：失败率、解析耗时、字段缺失率、导出阻断原因
