<template>
  <div class="login-container">
    <div class="login-card">
      <div class="logo">
        <h1>{{ isForbidden ? '无访问权限' : '融合以琳培训管理系统' }}</h1>
      </div>
      <div class="redirect-tip">
        <div class="icon">{{ isForbidden ? '🚫' : '🔒' }}</div>
        <p v-if="isForbidden" class="msg">
          当前 4in1 账号 ({{ userEmail || '未登录' }}) 无管理员权限, 请使用 admin 账号登录 4in1
        </p>
        <p v-else class="msg">
          培训管理后台需 4in1 Firebase 登录身份, 请回主页登录
        </p>
        <p class="hint">登录成功后将自动返回培训后台</p>
        <el-button
          type="primary"
          size="large"
          class="login-button"
          @click="goHome"
        >
          {{ isForbidden ? '返回 4in1 主页' : '前往 4in1 主页登录' }}
        </el-button>
        <p class="auto-redirect">5 秒后自动跳转...</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const isForbidden = computed(() => route.path === '/403')

const userEmail = ref<string>('')
let timer: ReturnType<typeof setTimeout> | null = null

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

function goHome() {
  // iframe 内: 跳父窗口 (4in1 主页). 单独新 tab 时 parent === window, fallback 跳 /
  try {
    if (window.parent && window.parent !== window) {
      window.parent.location.href = '/'
    } else {
      window.location.href = '/'
    }
  } catch {
    window.location.href = '/'
  }
}

onMounted(() => {
  // 从 token 解 email 用于 403 提示
  const token = localStorage.getItem('token')
  if (token) {
    const payload = decodeJwt(token)
    userEmail.value = payload?.email || ''
  }
  // 5 秒自动跳 (给用户一个反应时间)
  timer = setTimeout(goHome, 5000)
})

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
}

.login-card {
  width: 400px;
  padding: 40px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.logo {
  text-align: center;
  margin-bottom: 32px;
}

.logo h1 {
  font-size: 24px;
  font-weight: 600;
  color: #1a1a2e;
  margin: 0;
  letter-spacing: 2px;
}

.redirect-tip {
  text-align: center;
  padding: 16px 0;
}

.redirect-tip .icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.redirect-tip .msg {
  font-size: 14px;
  color: #475569;
  line-height: 1.6;
  margin-bottom: 8px;
}

.redirect-tip .hint {
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 24px;
}

.redirect-tip .auto-redirect {
  font-size: 11px;
  color: #cbd5e1;
  margin-top: 16px;
}

.login-button {
  width: 100%;
  font-size: 16px;
}
</style>