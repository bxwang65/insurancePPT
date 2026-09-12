<template>
  <div class="app-shell">
    <!-- 2026-08-12: 鉴权门, 无 4in1 token 时拦截 (iframe 直接打开无 4in1 上下文场景) -->
    <div v-if="!authed" class="auth-gate">
      <div class="auth-icon">🔒</div>
      <h2>请回 4in1 主页登录</h2>
      <p class="auth-tip">培训系统需 4in1 Firebase 登录身份</p>
      <button class="auth-btn" @click="goHome">返回 4in1 主页</button>
    </div>
    <div v-else class="content">
      <TrainingHome />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getToken, getCachedUser } from './utils/identity'
import TrainingHome from './pages/training/TrainingHome.vue'

const authed = ref(false)

function goHome() {
  try {
    // iframe 内: 跳父窗口 (4in1 主页). 单独新 tab 打开时 window.parent === window, fallback 跳 /
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
  // 4in1 同 origin iframe: localStorage['token'] 由 4in1 主页登录后写入
  if (!getToken()) {
    authed.value = false
    return
  }
  const user = getCachedUser()
  if (!user) {
    authed.value = false
    return
  }
  authed.value = true
})
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f4f7fb; color: #333; }
.app-shell { max-width: 420px; margin: 0 auto; min-height: 100vh; display: flex; flex-direction: column; background: #f4f7fb; }
.content { flex: 1; overflow-y: auto; padding-bottom: 0; }

/* 鉴权门 */
.auth-gate { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px; text-align: center; }
.auth-gate .auth-icon { font-size: 56px; margin-bottom: 16px; opacity: .6; }
.auth-gate h2 { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
.auth-gate .auth-tip { font-size: 14px; color: #64748b; margin-bottom: 24px; }
.auth-gate .auth-btn { padding: 10px 24px; background: #2563eb; color: #fff; border: none; border-radius: 99px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(37,99,235,.3); }

.greeting { padding: 4px 16px 16px; }
.greeting h1 { font-size: 28px; font-weight: 700; color: #0f172a; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.greeting .level { font-size: 12px; font-weight: 700; color: #2563eb; background: #dbeafe; padding: 3px 12px; border-radius: 20px; }
.greeting p { font-size: 14px; color: #94a3b8; margin-top: 4px; }
.section-title { font-size: 18px; font-weight: 700; color: #0f172a; padding: 4px 16px 12px; }
.stage-tabs { display: flex; gap: 6px; padding: 0 16px 16px; overflow-x: auto; white-space: nowrap; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.stage-tabs::-webkit-scrollbar { display: none; }
.stage-btn { padding: 7px 16px; border-radius: 99px; font-size: 13px; font-weight: 500; background: #e2e8f0; color: #64748b; cursor: pointer; transition: all .2s; border: none; white-space: nowrap; flex-shrink: 0; }
.stage-btn.active { background: #2563eb; color: #fff; box-shadow: 0 4px 12px rgba(37,99,235,.3); }
.course-list { padding: 0 16px; display: flex; flex-direction: column; gap: 12px; }
.course-card { background: #fff; border-radius: 20px; padding: 14px; display: flex; gap: 16px; align-items: center; box-shadow: 0 4px 20px rgba(0,0,0,.03); cursor: pointer; transition: transform .15s; }
.course-card:active { transform: scale(.98); }
.course-cover { width: 90px; height: 90px; border-radius: 16px; background: #f1f5f9; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 32px; position: relative; overflow: hidden; }
.course-cover.locked::after { content: ''; position: absolute; inset: 0; background: rgba(0,0,0,.4); backdrop-filter: blur(4px); }
.course-cover.locked .lock-icon { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 24px; z-index: 1; }
.course-info { flex: 1; min-width: 0; }
.course-title { font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.course-meta { font-size: 12px; color: #94a3b8; display: flex; gap: 12px; margin-bottom: 8px; }
.course-progress { height: 4px; background: #e2e8f0; border-radius: 4px; overflow: hidden; margin-top: 8px; }
.course-progress-bar { height: 100%; background: #2563eb; border-radius: 4px; transition: width .5s; }
.course-btn { display: inline-block; padding: 4px 20px; border-radius: 99px; font-size: 13px; font-weight: 700; border: none; cursor: pointer; }
.course-btn.primary { background: #0052D9; color: #fff; box-shadow: 0 4px 12px rgba(0,82,217,.2); }
.course-btn.disabled { background: #f1f5f9; color: #94a3b8; }
.empty-state { padding: 48px 16px; display: flex; flex-direction: column; align-items: center; opacity: .5; }
.empty-state .icon { font-size: 40px; margin-bottom: 16px; }
.empty-state .text { font-size: 15px; color: #64748b; }
</style>