# 整合说明：把 Google Stitch 生成的 5 个 HTML 拼起来 + 对接后端

> 你在 Google Stitch 跑完 5 个 Screen 之后, 拿到 5 个独立 HTML 文件,
> 这一步是教你怎么拼成 1 个能跑的项目, 直接替换 public/index.html。

---

## 一、最终目录结构（你要达到的目标）

```
packages/insurance-ppt/
├── public/
│   ├── index.html            ← Stitch 整合后唯一入口
│   ├── css/
│   │   ├── tokens.css        ← 设计系统 CSS 变量 (从 00 复制)
│   │   ├── components.css    ← 按钮/卡片/输入框等组件
│   │   └── icons.css         ← Lucide SVG 精灵
│   ├── js/
│   │   ├── api.js            ← 封装所有 fetch 调用
│   │   ├── state.js          ← 全局 session 状态
│   │   ├── steps.js          ← 5 步导航控制
│   │   ├── screens/
│   │   │   ├── screen-upload.js
│   │   │   ├── screen-parsing.js
│   │   │   ├── screen-chat.js
│   │   │   ├── screen-generate.js
│   │   │   └── screen-result.js
│   │   └── app.js            ← 启动入口
│   └── downloads/            ← 保留 (后端签名下载用)
├── src/api/server.ts         ← 完全不动
└── ... (其余后端代码完全不动)
```

---

## 二、整合步骤（5 步）

### 步骤 1: 拿到 5 个 HTML 后, 提取通用部分

每个 Stitch 输出都会有这些重复:
- 顶部导航栏 64px (5 屏几乎一致, 只有激活步骤不同)
- 底部状态 (其实可以去掉, 5 屏已经不需要)
- Tailwind CDN 引入
- :root 颜色变量
- Lucide SVG 图标

**做法**: 把这些抽出来到 `public/css/tokens.css` 和 `public/css/components.css`,
5 个 screen 只保留主区内容。

### 步骤 2: 改造成"单页 + 切屏"架构

5 个 screen 改成 5 个 `<section id="screen-xxx">` 在同一 HTML 内,
通过 CSS `.active` 类切换显示, 不用跳转。

最终 index.html 结构:
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>...</head>
<body>
  <header id="topbar">...</header>
  
  <main>
    <section id="screen-upload" class="screen active">...</section>
    <section id="screen-parsing" class="screen">...</section>
    <section id="screen-chat" class="screen">...</section>
    <section id="screen-generate" class="screen">...</section>
    <section id="screen-result" class="screen">...</section>
  </main>
  
  <script type="module" src="/js/app.js"></script>
</body>
</html>
```

CSS 切换:
```css
.screen { display: none; }
.screen.active { display: block; animation: fadeIn 0.3s ease; }
```

### 步骤 3: 写 state.js (全局会话状态)

```javascript
// public/js/state.js
export const state = {
  sessionId: null,           // 后端返回的 UUID
  files: [],                 // [{ file: File, type: 'savings'|'ci'|'iul' }]
  extractions: [],           // 解析结果
  selectedStyle: 'broker',   // 5 选 1
  selectedCompanyId: '',     // 公司 ID
  companyInfo: '',           // 用户填的补充介绍
  downloadUrl: '',           // 后端返回的下载 URL
  markdownUrl: '',
};

export function reset() {
  state.sessionId = null;
  state.files = [];
  state.extractions = [];
  state.selectedCompanyId = '';
  state.companyInfo = '';
  state.downloadUrl = '';
  state.markdownUrl = '';
}
```

### 步骤 4: 写 api.js (封装所有后端调用)

```javascript
// public/js/api.js

const BASE = '';  // 同域, 不需要前缀

export async function uploadFiles(files) {
  // 入参: [{ file: File, type: string }]
  const form = new FormData();
  for (const { file, type } of files) {
    form.append('files', file);
    form.append('types', type);
  }
  const res = await fetch(BASE + '/api/upload', { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '上传失败');
  }
  return res.json(); // { sessionId, files }
}

export async function parseSession(sessionId) {
  const res = await fetch(BASE + `/api/parse/${sessionId}`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '解析失败');
  }
  return res.json(); // { sessionId, status, extractions, message }
}

