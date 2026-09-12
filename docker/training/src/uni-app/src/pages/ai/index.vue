<template>
  <view class="container">
    <web-view v-if="webviewUrl" :src="webviewUrl"></web-view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';

const webviewUrl = ref('');

onLoad(() => {
  const userId = uni.getStorageSync('userId') || 'guest';

  // 🚨 核心：使用 Railway 纯净域名，彻底避开 Cloudflare 和本地 DNS 拦截
  // 附带静默登录暗号，保证瞬间穿越
  webviewUrl.value = `https://songshi-frontend-prod-production.up.railway.app/?mp_auth=true&uid=${userId}&t=${Date.now()}`;

  console.log('WebView 目标地址已装载:', webviewUrl.value);
});
</script>

<style scoped>
.container {
  width: 100vw;
  height: 100vh;
}
</style>
