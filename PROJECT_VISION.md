# 保险计划书 AI 助手 — 项目愿景与需求文档

> *「像 NotebookLM 理解播客一样，理解官方计划书，生成有温度的定制计划书」*

---

## 一、核心理念

### 1.1 一句话愿景

**将冰冷的 PDF 官方计划书，转化为有温度、有叙事、有感染力的专业销售演示文稿。**

### 1.2 为什么是这个愿景

保险计划书是保险公司出具的官方文档，数据专业但表达生硬。客户拿到手里往往看不懂，或看完无感。保险顾问需要把这些数据"翻译"成客户能理解、会被打动的话语。

传统流程：
1. 顾问手工从 PDF 复制数据到 PPT
2. 顾问凭经验讲述，水平参差不齐
3. PPT 堆砌数字，缺乏感染力

我们想要的流程：
1. 上传 PDF，系统像 NotebookLM 一样深度理解计划书内容
2. AI 自动识别数据含义，生成销售叙事
3. 输出专业 PPT，每页都有温度、有逻辑、有情感

---

## 二、对标参照：NotebookLM 的工作方式

### 2.1 NotebookLM 带来了什么启发

NotebookLM（Google 的 AI 笔记产品）不是简单的文本提取，它做到了：

| NotebookLM 的能力 | 我们要借鉴的思路 |
|------------------|----------------|
| **深度理解内容** — 不是 OCR 文字，而是理解语义（播客说了什么、观点是什么、谁是核心人物） | 对计划书的理解要超越数据提取，理解产品设计意图、适合人群、核心卖点 |
| **生成摘要** — 把长篇内容压缩成有逻辑的摘要 | 把128年的数据压缩成关键销售叙事 |
| **问答互动** — 基于理解后的内容回答问题 | 顾问可以对话式询问计划书细节 |
| **输出有观点的总结** — 不是流水账，而是有立场的摘要 | PPT 要有销售立场，不是数据堆砌 |

### 2.2 类比到保险计划书

| NotebookLM | 我们的定位 |
|------------|-----------|
| 上传播客/长文 PDF | 上传保险公司官方计划书 PDF |
| 深度语义理解 | 深度理解产品设计意图（为什么设计这个产品、适合什么客户） |
| 生成有观点的摘要 | 生成有销售立场的叙事（不是中立罗列，而是帮助成交） |
| 互动问答 | 顾问对话式询问计划书（"这个产品适合什么年龄层？"） |
| 生成配套材料 | 生成专业销售 PPT |

---

## 三、用户需求层次

### 3.1 第一层：数据提取（已实现）
**需求：** 把 PDF 里的数据自动提取出来，不用手工复制

**实现：** Gemini 2.5 Flash OCR + Schema 验证

**衡量标准：** 提取准确率、128年数据每一行都不遗漏

---

### 3.2 第二层：智能理解（核心差异点）
**需求：** 系统要像经验丰富的保险顾问一样，理解这份计划书在说什么

**具体表现：**
- 这个产品设计给谁的？（目标客户画像）
- 产品最大的卖点是什么？（核心优势）
- 和同类产品比有什么不同？（独特价值）
- 应该用什么叙事方式来讲？（建议叙事方向）

**实现：** InterpretationEngine 生成销售洞察（targetCustomer / keySellingPoints / uniqueAdvantages / suggestedNarrative）

**衡量标准：** 解读结果有没有"顾问视角"，而不是中立的数据列表

---

### 3.3 第三层：销售叙事（差异化核心竞争力）
**需求：** PPT 不能是数据堆砌，要有感染力，像一个专业的保险顾问在跟你说话

**具体要求：**
- 每页的 narrativeText 要有温度，30字以内，直击客户痛点
- 数字要被讲故事，而不是被罗列
- 例如：不说"退保总值 93326"，而说"仅用4年，您的50万已增值至93万"
- 对比多家产品时，给出有倾向性的建议，而不是中立罗列

**实现：** ContentPlanner LLM 生成 ContentPlan，OutlineGenerator 生成15页 Markdown 大纲

**衡量标准：** 读 PPT 的大纲文案，是否像一个有经验的顾问在说话

---

### 3.4 第四层：专业呈现（视觉设计）
**需求：** PPT 视觉要专业、高端，符合目标客户的审美

