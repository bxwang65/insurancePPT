<template>
  <view class="medals-container">
    <view class="custom-nav-header" @click="goBack">
      <text class="back-icon">←</text>
      <text class="back-text">返回</text>
    </view>
    <view class="header-card">
      <text class="title">我的荣誉</text>
      <text class="subtitle">点亮勋章，见证每一次成长</text>
    </view>

    <view class="medal-grid">
      <view class="medal-card" v-for="(medal, index) in medals" :key="index" :class="{'locked': !medal.unlocked}">
        <view class="icon-wrap">
          <text class="icon">{{ medal.icon }}</text>
          <view v-if="!medal.unlocked" class="lock-mask">🔒</view>
        </view>
        <text class="name">{{ medal.name }}</text>
        <text class="desc">{{ medal.desc }}</text>
        <text class="time" v-if="medal.unlocked">{{ medal.unlockTime }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { get } from '@/utils/request';

const medals = ref([]);

const goBack = () => {
  uni.navigateBack({ delta: 1 });
};

onLoad(async () => {
  try {
    uni.showLoading({ title: '加载中' });
    const res = await get('/user/medals');
    medals.value = res.data;
  } catch (e) {
    console.error('获取勋章失败', e);
  } finally {
    uni.hideLoading();
  }
});
</script>

<style scoped>
.medals-container { min-height: 100vh; background-color: #f4f6f9; }
.custom-nav-header { padding-top: 100rpx; padding-left: 30rpx; padding-bottom: 20rpx; display: flex; align-items: center; z-index: 999; }
.back-icon { font-size: 36rpx; color: #64748b; font-weight: bold; margin-right: 8rpx; }
.back-text { font-size: 30rpx; color: #64748b; }
.header-card { margin-bottom: 40rpx; padding: 20rpx 10rpx; }
.title { font-size: 44rpx; font-weight: bold; color: #0f172a; display: block; }
.subtitle { font-size: 26rpx; color: #64748b; margin-top: 10rpx; }
.medal-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 30rpx; }
.medal-card { background: #fff; padding: 40rpx 20rpx; border-radius: 24rpx; text-align: center; box-shadow: 0 4rpx 20rpx rgba(0,0,0,0.03); transition: all 0.3s; position: relative; }
.medal-card.locked { opacity: 0.6; background: #f8fafc; }
.icon-wrap { position: relative; width: 120rpx; height: 120rpx; margin: 0 auto 20rpx; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #e0f2fe, #bae6fd); border-radius: 50%; }
.icon { font-size: 60rpx; }
.lock-mask { position: absolute; inset: 0; background: rgba(255,255,255,0.7); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 40rpx; }
.name { font-size: 30rpx; font-weight: bold; color: #1e293b; display: block; margin-bottom: 8rpx; }
.desc { font-size: 22rpx; color: #64748b; display: block; line-height: 1.4; }
.time { font-size: 20rpx; color: #0ea5e9; display: block; margin-top: 16rpx; }
</style>
