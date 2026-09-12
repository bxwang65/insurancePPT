import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUserStore = defineStore('user', () => {
  // 2026-08-12: 4in1 作 IdP, admin-web 与 4in1 主页同 origin, 共用 'token' key (设计意图).
  //   解 JWT payload 拿 user 字段 (isAdmin/email/name/sub), store 缓存以备 layout 显示.
  const TOKEN_KEY = 'token'

  function decodeJwt(token: string): any | null {
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

  function readUserFromToken() {
    const t = localStorage.getItem(TOKEN_KEY)
    if (!t) return null
    const p = decodeJwt(t)
    if (!p?.sub) return null
    return {
      id: p.sub,
      email: p.email,
      name: p.name,
      isAdmin: !!p.isAdmin,
      firebaseUid: p.firebaseUid,
    }
  }

  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
  const userInfo = ref<any | null>(readUserFromToken())

  function refresh() {
    token.value = localStorage.getItem(TOKEN_KEY)
    userInfo.value = readUserFromToken()
  }

  function clearToken() {
    // 注意: 清掉 4in1 token = 让父窗口也登出. 这是设计意图 — admin-web 退出 = 4in1 退出.
    localStorage.removeItem(TOKEN_KEY)
    token.value = null
    userInfo.value = null
  }

  return {
    token,
    userInfo,
    refresh,
    clearToken,
  }
})
