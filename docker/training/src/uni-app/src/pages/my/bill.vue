<template>
  <view class="bill-container">
    <view class="custom-nav-header" @click="goBack">
      <text class="back-icon">←</text>
      <text class="back-text">返回</text>
    </view>
    <view class="summary-card">
      <view class="data-item">
        <text class="label">累计专注学时</text>
        <view class="val-wrap"><text class="val">{{ totalHours }}</text><text class="unit">h</text></view>
      </view>
      <view class="divider"></view>
      <view class="data-item">
        <text class="label">已完成课程</text>
        <view class="val-wrap"><text class="val">{{ completedCount }}</text><text class="unit">门</text></view>
      </view>
    </view>

    <view class="timeline-box">
      <view class="section-title">学习足迹</view>
      <view class="timeline">
        <view class="timeline-item" v-for="(item, index) in historyList" :key="index">
          <view class="dot"></view>
          <view class="content">
            <text class="date">{{ item.date }}</text>
            <text class="action">{{ item.action }}</text>
            <text class="target">《{{ item.courseName }}》</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { get } from '@/utils/request';

const totalHours = ref(0);
const completedCount = ref(0);
const historyList = ref([]);

const goBack = () => {
  uni.navigateBack({ delta: 1 });
};

onLoad(async () => {
  try {
    uni.showLoading({ title: '生成账单中' });
    const res = await get('/user/bill');
    totalHours.value = res.data.totalHours;
    completedCount.value = res.data.completedCount;
    historyList.value = res.data.history;
  } catch (e) {
    console.error('获取账单失败', e);
  } finally {
    uni.hideLoading();
  }
});
</script>

<style scoped>
.bill-container { min-height: 100vh; background-color: #f4f6f9; }
.custom-nav-header { padding-top: 100rpx; padding-left: 30rpx; padding-bottom: 20rpx; display: flex; align-items: center; z-index: 999; }
.back-icon { font-size: 36rpx; color: #64748b; font-weight: bold; margin-right: 8rpx; }
.back-text { font-size: 30rpx; color: #64748b; }
.summary-card { background: linear-gradient(135deg, #1e3a8a, #0891b2); border-radius: 24rpx; padding: 50rpx 0; display: flex; align-items: center; box-shadow: 0 10rpx 30rpx rgba(8, 145, 178, 0.2); margin-bottom: 50rpx; }
.data-item { flex: 1; text-align: center; color: #fff; }
.divider { width: 2rpx; height: 80rpx; background: rgba(255,255,255,0.2); }
.label { font-size: 26rpx; opacity: 0.8; display: block; margin-bottom: 10rpx; }
.val { font-size: 64rpx; font-weight: bold; font-family: DINAlternate-Bold, sans-serif; }
.unit { font-size: 28rpx; margin-left: 8rpx; opacity: 0.9; }
.timeline-box { background: #fff; border-radius: 24rpx; padding: 40rpx; box-shadow: 0 4rpx 20rpx rgba(0,0,0,0.02); }
.section-title { font-size: 32rpx; font-weight: bold; color: #1e293b; margin-bottom: 40rpx; }
.timeline { border-left: 4rpx solid #e2e8f0; margin-left: 20rpx; padding-bottom: 20rpx; }
.timeline-item { position: relative; margin-bottom: 50rpx; padding-left: 40rpx; }
.timeline-item:last-child { margin-bottom: 0; }
.dot { width: 24rpx; height: 24rpx; background: #0ea5e9; border-radius: 50%; position: absolute; left: -14rpx; top: 6rpx; border: 6rpx solid #e0f2fe; }
.date { font-size: 24rpx; color: #94a3b8; display: block; margin-bottom: 8rpx; }
.action { font-size: 28rpx; color: #475569; display: block; margin-bottom: 4rpx; }
.target { font-size: 30rpx; color: #0f172a; font-weight: 500; display: block; }
</style>
