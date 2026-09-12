// 轻量 fetch 封装：自动 Bearer token (从 4in1 JWT)
// 2026-08-12: 取消 401 自动重试 (不再有匿名设备登录兜底), 401 直接抛错由 App.vue 拦截跳主页
import { getToken } from './identity'

const BASE = import.meta.env.VITE_API_BASE || '/api'

export async function api(path, { method = 'GET', body, keepalive = false } = {}) {
  const token = getToken()
  const res = await fetch(BASE + path, {
    method,
    keepalive,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  let json = null
  try { json = await res.json() } catch { /* 非 JSON 响应 */ }
  if (!res.ok) throw new Error(json?.message || `请求失败 (${res.status})`)
  // 统一契约 { success, data }，直接返回 data；非该结构则原样返回
  return json && typeof json === 'object' && 'data' in json ? json.data : json
}

// 媒体文件 URL：http(s) 原样返回；'/' 开头相对路径同源访问原样返回
export function resolveMediaUrl(url) {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return url
}