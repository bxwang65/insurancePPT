<template>
  <view class="calc-wrap">
    <!-- #ifdef H5 -->
    <iframe
      ref="iframeRef"
      :src="calcSrc"
      class="calc-iframe"
      frameborder="0"
      allow="clipboard-read; clipboard-write"
    ></iframe>
    <!-- #endif -->
    <!-- #ifdef MP-WEIXIN -->
    <web-view :src="calcSrc"></web-view>
    <!-- #endif -->
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

const iframeRef = ref<any>(null)

// In H5 mode, the iframe loads calculator/index.html relative to the app root
// In MP mode, web-view loads the same page hosted on the server
const calcSrc = computed(() => {
  // #ifdef H5
  return '/calculator/index.html'
  // #endif
  // #ifdef MP-WEIXIN
  return '/calculator/index.html'
  // #endif
})
</script>

<style scoped>
.calc-wrap {
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: #fff;
}
.calc-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
</style>
