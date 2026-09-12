<template>
  <view class="fixed inset-0 w-full h-full overflow-hidden bg-[#f4f7fb] flex flex-col items-center pt-24 px-8">
    <!-- 装饰光晕 -->
    <view class="absolute top-[-10%] left-[-20%] w-80 h-80 bg-cyan-300/40 rounded-full blur-[80px] pointer-events-none"></view>
    <view class="absolute bottom-[10%] right-[-20%] w-96 h-96 bg-purple-300/30 rounded-full blur-[90px] pointer-events-none"></view>
    <view class="absolute top-[30%] right-[-10%] w-64 h-64 bg-blue-400/20 rounded-full blur-[70px] pointer-events-none"></view>

    <!-- Logo 区域 -->
    <view class="flex flex-col items-center mb-12 z-10 animate-fade-in-down">
      <view class="w-36 h-36 mb-2">
        <image
          class="w-full h-full"
          src="/static/logo.png"
          mode="aspectFit"
        />
      </view>
      <text class="text-2xl font-bold text-gray-800 tracking-widest mb-1">融合以琳</text>
      <text class="text-[10px] font-medium text-gray-500 tracking-[0.2em]">INTERNATIONAL INSURANCE</text>
    </view>

    <!-- 标题 -->
    <text class="text-xl font-medium text-gray-800 mb-8 z-10">账号登录</text>

    <!-- 输入表单 -->
    <view class="w-full z-10 bg-sky-100/70 backdrop-blur-md rounded-3xl px-6 py-6 border border-sky-200/50 shadow-[0_8px_32px_rgba(0,0,0,0.06)]">
      <!-- 手机号输入 -->
      <view class="flex items-center w-full h-14 bg-white/80 backdrop-blur-md rounded-full px-5 mb-5 border border-white/60 shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition-all focus-within:border-blue-400 focus-within:bg-white">
        <image class="w-5 h-5 mr-3 opacity-60" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMGI3ZWZmIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iNSIgeT0iMiIgd2lkdGg9IjE0IiBoZWlnaHQ9IjIwIiByeD0iMiIgcnk9IjIiPjwvcmVjdD48bGluZSB4MT0iMTIiIHkxPSIxOCIgeDI9IjEyLjAxIiB5Mj0iMTgiPjwvbGluZT48L3N2Zz4=" mode="aspectFit" />
        <input
          class="flex-1 text-sm text-gray-800 placeholder-gray-400 h-full"
          placeholder="请输入手机号/邮箱"
          placeholder-class="text-gray-400 font-light"
          v-model="phone"
        />
      </view>

      <!-- 密码输入 -->
      <view class="flex items-center w-full h-14 bg-white/80 backdrop-blur-md rounded-full px-5 mb-8 border border-white/60 shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition-all focus-within:border-blue-400 focus-within:bg-white">
        <text class="text-blue-500 mr-3 text-lg opacity-80">🔒</text>
        <input
          class="flex-1 text-sm text-gray-800 placeholder-gray-400 h-full"
          :password="!showPwd"
          placeholder="请输入密码"
          placeholder-class="text-gray-400 font-light"
          v-model="password"
        />
        <view class="p-2" @click="showPwd = !showPwd">
          <text class="text-gray-400 text-lg">{{ showPwd ? '👁️' : '🕶️' }}</text>
        </view>
      </view>

      <!-- 登录按钮 -->
      <button
        class="w-full h-14 rounded-full bg-gradient-to-r from-[#2196f3] to-[#00bcd4] text-white text-[16px] font-medium flex items-center justify-center shadow-[0_8px_20px_rgba(33,150,243,0.3)] border-0 active:scale-[0.98] transition-transform"
        :loading="loading"
        @click="handleLogin"
      >
        <text class="text-sky-700">登 录</text>
      </button>

      <!-- 注册/忘记密码 -->
      <view class="flex justify-between w-full px-2 mt-6">
        <text class="text-sm text-gray-500">没有账号？<text class="text-blue-500">去注册</text></text>
        <text class="text-sm text-gray-500">忘记密码？</text>
      </view>
    </view>

  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { post } from '@/utils/request'

// 已登录则跳转首页
onLoad(() => {
  const token = uni.getStorageSync('token')
  if (token) {
    uni.reLaunch({ url: '/pages/index/index' })
  }
})

const phone = ref('')
const password = ref('')
const showPwd = ref(false)
const loading = ref(false)

async function handleLogin() {
  if (!phone.value || !password.value) {
    uni.showToast({ title: '请输入账号和密码', icon: 'none' })
    return
  }

  loading.value = true
  try {
    const res: any = await post('/auth/login', {
      phone: phone.value,
      password: password.value,
    })

    // 后端返回结构: { success: true, data: { access_token, user: { id, ... } } }
    if (res.success && res.data?.access_token) {
      uni.setStorageSync('token', res.data.access_token)
      uni.setStorageSync('userId', res.data.user?.id || 'u_001')
      uni.showToast({ title: '登录成功', icon: 'success' })

      setTimeout(() => {
        uni.switchTab({
          url: '/pages/index/index',
          success: () => {
            console.log('成功跳转到 TabBar 学习页')
          }
        })
      }, 1000)
    } else {
      uni.showToast({ title: res.message || '登录失败', icon: 'none' })
    }
  } catch (error) {
    console.error('Login error:', error)
    uni.showToast({ title: '网络异常，请重试', icon: 'none' })
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
@keyframes fadeInDown {
  from { opacity: 0; transform: translateY(-20px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in-down {
  animation: fadeInDown 0.6s ease-out forwards;
}
</style>