**设计规范（参考 shadcn/ui + ai-atelie）：**
- 配色：深海蓝 `#0A1628` + 金色 `#C8963E` + 青绿 `#00D4AA`
- 品牌色上限：单屏 ≤ 2 处金色（过多显得俗气）
- 字体：ALL CAPS 必须 letter-spacing:0.06em+
- 避免七大机器感特征：indigo渐变 / emoji图标 / 机器字体 / 捏造指标 / filler文字
- 图表配色：保证=`#4FC3F7` / 非保证=`#C8963E` / 总值=`#00D4AA`

**实现：** PptxGenJS（7页固定模板）+ Python Gamma风格生成器

**衡量标准：** 视觉是否超出客户对"保险 PPT"的预期

---

### 3.5 第五层：对话式交互
**需求：** 顾问可以像和 AI 助手对话一样，询问计划书内容、请求修改建议

**具体表现：**
- "这个产品适合什么年龄层的客户？"
- "20年后的回报是多少？"
- "和另一款产品对比，哪个更适合退休规划？"
- "帮我生成一版侧重传承的 PPT"

**实现：** ChatEngine + InterpretationEngine，支持储蓄险/重疾险/万用寿险三种类型

**衡量标准：** 对话是否像和专业的 AI 保险顾问在交流

---

## 四、典型使用场景

### 场景一：先生 + 小姐联合方案（最常见）
**背景：** 先生（1岁）买储蓄险，每年 USD 100,000，5年缴费；小姐（32岁）买重疾险，每年 USD 4,949，10年缴费

**流程：**
1. 上传两份 PDF
2. 系统识别产品类型（储蓄险 / 重疾险）
3. 先生数据提取：5年缴费 / 128年利益演示 / 回本分析 / 提取方案
4. 小姐数据提取：10年缴费 / 68年数据 / 保障项目列表
5. 生成综合方案 PPT，15页+，包含两份计划书的对比分析

**输出：** 综合方案.pptx（689KB），封面有温度的叙事，内页有逻辑的数据展示

---

### 场景二：单一产品深度讲解
**背景：** 客户只问一款产品，需要生成深度讲解 PPT

**流程：**
1. 上传 PDF
2. AI 理解产品定位（"这是一款专门为高净值人士设计的长期储蓄计划"）
3. 生成12-15页深度 PPT
4. 每页有叙事：封面 → 问题分析 → 产品介绍 → 数据证明 → 行动建议 → 结束

---

### 场景三：对比方案
**背景：** 客户犹豫两款产品，需要对比分析

**流程：**
1. 上传两份 PDF
2. 系统识别差异（回本速度 / 长期倍数 / 提取灵活性 / IRR）
3. 生成对比 PPT，每项指标并排展示
4. 给出有倾向性的建议（"如果您注重传承，推荐方案A；如果注重灵活性，推荐方案B"）

---

## 五、设计逻辑

### 5.1 三层架构
```
提取层 (Extraction)    →  规划层 (Planning)    →  生成层 (Generation)
  PDF → 结构化 JSON        JSON → ContentPlan     ContentPlan → PPT
```

**提取层：** PDF → Gemini 2.5 Flash → 结构化 JSON（保证/非保证数据、逐年利益演示、受保人信息）

**规划层：** 结构化 JSON → LLM 生成 ContentPlan（故事线 + SlidePlan[]，每页含 narrativeText / visualType / chartType / layout）

**生成层：** ContentPlan → PptxGenJS / Python → 专业 PPT

### 5.2 为什么这样分层

| 分层 | 职责 | 好处 |
|------|------|------|
| 提取层独立 | 数据提取与格式解耦 | 支持多产品类型（储蓄/重疾/IUL）、缓存避免重复API调用 |
| 规划层独立 | 数据 → 叙事转化 | LLM 驱动，有温度的叙事；有规则 fallback 保底 |
| 生成层独立 | 叙事 → 视觉呈现 | 多套生成方案并行（PptxGenJS 主 / Python 备） |

### 5.3 状态机设计
```
created → parsing → parsed → chatting → generating → done
                      ↘ parsed ↗
```

- **created**：上传完成，等待解析
- **parsing**：AI 解析中（耗时最长，平均30秒）
- **parsed**：解析完成，可以对话或生成 PPT
- **chatting**：对话中
- **generating**：PPT 生成中
- **done**：完成，可下载

