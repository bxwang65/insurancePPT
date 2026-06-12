# Screen 1: Upload（上传页 / 落地页）

> 把这个文件直接复制粘贴到 Google Stitch 的 prompt 输入框。
> 输出目标：单个 HTML 文件，覆盖项目原 public/index.html 的"step-upload"部分。

---

## Prompt（直接复制以下全部内容）

```
请生成一个 HTML 单页应用，主题是"保险计划书 AI 助手"的上传页。
这是产品落地页 + 文件上传的合并屏。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【一】请严格遵循以下设计系统（来自 00-DESIGN-SYSTEM.md）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

产品定位: 「把厚重的 PDF 计划书，变成有温度的专业销售演示文稿」
目标用户: 保险销售顾问，30-50 岁，香港/新加坡地区，审美偏高端商务
情绪基调: 克制、专业、可信、温暖

【配色 - 白底 Apple 风】
  背景基色:      #FAFAFA
  卡片背景:      #FFFFFF
  分隔线/边线:   #E5E5EA
  纯黑标题:      #1D1D1F
  次要文字:      #6E6E73
  三级文字/占位: #AEAEB2
  品牌金:        #C8963E  (主按钮、关键数字、选中态，单屏 ≤ 2 处)
  品牌金 hover:  #A87E2A
  品牌金浅底:    #FBF6EC  (选中态背景)
  成功: #34C759 / 警告: #FF9500 / 错误: #FF3B30 / 处理中: #007AFF

  ❌ 严禁深海蓝背景、紫色/靛蓝渐变、黑色大面积铺底

【字体】
  -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter",
  "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif
  数字专用: "SF Mono", ui-monospace, monospace
  字号: display 56px / h1 40px / h2 28px / h3 20px / body-lg 17px /
       body 15px / caption 13px / micro 11px (仅 ALL CAPS)
  ALL CAPS 必须 letter-spacing: 0.06em+

【圆角】 xs 6 / sm 10 / md 14 / lg 20 / xl 28 / full 9999
【阴影】 shadow-sm/md/lg/xl 全部极轻，最大 rgba(0,0,0,0.10)
【间距】 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 56 / 80

【图标】 全部使用 Lucide Icons 风格 SVG，1.5-2px 描边，禁止 emoji
  需要用到: upload-cloud, file-text, x, check, chevron-right, sparkle

【动效】 fade + translateY(8px) 入场 300ms, hover 200ms, 点击 scale(0.98)
  ❌ 禁用: 弹跳、旋转、闪光、流光、粒子

【布局】 桌面优先 (最大宽度 1120px, 左右内边距 32px)
        移动端 ( < 768px) 左右内边距 16px

【严禁清单】 任何 emoji / 深海蓝紫渐变 / 浮夸阴影 /
  ALL CAPS 不加分字距 / 单屏超 2 处金色 / 模板化 AI 文案
  (不写"赋能"、不写"智领未来"、不写"卓越品质")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【二】本屏的具体需求
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【1. 顶部导航栏】
  - 高度 64px, 背景 #FFFFFF, 底边 1px solid #E5E5EA, 阴影 shadow-sm
  - 左侧: 产品 logo 区
    * 一个 28x28 的金色圆角方块 (背景 #C8963E) 内放白色小字 "IP" (InterPlan)
    * 旁边写 "Insurance Plan AI" 17px / 600
  - 中间: 步骤指示器 (Steps)
    * 5 步圆点连线: Upload → Parse → Chat → Generate → Done
    * 当前第 1 步是激活态 (#1D1D1F 实心圆 + 字)
    * 其余步骤灰色 (#AEAEB2)
    * 已完成步骤显示 check 图标
    * 步骤文字: "上传" "解析" "对话" "生成" "完成"
  - 右侧: 简单"帮助"文字链接 (#6E6E73) + "新建会话" 文字按钮

【2. Hero 区 (页面第一屏)】
  - 上下内边距 80px / 96px
  - 左侧 60% 文字区:
    * micro 标签: "INSURANCE PLAN AI" (金色 #C8963E, letter-spacing 0.08em)
    * h1 大标题 (40px / 700): "把 PDF 计划书，" 换行 "变成有温度的演示文稿"
    * body-lg 副标题 (#6E6E73): "上传官方计划书，AI 自动提取数据、理解产品、生成专业销售 PPT。
      支持储蓄险、重疾险、万用寿险三种类型，可同时上传多份。"
    * 三个并排的小标签 (灰色圆角矩形 #F5F5F7):
      "储蓄险" "重疾险" "万用寿险 (IUL)"  (用 SVG 图标 + 文字)
  - 右侧 40% 视觉区:
    * 不放真实图片。用 CSS 画一个抽象的"文档→PPT"示意图:
      - 左侧画一个白色卡片 (圆角 16, 阴影 md) 模拟 PDF,
        顶部红/蓝/绿 3 个圆点 (mac 红绿灯), 内有 4-5 行灰色横线模拟文字
      - 右侧画一个深一点的白卡片 (圆角 16, 阴影 lg) 模拟 PPT 幻灯片,
        内有 1 个大数字 "#1" + 2 行横线 + 1 个小柱状图 (用 div 画 4 根渐高彩色柱)
      - 两卡之间一个箭头 (用 SVG chevron-right 图标, 旋转 0 度, 颜色 #C8963E)
      - 整组图右下角做一个轻金色光晕 (radial-gradient)
  - 背景: 纯 #FAFAFA，不加任何渐变

【3. 上传区 (核心交互)】
  - 容器: 白卡, 圆角 20, 阴影 shadow-md, 内边距 32px
  - 标题区:
    * h3: "上传计划书 PDF" (20px / 600)
    * caption (#6E6E73): "可同时上传多份，每份自动识别产品类型，也可手动指定"
  - 拖拽上传区 (Dropzone):
    * 高度 220px, 圆角 16, 边框 2px dashed #D1D1D6
    * 背景 #FAFAFA
    * 居中内容:
      - 一个 56x56 的圆形容器 (背景 #FBF6EC 浅金底), 内放 upload-cloud SVG 图标
        (48px, 颜色 #C8963E)
      - 文字 "拖拽 PDF 到这里" (17px / 600, 颜色 #1D1D1F)
      - 文字 "或点击选择文件 · 单个文件不超过 30MB" (14px / 400, 颜色 #6E6E73)
      - 一个小灰色标签: "支持 .pdf 格式 · 可多选" (12px, 颜色 #AEAEB2)
    * hover 态: 边框颜色 #C8963E, 背景 #FFFCF5
    * dragover 态: 边框实线 #C8963E, 背景 #FBF6EC, scale(1.01)
  - 点击拖拽区触发 <input type="file" multiple accept=".pdf">

【4. 已选文件列表】
  - 仅在有文件时显示
  - 列表项设计 (单个文件一行):
    * 圆角 14, 背景 #FFFFFF, 边框 1px solid #E5E5EA
    * 左侧: file-text SVG 图标 (20px, 颜色 #6E6E73)
    * 中间: 文件名 (15px / 500), 副信息: "2.3 MB · 12 页" (13px / 400, 颜色 #6E6E73)
    * 再中间: 产品类型切换下拉
      - 三个选项: "储蓄险 Savings" / "重疾险 Critical Illness" / "万用寿险 IUL"
      - 默认自动识别 (按文件名关键词: 包含"危疾""守护"→ ci;
        包含"iul""Genesis"→ iul; 其他→ savings)
      - 用一个小 select, 圆角 8, 边框 1px, 高度 32px, padding 0 12px
    * 右侧: 删除按钮 (X 图标, 20px, 颜色 #AEAEB2, hover #FF3B30)
  - 列表底部 (有 2 个以上文件时):
    * 一个 "清空列表" 文字按钮 (#6E6E73, 13px)

【5. 空状态 (无文件时)】
  - 上传区下方显示 3 个示例产品卡 (caption 级别, 仅作引导)
  - 横向并排, 每张卡:
    * 圆角 12, 背景 #F5F5F7, 内边距 12-16px
    * 内含一行小字 (13px / 500) + 一行更小字 (12px / 400, 颜色 #6E6E73)
    * 内容: 储蓄险示例 "匠心传承储蓄计划 2" / 重疾险示例 "守护家倍 198" /
      IUL 示例 "Genesis III"
  - 这三张卡不可点击，仅作产品类型提示

【6. 底部固定操作栏 (Sticky Bottom Bar)】
  - 高度 88px, 背景 #FFFFFF, 顶边 1px solid #E5E5EA, 阴影 shadow-lg (向上)
  - 内边距 0 32px (桌面) / 0 16px (移动)
  - 左侧: 文件统计
    * "已选 N 份计划书" (15px / 500)
    * "预计 30 秒完成解析" (13px / 400, 颜色 #6E6E73)
  - 右侧: 主按钮
    * "开始 AI 解析" (16px / 600, 颜色 #FFFFFF, 背景 #C8963E)
    * 高度 48px, 内边距 0 32px, 圆角 14
    * 右侧带一个 sparkles SVG 图标 (18px)
    * hover: 背景 #A87E2A
    * disabled (无文件时): 背景 #E5E5EA, 文字 #AEAEB2, cursor not-allowed

【7. Footer】
  - 简单一行, 居中
  - 文字: "Insurance Plan AI · 让每份计划书都讲好它的故事" (13px, 颜色 #AEAEB2)
  - 上下内边距 24px

【8. 移动端降级】
  - Hero 区从左右分栏变成上下堆叠 (文字在上, 视觉在下)
  - 上传区高度改 180px
  - 底部操作栏高度改 72px
  - 步骤指示器在移动端可隐藏, 只显示当前步骤文字 (如 "步骤 1/5 · 上传")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【三】技术要求
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 单一 HTML 文件, 内联 CSS 和 vanilla JS
2. 使用 Tailwind CSS via CDN (https://cdn.tailwindcss.com) 优先;
   但本设计系统自定义的 token 请用 :root CSS 变量写在 <style> 顶部
3. JS 交互必须实现:
   a) 拖拽上传 (dragenter / dragover / drop)
   b) 点击上传区触发 file input
   c) 已选文件列表渲染 + 单独删除
   d) 产品类型下拉切换
   e) 底部按钮 disabled 态切换
   f) "开始 AI 解析" 按钮点击时, 把文件列表打包为 FormData,
      POST 到 /api/upload (files 字段名复数, types 字段名复数,
      每个文件配套一个 type), 成功后 console.log 返回的 sessionId
      (此屏不跳转, 仅为占位接口)
4. 键盘可访问: Tab 顺序合理, focus 态可见 (金色 outline)
5. 所有 SVG 图标内联, 不要外链
6. 占位图片全部用 CSS 画或 SVG, 不用 unsplash/placehold.co

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【四】不要做的事
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- 不要生成超过 1 个 HTML 文件
- 不要使用 React/Vue/任何框架
- 不要引入外部 JS 库 (jQuery / lodash 等都不要)
- 不要使用真实的保险公司 logo
- 不要写后端代码
- 不要有 dark mode 切换
- 不要有多语言切换
- 不要有用户登录/注册
- 不要有侧边栏
- 不要有 loading skeleton
```

---

## 验收清单（生成后请逐项确认）

- [ ] 顶部步骤指示器显示 5 步，当前第 1 步激活
- [ ] Hero 区文字 + 视觉左右分栏，视觉是 CSS 画的不是图
- [ ] 上传区支持拖拽 + 点击
- [ ] 已选文件列表有产品类型下拉 + 删除按钮
- [ ] 底部固定按钮在没有文件时 disabled
- [ ] 全程无 emoji
- [ ] 全程无深海蓝/紫色背景
- [ ] 移动端布局优雅降级
- [ ] 单 HTML 文件，CDN 只引 Tailwind
- [ ] 拖拽上传在浏览器里实测可用