export async function getSession(sessionId) {
  const res = await fetch(BASE + `/api/session/${sessionId}`);
  if (!res.ok) throw new Error('Session not found');
  return res.json();
}

export async function sendChat(sessionId, message, history = []) {
  const res = await fetch(BASE + `/api/chat/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '对话失败');
  }
  return res.json(); // { sessionId, message, history }
}

export async function getRenderOptions() {
  const res = await fetch(BASE + '/api/render-options');
  if (!res.ok) return { companies: [], templates: [] };
  return res.json();
}

export async function generatePPT({ sessionId, style, companyId, companyInfo }) {
  const res = await fetch(BASE + `/api/generate/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      style,
      templateId: style,
      companyId,
      companyInfo,
      format: 'pptx',
      quality: 'standard',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    // 特殊处理: 公司产品不匹配
    if (data.error === 'COMPANY_PRODUCT_MISMATCH') {
      throw new Error(`请选择 ${data.expectedCompanyId} 的公司, 而非 ${data.selectedCompanyId}`);
    }
    throw new Error(data.error || '生成失败');
  }
  return data; // { sessionId, status, downloadUrl, markdownUrl }
}

export async function downloadFile(url) {
  // 走签名下载 (后端要求 expires + token 校验)
  const res = await fetch(BASE + url);
  if (!res.ok) throw new Error('下载失败');
  const blob = await res.blob();
  return blob;
}
```

### 步骤 5: 改造 5 个 screen 脚本 (填真 API)

每个 screen-xxx.js 暴露一个 `init()` 函数, 由 app.js 调度。

#### screen-upload.js 关键改动

```javascript
import { state } from '../state.js';
import { uploadFiles } from '../api.js';
import { goStep } from '../steps.js';

export function init() {
  // 拖拽 + 点击上传 (Stitch 写好的保留)
  // 文件类型自动识别 (保留 Stitch 的逻辑)
  
  // 替换"开始 AI 解析" 按钮的 onClick:
  document.getElementById('start-parse-btn').onclick = async () => {
    if (state.files.length === 0) return;
    const btn = document.getElementById('start-parse-btn');
    btn.disabled = true;
    btn.textContent = '上传中...';
    try {
      const { sessionId } = await uploadFiles(state.files);
      state.sessionId = sessionId;
      goStep('parsing');
      // 立即触发解析
      await triggerParse();
    } catch (err) {
      alert('上传失败: ' + err.message);
      btn.disabled = false;
      btn.textContent = '开始 AI 解析';
    }
  };
}

async function triggerParse() {
  try {
    const { extractions, message } = await parseSession(state.sessionId);
    state.extractions = extractions;
    // 缓存对话初始消息
    state.initialChatMessage = message;
    goStep('chat');
  } catch (err) {
    alert('解析失败: ' + err.message);
    goStep('upload');
  }
}
```

#### screen-parsing.js 关键改动

```javascript
import { state } from '../state.js';

export function init() {
  // 显示文件列表 + 启动进度 (Stitch 写好的保留)
  // 实时进度: 如果后端能流式返回就用 SSE, 不能就用 setInterval 轮询
  //   简单做法: 进入本屏就 await parseSession, 完成后 goStep('chat')
  
  pollParse();
}

async function pollParse() {
  // 轮询 /api/session/:id 直到 status !== 'parsing'
  const interval = setInterval(async () => {
    try {
      const session = await getSession(state.sessionId);
      updateFilesStatus(session.extractions);
      if (session.status === 'parsed') {
        clearInterval(interval);
        state.extractions = session.extractions;
        state.initialChatMessage = session.chatHistory?.[0]?.content;
        goStep('chat');
      } else if (session.status === 'error') {
        clearInterval(interval);
        alert('解析失败');
        goStep('upload');
      }
    } catch (err) {
      clearInterval(interval);
      alert('查询失败: ' + err.message);
    }
  }, 2000);
}
```

#### screen-chat.js 关键改动

```javascript
import { state } from '../state.js';
import { sendChat } from '../api.js';
import { goStep } from '../steps.js';

export function init() {
  // 渲染初始 AI 消息
  if (state.initialChatMessage) {
    addMessage('assistant', state.initialChatMessage);
    state.initialChatMessage = null;
  }
  
  // 渲染左侧摘要 (从 state.extractions)
  renderSummary(state.extractions);
  
  // 发送按钮
  document.getElementById('send-btn').onclick = sendUserMessage;
  document.getElementById('chat-input').onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendUserMessage();
    }
  };
}

