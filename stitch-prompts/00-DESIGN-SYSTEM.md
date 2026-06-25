# 保险计划书 AI 助手 — Google Stitch 设计系统基线

> 这是所有 5 个 Screen 提示词共享的设计语言。每个 Screen 提示词开头都要带上
> "请严格遵循以下设计系统"这一段，让 Stitch 输出保持视觉一致。

---

## 一、产品定位（一句话，写到每个 Screen 顶部 hero 文案）

**「把厚重的 PDF 计划书，变成有温度的专业销售演示文稿」**

目标用户：保险销售顾问（30-50 岁，香港/新加坡地区为主，审美偏高端商务）
使用场景：客户面谈前 5 分钟快速生成方案
情绪基调：克制、专业、可信、温暖

---

## 二、配色系统（白底 Apple 风，浅色为主）

### 主色
```
背景基色:        #FAFAFA
卡片背景:        #FFFFFF
分隔线/边线:     #E5E5EA
次要文字:        #6E6E73
三级文字/占位:   #AEAEB2
纯黑标题:        #1D1D1F   （Apple 官网同款）
```

### 强调色（克制使用，单屏 ≤ 2 处）
```
品牌金:          #C8963E   （主按钮、关键数字、选中态）
品牌金 hover:    #A87E2A
品牌金浅底:      #FBF6EC   （选中态背景）
```

### 状态色
```
成功:            #34C759   （Apple 系统绿）
警告:            #FF9500
错误:            #FF3B30
处理中:          #007AFF   （Apple 系统蓝，仅用于进度/链接）
```

### 严禁
```
❌ 深海蓝背景（#0A1628 等）
❌ 紫色/靛蓝渐变（"AI 感"重灾区）
❌ 高饱和度背景色块
❌ 黑色大面积铺底
```

---

## 三、字体

```
英文字体:    -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif
中文字体:    "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
等宽数字:    "SF Mono", ui-monospace, monospace  （金额/数据专用）
```

### 字号阶梯（Apple HIG 调整版）
```
display:    56px / 700 / -0.02em   （Hero 大标题）
h1:         40px / 700 / -0.015em
h2:         28px / 600 / -0.01em   （页面主标题）
h3:         20px / 600 / -0.005em
body-lg:    17px / 400 / 0        （Apple 系统正文）
body:       15px / 400 / 0
caption:    13px / 500 / 0.02em
micro:      11px / 600 / 0.06em    （仅用于 ALL CAPS 标签）
```

### ALL CAPS 规则
```
任何英文 ALL CAPS 必须 letter-spacing: 0.06em 或更宽
示例:  "UPLOAD YOUR FILES"  而不是  "UPLOAD YOUR FILES"
```

---

## 四、圆角 / 阴影 / 间距

### 圆角
```
xs:   6px    （小标签、checkbox）
sm:   10px   （次要按钮、输入框）
md:   14px   （卡片内元素）
lg:   20px   （主卡片）
xl:   28px   （大容器/模态）
full: 9999px （按钮、头像、状态点）
```

### 阴影（极轻，模仿 iOS 真实质感）
```
shadow-sm:   0 1px 2px rgba(0,0,0,0.04)
shadow-md:   0 4px 12px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.03)
shadow-lg:   0 12px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)
shadow-xl:   0 24px 64px rgba(0,0,0,0.10)
```

### 间距（8 栅格）
```
4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 56 / 80 / 120
```

---

## 五、组件基础规范

### 按钮
```
主按钮 (btn-primary):
  - 背景 #C8963E, 文字 #FFFFFF
  - 高度 48px, 圆角 14px
  - 字号 16px / 600
  - hover: #A87E2A + shadow-md
  - active: scale(0.98)
  - disabled: #E5E5EA 背景, #AEAEB2 文字

次按钮 (btn-secondary):
  - 背景 #FFFFFF, 文字 #1D1D1F
  - 边框 1px solid #E5E5EA
  - hover: 背景 #F5F5F7
  - 其余同主按钮

文字按钮 (btn-ghost):
  - 无背景, 文字 #007AFF
  - hover: 背景 rgba(0,122,255,0.08)
```

### 卡片
```
基础卡片:
  - 背景 #FFFFFF
  - 圆角 20px
  - 边框 1px solid rgba(0,0,0,0.04)
  - 阴影 shadow-md
  - 内边距 24px

悬浮卡片（可点击）:
  - hover: shadow-lg + translateY(-2px)
  - 过渡 200ms cubic-bezier(0.4, 0, 0.2, 1)
```

