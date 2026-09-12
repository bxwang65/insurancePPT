/* =========================================================================
   Insurance Plan AI - 后端 API 封装
   ========================================================================= */

const DEFAULT_LOCAL_API = 'http://localhost:3000';
const BASE = location.protocol === 'file:' ? DEFAULT_LOCAL_API : '';

// 用户自定义 API key (从 localStorage 读, 用于绕过服务端 key 缺失)
function getUserApiKey() {
  try { return localStorage.getItem('userApiKey') || ''; } catch { return ''; }
}
function getUserApiProvider() {
  try { return localStorage.getItem('userApiProvider') || 'deepseek'; } catch { return 'deepseek'; }
}
function authHeaders(extra = {}) {
  const k = getUserApiKey();
  const p = getUserApiProvider();
  const h = { ...extra };
  if (k) {
    h['X-User-Api-Key'] = k;
    h['X-User-Api-Provider'] = p;  // deepseek | openai | gemini
  }
  return h;
}

/* —— POST /api/upload ——————————————————————————————————————————
   入参: files = [{ file: File, type: 'savings'|'ci'|'iul' }]
   出参: { sessionId, files: [] }
   异常: throw Error(msg)
   注: 公司选择在生成页 per-product 选, 上传阶段不再传 companies  */
export async function uploadFiles(files) {
  const form = new FormData();
  for (const { file, type } of files) {
    form.append('files', file);
    form.append('types', type);
  }
  const res = await fetch(BASE + '/api/upload', {
    method: 'POST',
    body: form,
    headers: getUserApiKey() ? { 'X-User-Api-Key': getUserApiKey(), 'X-User-Api-Provider': getUserApiProvider() } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '上传失败');
  }
  return res.json();
}

/* —— POST /api/parse/:sessionId ————————————————————————————————
   触发 AI 解析, 平均 30 秒
   出参: { extractions: [...], message: 'AI 初始摘要' }  */
export async function parseSession(sessionId) {
  // 用 AbortController 设 5 分钟 timeout (后台 fast-path 通常 30 秒, LLM 调用可能 1-2 分钟)
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5 * 60 * 1000);
  try {
    const res = await fetch(BASE + `/api/parse/${sessionId}`, {
      method: 'POST',
      headers: getUserApiKey() ? { 'X-User-Api-Key': getUserApiKey(), 'X-User-Api-Provider': getUserApiProvider() } : {},
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '解析失败');
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* —— GET /api/session/:id ————————————————————————————————————
   轮询解析状态, 直到 status !== 'parsing'
   出参: { status, extractions, chatHistory }  */
export async function getSession(sessionId) {
  const res = await fetch(BASE + `/api/session/${sessionId}`);
  if (!res.ok) throw new Error('Session not found');
  return res.json();
}

/* —— GET /api/validate-extraction/:id —————————————————————————
   出参: { validated, errorCount, warnCount, issues } */
export async function validateExtraction(sessionId) {
  const res = await fetch(BASE + `/api/validate-extraction/${sessionId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '校验失败');
  }
  return res.json();
}

/* —— POST /api/chat/:id ——————————————————————————————————————
   入参: { message }
   出参: { message: AI回复, history: 最新20条 }  */
export async function sendChat(sessionId, message) {
  const res = await fetch(BASE + `/api/chat/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '对话失败');
  }
  return res.json();
}

/* —— GET /api/render-options ——————————————————————————————————
   出参: { companies: [{id, name, tenantId}], templates: [{id, name}] }  */
export async function getRenderOptions() {
  try {
    const res = await fetch(BASE + '/api/render-options');
    if (!res.ok) return { companies: [], templates: [] };
    return res.json();
  } catch { return { companies: [], templates: [] }; }
}

/* —— POST /api/generate-enhanced/:id ——————————————————————————
   使用增强渲染器 (python-pptx 原生表格/图表)
   入参: { companyId, theme, assignments: [{ pdfName, companyId }] }
   出参: { downloadUrl }  */
export async function generatePPT({ sessionId, style, companyId, companyInfo, format = 'pptx', quality = 'high', savingsCompanyId, ciCompanyId, iulCompanyId, aiNarrative, assignments = [] }) {
  const res = await fetch(BASE + `/api/generate-enhanced/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      companyId: companyId || 'ctf',
      theme: style || 'broker',
      companyInfo: companyInfo || '',
      format: format || 'pptx',
      quality: quality || 'high',
      savingsCompanyId: savingsCompanyId || '',
      ciCompanyId: ciCompanyId || '',
      iulCompanyId: iulCompanyId || '',
      aiNarrative: aiNarrative || '',
      assignments: assignments || [],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '生成失败');
  return data;
}

/* —— 下载签名文件 ——————————————————————————————————————————
   走带 expires+token 的签名 URL
   2026-07-30: 改用 window.location.href 直跳 — 浏览器边收边弹保存框, 不再 await blob
   之前 await fetch + res.blob() 让用户等整个 PPT 下载完才看到弹窗 (冷缓存 30-60s 黑屏)
   Server Content-Disposition 已带 UTF-8 filename, 不需要前端设 a.download
   出参: 空 Blob (保留 async 签名兼容调用方)  */
export async function downloadSignedFile(relativeUrl) {
  // 在浏览器中: 直接跳转让浏览器接管流式下载 + 立即弹保存框
  if (typeof window !== "undefined" && window.location) {
    window.location.href = BASE + relativeUrl;
    return new Blob();
  }
  // Node/SSR 兜底: 仍走 fetch + blob
  const res = await fetch(BASE + relativeUrl);
  if (!res.ok) throw new Error(`下载失败 (${res.status})`);
  return res.blob();
}
