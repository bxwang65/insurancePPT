<template>
  <view class="dashboard-container">
    <view class="header-card">
      <text class="title">当前学习阶段</text>
      <text class="stage-name">{{ currentStage }}</text>
      <view class="progress-wrap">
        <view class="progress-info">
          <text>总完成度</text>
          <text class="percent">{{ totalProgress }}%</text>
        </view>
        <progress :percent="totalProgress" stroke-width="8" activeColor="#06b6d4" backgroundColor="rgba(255,255,255,0.2)" border-radius="4" active />
      </view>
    </view>

    <view class="section-title">课程明细</view>
    <view class="course-list">
      <view class="course-item" v-for="(item, index) in courseList" :key="index">
        <view class="course-info">
          <text class="course-name">{{ item.name }}</text>
          <text class="course-type" :class="item.type === 'video' ? 'tag-video' : 'tag-pdf'">
            {{ item.type === 'video' ? '视频' : '文档' }}
          </text>
        </view>
        <view class="course-status">
          <text :class="item.progress === 100 ? 'status-done' : 'status-doing'">
            {{ item.progress === 100 ? '已完成' : `进度 ${item.progress}%` }}
          </text>
        </view>
      </view>
    </view>

    <view class="unlock-section">
      <button
        class="btn-unlock"
        :class="{ 'btn-disabled': totalProgress < 80 }"
        @click="handleUnlock"
      >
        <text v-if="totalProgress >= 80">🔓 进入衔接训</text>
        <text v-else>🔒 需总进度达80%解锁衔接训</text>
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { get } from '@/utils/request';

const currentStage = ref('基础阶段');
const courseList = ref<any[]>([]);

const totalProgress = computed(() => {
  if (courseList.value.length === 0) return 0;
  const sum = courseList.value.reduce((acc, curr) => acc + curr.progress, 0);
  return Math.floor(sum / courseList.value.length);
});

const fetchProgress = async () => {
  try {
    uni.showLoading({ title: '加载中' });
    const res = await get('/user/progress');
    courseList.value = res.data.courses;
    currentStage.value = res.data.stage;
  } catch (error) {
    courseList.value = [
      { name: '高净值客户洞察', type: 'video', progress: 100 },
      { name: '香港重疾险对比', type: 'video', progress: 60 },
      { name: '家族信托架构指南', type: 'pdf', progress: 100 },
      { name: 'CRS税务筹划', type: 'video', progress: 0 }
    ];
  } finally {
    uni.hideLoading();
  }
};

// 保证每次切回 tab 都能刷新最新进度
onShow(() => {
  fetchProgress();
});

const handleUnlock = () => {
  if (totalProgress.value >= 80) {
    uni.showToast({ title: '衔接训已解锁！', icon: 'success' });
  } else {
    uni.showToast({ title: '请先完成80%的课程', icon: 'none' });
  }
};
</script>

<style scoped>
.dashboard-container { padding-top: calc(env(safe-area-inset-top) + 140rpx); padding-left: 30rpx; padding-right: 30rpx; padding-bottom: 30rpx; min-height: 100vh; background-color: #f4f6f9; box-sizing: border-box; }
.header-card { background: linear-gradient(135deg, #1e3a8a, #0891b2); border-radius: 20rpx; padding: 40rpx; color: #fff; margin-bottom: 40rpx; box-shadow: 0 10rpx 30rpx rgba(8, 145, 178, 0.2); }
.title { font-size: 28rpx; opacity: 0.8; }
.stage-name { display: block; font-size: 48rpx; font-weight: bold; margin-top: 10rpx; margin-bottom: 30rpx; }
.progress-wrap { margin-top: 20rpx; }
.progress-info { display: flex; justify-content: space-between; font-size: 24rpx; margin-bottom: 10rpx; }
.percent { font-weight: bold; color: #67e8f9; }
.section-title { font-size: 32rpx; font-weight: bold; color: #333; margin-bottom: 20rpx; }
.course-list { background: #fff; border-radius: 16rpx; padding: 10rpx 30rpx; box-shadow: 0 4rpx 12rpx rgba(0,0,0,0.05); }
.course-item { display: flex; justify-content: space-between; align-items: center; padding: 30rpx 0; border-bottom: 2rpx solid #f0f0f0; }
.course-item:last-child { border-bottom: none; }
.course-name { font-size: 28rpx; color: #333; font-weight: 500;}
.course-type { font-size: 20rpx; padding: 4rpx 12rpx; border-radius: 8rpx; margin-left: 16rpx; }
.tag-video { background-color: #e0f2fe; color: #0284c7; }
.tag-pdf { background-color: #f1f5f9; color: #475569; }
.status-done { color: #10b981; font-size: 26rpx; font-weight: bold; }
.status-doing { color: #f59e0b; font-size: 26rpx; }
.unlock-section { margin-top: 60rpx; }
.btn-unlock { background: linear-gradient(90deg, #2563eb, #06b6d4); color: white; border-radius: 50rpx; font-weight: bold; box-shadow: 0 8rpx 20rpx rgba(37, 99, 235, 0.3); }
.btn-disabled { background: #cbd5e1; box-shadow: none; color: #64748b; }
</style>