---

## 六、核心数据类型

### 6.1 三种产品 Schema

**储蓄险 (savings)**
- product_name / insured / policy（annual_premium / payment_period / coverage_period）
- benefit_illustration[]（逐年利益演示：policy_year / total_premium_paid / guaranteed_cash_value / reversionary_bonus / terminal_dividend / total_surrender_value / death_benefit）
- withdrawal_illustration[]（提取方案）

**重疾险 (ci)**
- product_name / insured / policy（sum_insured / annual_premium / payment_years）
- benefit_illustration[]（逐年数据）
- coverage_items[]（保障项目列表）

**万用寿险 (iul)**
- product_name / insured / policy（sum_insured / index_account_rate / capital_partition）
- benefit_illustration[]（账户价值 / 身故赔偿）

### 6.2 销售洞察数据类型
```typescript
interface 销售洞察 {
  targetCustomer: string;      // "高净值人士，30-50岁，注重长期资产增值"
  keySellingPoints: string[];// ["中长期储蓄", "保证现金价值", "灵活提取"]
  uniqueAdvantages: string;   // "市场少有的128年保障周期"
  suggestedNarrative: string; // "聚焦传承价值，强调时间复利效应"
  highlightNumbers: Key数字[];// [{year:7, label:"2.1x", value:93326, type:"翻倍"}]
  comparisonPoints: string[]; // ["回本速度", "长期倍数", "提取灵活性"]
}
```

---

## 七、PPT 设计规范

### 7.1 配色系统
```
主色（深海蓝）: #0A1628
背景: 深蓝渐变背景，白色文字
强调色（金）: #C8963E（单屏≤2处）
强调色（青绿）: #00D4AA（KPI高亮）
数据蓝: #4FC3F7（保证部分）
数据橙: #C8963E（非保证部分）
总值色: #00D4AA
```

### 7.2 字体层级
```
标题: 24pt, #FFFFFF, ALL CAPS + letter-spacing:0.06em
副标题: 18pt, #C8963E
正文: 14pt, #E0E0E0
数据: 16pt, #00D4AA
```

### 7.3 图表规范
```
折线图: 面积图展示长期增长（保证线+非保证线）
柱状图: 分组对比（先生 vs 小姐）
表格: 蓝/橙/绿三色区分（保证/非保证/总额）
KPI卡片: 大数字+标签（回本年份Y7 / 20年倍数2.7x）
```

### 7.4 Anti-AI-Slop 规则（防止机器感）
- ❌ indigo 渐变背景
- ❌ emoji 图标
- ❌ 机器感字体
- ❌ 捏造不存在的指标
- ❌ filler 文字（"卓越品质，值得信赖"等空洞话）
- ✅ ALL CAPS 加 letter-spacing
- ✅ 金色上限控制
- ✅ 真实数据叙事

---

## 八、已验证的成果

### 8.1 Ralph Loop 20次稳定性测试
- **通过率：** 20/20（100%）
- **Parse 耗时：** avg=30.5s | min=22.4s | max=40.0s
- **Gen 耗时：** avg=0.3s
- **PPT 大小：** 376KB（完全一致）

### 8.2 先生 + 小姐联合方案
- **Session ID：** 120cdf4a
- **先生：** 匠心传承储蓄计划2尊尚版，5年缴 USD 100,000/年
- **小姐：** 守护家倍198，10年缴 USD 4,949/年
- **输出：** 综合方案.pptx（689KB）

---

## 九、待解决问题

| 优先级 | 问题 | 影响 |
|--------|------|------|
| P0 | 两套生成方案各自为战，无统一入口 | 使用复杂 |
| P0 | llm_caller.js 未实现 | Python 侧 LLM 增强不可用 |
| P1 | content-planner.ts LLM 叙事未在生产路径验证 | 有温度的叙事依赖规则 fallback |
| P1 | 小姐（守护家倍198）被误识别为 savings 而非 ci | planType 判断错误 |
| P2 | pdf-preprocessor.ts async/await 错误（line 120） | 预处理器潜在崩溃 |

---

## 十、快速开始

```bash
cd ~/free-code/packages/insurance-ppt
bun install
bun run src/api/server.ts
# 打开 http://localhost:3000
# 上传 PDF → 自动解析 → 生成 PPT
```