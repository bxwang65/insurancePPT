<template>
  <view class="my-container">
    <view class="user-card">
      <view class="avatar">{{ userInfo.name?.charAt(0) || '学' }}</view>
      <view class="info">
        <text class="name">您好，{{ userInfo.name || '学员' }}</text>
        <text class="stage">{{ stats.stage || '初阶阶段' }}</text>
      </view>
    </view>

    <view class="stats-row">
      <view class="stat-box">
        <view class="icon-bg">⏳</view>
        <text class="val">{{ stats.totalStudyHours || 0 }} <text class="unit">小时</text></text>
        <text class="label">累计专注学时</text>
      </view>
      <view class="stat-box blue-box">
        <view class="icon-bg">📖</view>
        <text class="val" style="color:white">{{ stats.completedCoursesCount || 0 }} <text class="unit" style="color:white">门</text></text>
        <text class="label" style="color:white">已完成课程</text>
      </view>
    </view>

    <view class="menu-list">
      <view class="menu-item" @click="navTo('/pages/my/medals')">
        <text class="menu-icon">🏆</text>
        <text class="menu-text">我的荣誉勋章</text>
        <text class="arrow">›</text>
      </view>
      <view class="menu-item" @click="navTo('/pages/my/bill')">
        <text class="menu-icon">📋</text>
        <text class="menu-text">学习账单</text>
        <text class="arrow">›</text>
      </view>
      <view class="menu-item" @click="navTo('/pages/my/password')">
        <text class="menu-icon">🔐</text>
        <text class="menu-text">修改密码</text>
        <text class="arrow">›</text>
      </view>
      <view class="menu-item" @click="navTo('/pages/calculator/index')">
        <text class="menu-icon">🧮</text>
        <text class="menu-text">保险算费工具</text>
        <text class="arrow">›</text>
      </view>

      <view class="menu-item logout" @click="handleLogout">
        <text class="menu-icon">🚪</text>
        <text class="menu-text" style="color: #ef4444;">退出登录</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { get } from '@/utils/request';

const userInfo = ref({ name: '学员' });
const stats = ref({ totalStudyHours: 0, completedCoursesCount: 0, stage: '初阶阶段' });

const loadData = async () => {
  const userId = uni.getStorageSync('userId') || 'u_001';
  try {
    const res: any = await get(`/admin/stats/student/${userId}`);
    if (res?.data) {
      stats.value = res.data;
      userInfo.value.name = res.data.name || res.data.userId || '学员';
    }
  } catch (e) {
    console.error('获取我的数据失败', e);
  }
};

onShow(() => {
  loadData();
});

const navTo = (url: string) => {
  uni.navigateTo({ url });
};

const handleLogout = () => {
  uni.showModal({
    title: '提示',
    content: '确定要退出登录吗？',
    success: function (res) {
      if (res.confirm) {
        uni.removeStorageSync('token');
        uni.removeStorageSync('userId');
        uni.reLaunch({ url: '/pages/login/index' });
      }
    }
  });
};
</script>

<style scoped>
.my-container { padding: 180rpx 30rpx 30rpx; min-height: 100vh; background-color: #f8fafc; box-sizing: border-box; }
.user-card { display: flex; align-items: center; background: #0f172a; border-radius: 24rpx; padding: 40rpx; margin-bottom: 40rpx; color: #fff;}
.avatar { width: 100rpx; height: 100rpx; background: #3b82f6; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 40rpx; font-weight: bold; margin-right: 30rpx; }
.name { font-size: 36rpx; font-weight: bold; display: block; margin-bottom: 10rpx; }
.stage { font-size: 22rpx; background: rgba(255,255,255,0.2); padding: 4rpx 16rpx; border-radius: 20rpx; }
.stats-row { display: flex; gap: 20rpx; margin-bottom: 40rpx; }
.stat-box { flex: 1; background: #fff; padding: 40rpx 30rpx; border-radius: 24rpx; position: relative; overflow: hidden; box-shadow: 0 4rpx 12rpx rgba(0,0,0,0.03);}
.blue-box { background: #2563eb; }
.val { font-size: 50rpx; font-weight: bold; color: #0f172a; display: block; margin-bottom: 6rpx; font-family: DINAlternate-Bold, sans-serif;}
.unit { font-size: 24rpx; font-weight: normal; color: #64748b; margin-left: 4rpx;}
.label { font-size: 24rpx; color: #64748b; }
.icon-bg { position: absolute; right: 20rpx; top: 20rpx; font-size: 60rpx; opacity: 0.1; }
.menu-list { background: #fff; border-radius: 24rpx; padding: 10rpx 30rpx; box-shadow: 0 4rpx 12rpx rgba(0,0,0,0.02);}
.menu-item { display: flex; align-items: center; padding: 36rpx 0; border-bottom: 2rpx solid #f1f5f9; }
.menu-item:last-child { border-bottom: none; }
.menu-icon { font-size: 40rpx; margin-right: 20rpx; }
.menu-text { flex: 1; font-size: 30rpx; color: #334155; }
.arrow { color: #cbd5e1; font-family: sans-serif; }
.logout { margin-top: 20rpx; }
</style>