### 输入框
```
文本输入:
  - 高度 48px
  - 圆角 12px
  - 边框 1px solid #E5E5EA
  - focus: 边框 #C8963E + 阴影 0 0 0 4px rgba(200,150,62,0.12)
  - placeholder 颜色 #AEAEB2
```

### 标签/徽章
```
类型徽章 (savings/ci/iul):
  - savings 储蓄险: 背景 #E8F1FF, 文字 #007AFF
  - ci 重疾险:    背景 #FFF0F0, 文字 #FF3B30
  - iul 万用寿险: 背景 #F0FFF4, 文字 #34C759
  - 通用规则: padding 4px 10px, 圆角 6px, 字号 12px / 600
```

### 头像/Logo 占位
```
圆形:  直径 32-40px, 背景 #F5F5F7, 内显示公司名首字
方形:  圆角 8px, 背景 #F5F5F7, 居中显示公司简称
```

---

## 六、图标（严禁 emoji）

所有图标使用 **Lucide Icons** 风格（线性，1.5-2px 描边，圆角端点），
尺寸 20-24px，颜色继承父元素文字色。

需要用到的图标（按使用频率）：
  upload-cloud / file-text / x / check / chevron-right / chevron-left
  / sparkle / message-circle / arrow-up / download / refresh-cw
  / briefcase / shield / trending-up / building-2 / star / lock

示例 SVG（复制即用）：
```html
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
  <polyline points="17 8 12 3 7 8"/>
  <line x1="12" y1="3" x2="12" y2="15"/>
</svg>
```

---

## 七、布局与栅格

桌面（≥ 1024px）：居中容器，最大宽度 1120px，左右内边距 32px
笔记本（768-1023px）：居中容器，最大宽度 720px
移动（< 768px）：左右内边距 16px，全宽布局

**关键决策：本产品主推桌面端使用（顾问在办公室），但必须移动端可用。**
**桌面优先设计，移动端优雅降级。**

---

## 八、动效（极简、克制）

```
入场:    fade + translateY(8px),  300ms cubic-bezier(0.4, 0, 0.2, 1)
悬停:    200ms ease-out
点击:    scale(0.98), 100ms
页面切换: 250ms 交叉淡入淡出
```

❌ 禁用：弹跳、旋转、闪光、流光背景、粒子效果

---

## 九、字体使用总结（最终对照）

写到所有 HTML 的 <style> 顶部：

```css
:root {
  --bg-base: #FAFAFA;
  --bg-card: #FFFFFF;
  --border: #E5E5EA;
  --text-primary: #1D1D1F;
  --text-secondary: #6E6E73;
  --text-tertiary: #AEAEB2;
  --accent-gold: #C8963E;
  --accent-gold-hover: #A87E2A;
  --accent-gold-soft: #FBF6EC;
  --status-success: #34C759;
  --status-warning: #FF9500;
  --status-error: #FF3B30;
  --status-info: #007AFF;
  --radius-xs: 6px;
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-xl: 28px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.03);
  --shadow-lg: 0 12px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);
  --shadow-xl: 0 24px 64px rgba(0,0,0,0.10);
}

* { margin: 0; padding: 0; box-sizing: border-box; -webkit-font-smoothing: antialiased; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif;
  background: var(--bg-base);
  color: var(--text-primary);
  line-height: 1.5;
}
```

---

## 十、严禁清单（每个 Screen 提示词都要带上）

1. ❌ 任何 emoji 字符（🏦🛡️📈🤖📊✨⬇️📋❌✅ 等）
2. ❌ 深海蓝/紫色/靛蓝渐变背景
3. ❌ 阴影超过 shadow-xl 的浮夸效果
4. ❌ ALL CAPS 英文不加分字距
5. ❌ 单屏超过 2 处金色强调
6. ❌ 花哨的 hover 动画（旋转/弹跳/缩放超过 1.05）
7. ❌ 模板化 AI 文案（"赋能"、"智领未来"、"卓越品质"等空话）
8. ❌ 占位图使用 unsplash 链接（用 SVG/CSS 自绘）
9. ❌ 字体大小超过 56px 或小于 11px
10. ❌ 圆角小于 6px 或大于 28px（按钮/卡片除外）