async function sendUserMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;
  
  addMessage('user', message);
  input.value = '';
  showTypingIndicator();
  
  try {
    const { message: reply, history } = await sendChat(state.sessionId, message);
    hideTypingIndicator();
    addMessage('assistant', reply);
    state.chatHistory = history;
  } catch (err) {
    hideTypingIndicator();
    addMessage('assistant', '❌ ' + err.message);
  }
}

// "生成 PPT" 按钮
document.getElementById('goto-generate-btn').onclick = () => goStep('generate');
```

#### screen-generate.js 关键改动

```javascript
import { state } from '../state.js';
import { getRenderOptions, generatePPT } from '../api.js';
import { goStep } from '../steps.js';

export async function init() {
  // 加载公司列表
  const { companies, templates } = await getRenderOptions();
  renderCompanyGrid(companies);
  renderStyleGrid(templates);  // 5 个风格, 来自 TEMPLATE_PRESETS
  
  // 风格选中
  document.querySelectorAll('.style-card').forEach(card => {
    card.onclick = () => {
      document.querySelectorAll('.style-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.selectedStyle = card.dataset.style;
      updatePreview();  // 切换右栏预览主色
    };
  });
  
  // 公司选中
  document.querySelectorAll('.company-card').forEach(card => {
    card.onclick = () => {
      document.querySelectorAll('.company-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.selectedCompanyId = card.dataset.companyId;
      updateGenerateButton();
    };
  });
  
  // 公司介绍文本
  document.getElementById('company-info-textarea').oninput = (e) => {
    state.companyInfo = e.target.value;
  };
  
  // "开始生成" 按钮
  document.getElementById('start-generate-btn').onclick = onGenerate;
}

async function onGenerate() {
  if (!state.selectedCompanyId) {
    alert('请选择公司');
    return;
  }
  const btn = document.getElementById('start-generate-btn');
  btn.disabled = true;
  btn.textContent = '生成中...';
  
  try {
    const data = await generatePPT({
      sessionId: state.sessionId,
      style: state.selectedStyle,
      companyId: state.selectedCompanyId,
      companyInfo: state.companyInfo,
    });
    state.downloadUrl = data.downloadUrl;
    state.markdownUrl = data.markdownUrl;
    goStep('result');
  } catch (err) {
    alert('生成失败: ' + err.message);
    btn.disabled = false;
    btn.textContent = '开始生成 PPT';
  }
}
```

#### screen-result.js 关键改动

```javascript
import { state } from '../state.js';
import { downloadFile } from '../api.js';
import { reset } from '../state.js';
import { goStep } from '../steps.js';

export function init() {
  // 渲染文件名 + 关键数据
  const filename = state.downloadUrl.split('/').pop();
  document.getElementById('ppt-filename').textContent = decodeURIComponent(filename);
  
  // 下载按钮
  document.getElementById('download-ppt-btn').onclick = async () => {
    try {
      const blob = await downloadFile(state.downloadUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = decodeURIComponent(filename);
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('下载失败: ' + err.message);
    }
  };
  
  // 下载 Markdown
  if (state.markdownUrl) {
    document.getElementById('download-md-btn').style.display = 'inline-block';
    document.getElementById('download-md-btn').onclick = async () => {
      const blob = await downloadFile(state.markdownUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = decodeURIComponent(state.markdownUrl.split('/').pop());
      a.click();
    };
  }
  
  // "新建方案"
  document.getElementById('new-session-btn').onclick = () => {
    reset();
    goStep('upload');
  };
}
```

---

## 三、启动方式（不变）

```bash
cd /Users/soldier/free-code/packages/insurance-ppt
bun run src/api/server.ts
# 打开 http://localhost:3000
```

后端 server.ts 完全不动, 它会把 public/ 下的所有文件 (HTML/CSS/JS) 作为静态资源服务,
同时 API 路由继续工作。

---

## 四、API 调用的关键约定 (Google Stitch 生成的代码里要照这个写)

| 接口 | 入参关键字段 | 返回关键字段 | 前端要做的 |
|------|------|------|------|
| POST /api/upload | FormData: files[] + types[] | { sessionId, files[] } | 保存 sessionId |
| POST /api/parse/:id | (无 body) | { extractions, message } | message 是 AI 的初始摘要, 直接显示在 chat |
| GET /api/session/:id | (无) | { status, extractions, chatHistory } | 轮询, 看到 status==='parsed' 就跳下一步 |
| POST /api/chat/:id | { message } | { message, history } | 渲染 message |
| GET /api/render-options | (无) | { companies[], templates[] } | companies 填公司卡, templates 填风格卡 |
| POST /api/generate/:id | { style, templateId, companyId, companyInfo, format, quality } | { downloadUrl, markdownUrl } | downloadUrl 已经是签名 URL, 直接 fetch |
| GET /downloads/... | query: ?expires=&token= | (文件流) | 用 a.click() 触发下载 |

---

## 五、防坑清单

1. **CORS**: 后端已经设了 `Access-Control-Allow-Origin: *`, 同域访问更稳, 别跨域。

2. **认证**: 用户的部署环境没配 APP_API_KEY, 所以所有 API 不需要 X-API-Key Header。
   如果 Stitch 生成时自动加了 Header, 后端会忽略。

3. **sessionId 持久化**: 建议存到 `sessionStorage`, 刷新页面能恢复。但 100 个会话 LRU 清理
   后会 404, 这种情况下重置到 upload 页。

4. **PDF 文件大小**: 后端限制 30MB, 上传前先在前端检查 `file.size > 30*1024*1024` 弹错。

5. **公司 ID 来源**: 一定要从 `/api/render-options` 拿, 不要硬编码。后端有 16 家公司,
   ID 形如 `aia` / `manulife` / `pru` / `axa` 等。

6. **风格 ID**: 5 个固定值 `broker` / `business` / `minimal` / `chinese` / `ink`,
   前端写死即可。

7. **签名下载 URL**: downloadUrl 已经带了 `?expires=...&token=...`, 前端 fetch 时
   要带上完整 URL, 不要丢 query string。

8. **chat 自动滚动**: 消息追加后立即 `container.scrollTop = container.scrollHeight`。
   关键: 必须在 DOM 节点挂载后再设, 用 setTimeout 0 或 requestAnimationFrame。

9. **状态机一致性**: 前端状态由 step 决定, 后端状态由 session.status 决定, 偶尔会脱节
   (比如用户刷新页面)。处理方式: 启动时 GET /api/session/:id, 如果有 extractions 就直接
   跳到 chat 屏。

10. **失败回退**: 任何 API 失败, 弹 toast (右上角浮窗) 即可, 不要用浏览器原生 alert
    (丑)。Stitch 设计一个简单的 toast 组件, 3 秒自动消失。

---

## 六、视觉细节验收 (整合后)

整合完成后, 在桌面浏览器打开 http://localhost:3000, 应该看到:

  [ ] 整页背景 #FAFAFA, 看不到原版那种"黑底蓝紫"的旧 UI
  [ ] 5 步指示器在顶部, 当前步骤高亮
  [ ] 文字字体: 英文 SF Pro, 中文 PingFang
  [ ] 没有 emoji 字符
  [ ] 圆角统一 (卡片 20px, 按钮 14px, 输入 12px)
  [ ] 阴影极轻
  [ ] 金色 #C8963E 单屏最多 2 处
  [ ] 移动端 (DevTools 切到 iPhone) 布局正确, 没有横向滚动条
  [ ] 跑完一个完整流程: 上传 → 解析 → 对话 → 选风格公司 → 生成 → 下载

如果哪一步 UI 看着不对, 把那个屏的提示词微调后回 Stitch 重新生成, 不用改其他屏。

---

## 七、如果你想分阶段上线 (推荐)

Phase 1: 先替换 Screen 1 (Upload) + Screen 5 (Result) 这两个, 因为它们改动最独立,
其余 3 屏先用原版 HTML 凑合。

Phase 2: 替换 Screen 2 (Parsing), 加上真实的轮询逻辑。

Phase 3: 替换 Screen 3 (Chat), 接入真实 /api/chat。

Phase 4: 替换 Screen 4 (Generate), 接入真实 /api/render-options 和 /api/generate。

这样每个阶段都能跑, 不需要一次性吃 5 个屏。
