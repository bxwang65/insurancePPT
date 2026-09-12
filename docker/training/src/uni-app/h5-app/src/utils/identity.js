// 2026-08-12: 培训走 4in1 IdP, 不再匿名设备登录.
//   - 4in1 JWT 存 4in1 主页 localStorage['token'], iframe 同源 (4in1 vite serve :8080) 可直接读
//   - 解 JWT payload 拿用户信息 (sub/email/name/isAdmin/firebaseUid)
//   - 旧 ss_token / ss_user / ss_device_id 一律弃用, 不再读也不写

const TOKEN_KEY = 'token'  // 与 4in1 主页共享同 key (同 origin localStorage)

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

// 解 JWT payload (中间一段 base64url, 不验签 — 服务端 passport-jwt 已 verify)
export function decodeJwt(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

// 从 4in1 JWT 提取 user 字段 (与 insurance-ppt /auth/me 返回 shape 接近)
export function getCachedUser() {
  const token = getToken()
  if (!token) return null
  const payload = decodeJwt(token)
  if (!payload?.sub) return null
  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    isAdmin: !!payload.isAdmin,
    firebaseUid: payload.firebaseUid,
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
}

// 兼容老调用点 (TrainingHome/LearningRecord 之前 await ensureSession()).
//   现在是同步读 token; 无 token 抛错由调用方展示.
export function ensureSession() {
  const token = getToken()
  if (!token) throw new Error('未登录, 请回 4in1 主页登录')
  return { token, user: getCachedUser() }
}