<template>
  <view class="pwd-container">
    <view class="custom-nav-header" @click="goBack">
      <text class="back-icon">←</text>
      <text class="back-text">返回</text>
    </view>
    <view class="header">
      <text class="title">安全设置</text>
      <text class="subtitle">请设置包含字母和数字的新密码</text>
    </view>

    <view class="form-card">
      <view class="input-group">
        <text class="label">当前密码</text>
        <input class="input" password placeholder="请输入原密码" v-model="form.old" placeholder-class="ph" />
      </view>
      <view class="input-group">
        <text class="label">新密码</text>
        <input class="input" password placeholder="请输入不少于6位的新密码" v-model="form.newPwd" placeholder-class="ph" />
      </view>
      <view class="input-group">
        <text class="label">确认密码</text>
        <input class="input" password placeholder="请再次输入新密码" v-model="form.confirm" placeholder-class="ph" />
      </view>
    </view>

    <button class="btn-submit" :class="{'disabled': !canSubmit}" @click="submit">确认修改并重新登录</button>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { post } from '@/utils/request';

const form = ref({ old: '', newPwd: '', confirm: '' });

const goBack = () => {
  uni.navigateBack({ delta: 1 });
};
const canSubmit = computed(() => form.value.old && form.value.newPwd.length >= 6 && form.value.confirm);

const submit = async () => {
  if (!canSubmit.value) return;
  if (form.value.newPwd !== form.value.confirm) {
    return uni.showToast({ title: '两次新密码不一致', icon: 'none' });
  }
  try {
    uni.showLoading({ title: '处理中' });
    await post('/user/update-password', { oldPassword: form.value.old, newPassword: form.value.newPwd });
    uni.hideLoading();
    uni.showToast({ title: '修改成功', icon: 'success' });

    setTimeout(() => {
      uni.removeStorageSync('token');
      uni.removeStorageSync('userId');
      uni.reLaunch({ url: '/pages/login/index' });
    }, 1500);
  } catch (e) {
    uni.hideLoading();
  }
};
</script>

<style scoped>
.pwd-container { min-height: 100vh; background-color: #f4f6f9; }
.custom-nav-header { padding-top: 100rpx; padding-left: 30rpx; padding-bottom: 20rpx; display: flex; align-items: center; z-index: 999; }
.back-icon { font-size: 36rpx; color: #64748b; font-weight: bold; margin-right: 8rpx; }
.back-text { font-size: 30rpx; color: #64748b; }
.header { margin-bottom: 60rpx; }
.title { font-size: 44rpx; font-weight: bold; color: #1e293b; display: block; margin-bottom: 12rpx;}
.subtitle { font-size: 26rpx; color: #64748b; }
.form-card { background: #fff; border-radius: 24rpx; padding: 10rpx 40rpx; box-shadow: 0 4rpx 20rpx rgba(0,0,0,0.02); margin-bottom: 80rpx; }
.input-group { border-bottom: 2rpx solid #f1f5f9; padding: 30rpx 0; }
.input-group:last-child { border-bottom: none; }
.label { font-size: 28rpx; color: #334155; font-weight: 500; display: block; margin-bottom: 20rpx; }
.input { font-size: 30rpx; color: #0f172a; }
.ph { color: #cbd5e1; font-size: 28rpx; }
.btn-submit { background: linear-gradient(90deg, #0ea5e9, #2563eb); color: #fff; border-radius: 50rpx; font-size: 32rpx; font-weight: bold; box-shadow: 0 10rpx 20rpx rgba(37, 99, 235, 0.2); }
.btn-submit::after { border: none; }
.btn-submit.disabled { opacity: 0.5; background: #94a3b8; box-shadow: none; }
</style>
