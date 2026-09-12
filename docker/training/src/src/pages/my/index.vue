<template>
  <view class="min-h-screen bg-gray-50">

    <!-- ============================================================ -->
    <!-- ① 顶部 Header -->
    <!-- ============================================================ -->
    <view class="header">
      <!-- 左侧：头衔 -->
      <text class="header__title">{{ mockUser.title }}</text>
      <!-- 右侧：消息通知 Icon + 小头像 -->
      <view class="header__right">
        <uni-icons type="bell" size="22" class="header__notice" />
        <image class="header__avatar" :src="mockUser.avatar_url" mode="aspectFill" />
      </view>
    </view>


    <!-- ============================================================ -->
    <!-- ② 个人信息卡片 -->
    <!-- ============================================================ -->
    <view class="profile-card">
      <view class="profile-card__main">
        <!-- 大头像 -->
        <image
          class="profile-card__avatar"
          :src="mockUser.avatar_url"
          mode="aspectFill"
        />
        <view class="profile-card__info">
          <!-- 姓名 -->
          <text class="profile-card__name">{{ mockUser.name }}</text>
          <!-- PRO 徽章 + 职位 -->
          <view class="profile-card__tags">
            <text class="tag tag--pro">PRO</text>
            <text class="tag tag--role">{{ mockUser.role }}</text>
          </view>
        </view>
      </view>
    </view>


    <!-- ============================================================ -->
    <!-- ③ 学习数据模块 -->
    <!-- ============================================================ -->
    <view class="learning-data">

      <!-- 左侧：累计时长 + 环比增长 -->
      <view class="learning-data__left">
        <view class="stat-block">
          <text class="stat-block__value">{{ mockLearningStats.totalHours }}</text>
          <text class="stat-block__unit">小时</text>
          <text class="stat-block__label">累计学习时长</text>
          <!-- 环比增长态势 -->
          <view class="stat-block__trend">
            <text class="trend trend--up">↑ {{ mockLearningStats.growthRate }}%</text>
            <text class="trend__label">较上月</text>
          </view>
        </view>
      </view>

      <!-- 右侧：深色卡片 - 已修课程数量 + 进度条 -->
      <view class="learning-data__right">
        <view class="course-count-card">
          <text class="course-count-card__value">{{ mockLearningStats.completedCourses }}</text>
          <text class="course-count-card__label">已修课程</text>
          <!-- 进度条 -->
          <view class="progress-bar">
            <view
              class="progress-bar__fill"
              :style="{ width: mockLearningStats.completionRate + '%' }"
            />
          </view>
          <text class="course-count-card__sub">{{ mockLearningStats.completionRate }}% 完成率</text>
        </view>
      </view>
    </view>


    <!-- ============================================================ -->
    <!-- ④ 当前等级卡片 -->
    <!-- ============================================================ -->
    <view class="level-card">
      <view class="level-card__header">
        <text class="level-card__name">{{ mockLevel.name }}</text>
        <view class="level-card__badge">
          <uni-icons type="star" size="14" color="#fff" />
          <text class="level-card__badge-text">Lv.{{ mockLevel.level }}</text>
        </view>
      </view>
      <!-- 距离下一等级所需时长 -->
      <view class="level-card__progress">
        <text class="level-card__progress-label">距离下一等级</text>
        <text class="level-card__progress-value">{{ mockLevel.minutesToNextLevel }} 小时</text>
      </view>
      <!-- 等级进度条 -->
      <view class="level-progress-bar">
        <view
          class="level-progress-bar__fill"
          :style="{ width: mockLevel.progressPercent + '%' }"
        />
      </view>
      <text class="level-card__hint">还需 {{ mockLevel.hoursNeeded }} 小时达到 {{ mockLevel.nextLevelName }}</text>
    </view>


    <!-- ============================================================ -->
    <!-- ⑤ 最近在看（横向滚动区域） -->
    <!-- ============================================================ -->
    <view class="recent-section">
      <view class="section-header">
        <text class="section-title">最近在看</text>
        <text class="section-more">查看全部 ›</text>
      </view>

      <scroll-view
        class="recent-scroll"
        scroll-x
        enable-flex
      >
        <view
          v-for="course in mockRecentCourses"
          :key="course.id"
          class="course-card"
        >
          <!-- 视频封面图 -->
          <image
            class="course-card__cover"
            :src="course.cover_image"
            mode="aspectFill"
          />
          <!-- 课程标题 -->
          <text class="course-card__title" number-of-lines="2">{{ course.title }}</text>
          <!-- 学习进度百分比条 -->
          <view class="course-card__progress">
            <view class="course-card__progress-bar">
              <view
                class="course-card__progress-fill"
                :style="{ width: course.progress_percentage + '%' }"
              />
            </view>
            <text class="course-card__percent">{{ course.progress_percentage }}%</text>
          </view>
        </view>
      </scroll-view>
    </view>


    <!-- ============================================================ -->
    <!-- ⑥ 功能列表组 -->
    <!-- ============================================================ -->
    <view class="feature-list">
      <!-- 我的荣誉勋章 -->
      <view class="feature-item" @tap="onTapHonors">
        <view class="feature-item__left">
          <uni-icons type="medal" size="20" class="feature-item__icon" />
          <text class="feature-item__label">我的荣誉勋章</text>
        </view>
        <view class="feature-item__right">
          <text class="feature-item__badge">{{ mockHonors.length }}</text>
          <uni-icons type="right" size="16" />
        </view>
      </view>

      <!-- 偏好设置 -->
      <view class="feature-item" @tap="onTapSettings">
        <view class="feature-item__left">
          <uni-icons type="settings" size="20" class="feature-item__icon" />
          <text class="feature-item__label">偏好设置</text>
        </view>
        <uni-icons type="right" size="16" />
      </view>
    </view>

  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

// ============================================================
// TypeScript 类型定义
// ============================================================

interface User {
  id: string
  name: string
  avatar_url: string
  role: string
  title: string
  level: number
  level_name: string
  total_learning_minutes: number
}

interface RecentCourse {
  id: string
  title: string
  cover_image: string
  progress_percentage: number
  last_watched_at: string
}

interface LearningStats {
  totalHours: number
  completedCourses: number
  completionRate: number
  growthRate: number
}

interface LevelInfo {
  level: number
  name: string
  nextLevelName: string
  hoursNeeded: number
  minutesToNextLevel: number
  progressPercent: number
}

interface Honor {
  id: string
  name: string
  icon_url: string
}

// ============================================================
// Mock 数据
// ============================================================

const mockUser = ref<User>({
  id: 'u_001',
  name: '陈墨然',
  avatar_url: 'https://picsum.photos/200/200?random=avatar',
  role: '高级学员·策展研究员',
  title: '智库策展人',
  level: 2,
  level_name: '进阶阶段',
  total_learning_minutes: 7680, // 128 小时
})

const mockLearningStats = ref<LearningStats>({
  totalHours: 128,
  completedCourses: 24,
  completionRate: 76,
  growthRate: 12.5,
})

const mockLevel = ref<LevelInfo>({
  level: 2,
  name: '进阶阶段',
  nextLevelName: '高阶阶段',
  hoursNeeded: 72,
  minutesToNextLevel: 4320,
  progressPercent: 64,
})

const mockRecentCourses = ref<RecentCourse[]>([
  {
    id: 'c_001',
    title: '数字化展陈与沉浸式体验设计',
    cover_image: 'https://picsum.photos/280/160?random=cover1',
    progress_percentage: 85,
    last_watched_at: '2026-04-10T10:30:00Z',
  },
  {
    id: 'c_002',
    title: '文化遗产数字化保护技术',
    cover_image: 'https://picsum.photos/280/160?random=cover2',
    progress_percentage: 62,
    last_watched_at: '2026-04-09T16:45:00Z',
  },
  {
    id: 'c_003',
    title: '策展叙事：讲故事的艺术',
    cover_image: 'https://picsum.photos/280/160?random=cover3',
    progress_percentage: 38,
    last_watched_at: '2026-04-08T20:00:00Z',
  },
  {
    id: 'c_004',
    title: '观众行为分析与展馆运营',
    cover_image: 'https://picsum.photos/280/160?random=cover4',
    progress_percentage: 15,
    last_watched_at: '2026-04-07T14:20:00Z',
  },
  {
    id: 'c_005',
    title: '当代艺术与策展边界探索',
    cover_image: 'https://picsum.photos/280/160?random=cover5',
    progress_percentage: 5,
    last_watched_at: '2026-04-06T09:10:00Z',
  },
])

const mockHonors = ref<Honor[]>([
  { id: 'h_001', name: '初阶达成', icon_url: '' },
  { id: 'h_002', name: '连续学习7天', icon_url: '' },
  { id: 'h_003', name: '完成首门课程', icon_url: '' },
])

// ============================================================
// 方法
// ============================================================

function onTapHonors() {
  console.log('Navigate to honors page')
}

function onTapSettings() {
  console.log('Navigate to settings page')
}
</script>

<style scoped>
/* 布局相关实用类由 Tailwind CSS 提供，此处仅作基础占位 */
/* 页面级容器 */
.min-h-screen { min-height: 100vh; }
.bg-gray-50 { background-color: #f9fafb; }

/* Header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 32rpx;
  background: #fff;
}
.header__title { font-size: 32rpx; font-weight: 600; color: #1a1a1a; }
.header__right { display: flex; align-items: center; gap: 24rpx; }
.header__notice { color: #666; }
.header__avatar { width: 64rpx; height: 64rpx; border-radius: 50%; }

/* 个人信息卡片 */
.profile-card {
  margin: 24rpx 32rpx;
  padding: 32rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 24rpx;
  color: #fff;
}
.profile-card__main { display: flex; align-items: center; gap: 24rpx; }
.profile-card__avatar { width: 120rpx; height: 120rpx; border-radius: 60rpx; border: 4rpx solid #fff; }
.profile-card__info { flex: 1; }
.profile-card__name { font-size: 40rpx; font-weight: 700; display: block; margin-bottom: 12rpx; }
.profile-card__tags { display: flex; align-items: center; gap: 12rpx; flex-wrap: wrap; }

/* 标签 */
.tag { padding: 6rpx 16rpx; border-radius: 8rpx; font-size: 22rpx; }
.tag--pro { background: #ffd700; color: #333; font-weight: 700; }
.tag--role { background: rgba(255,255,255,0.25); color: #fff; }

/* 学习数据 */
.learning-data {
  display: flex;
  gap: 24rpx;
  padding: 0 32rpx;
  margin-bottom: 24rpx;
}
.learning-data__left,
.learning-data__right { flex: 1; }

.stat-block {
  background: #fff;
  border-radius: 20rpx;
  padding: 28rpx;
  box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.06);
}
.stat-block__value { font-size: 56rpx; font-weight: 800; color: #1a1a1a; }
.stat-block__unit { font-size: 24rpx; color: #666; margin-left: 4rpx; }
.stat-block__label { display: block; font-size: 24rpx; color: #999; margin-top: 4rpx; }
.stat-block__trend { display: flex; align-items: center; gap: 8rpx; margin-top: 16rpx; }
.trend { font-size: 24rpx; font-weight: 600; }
.trend--up { color: #34d399; }
.trend__label { font-size: 22rpx; color: #999; }

.course-count-card {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 20rpx;
  padding: 28rpx;
  color: #fff;
}
.course-count-card__value { font-size: 56rpx; font-weight: 800; }
.course-count-card__label { display: block; font-size: 24rpx; color: rgba(255,255,255,0.7); margin-top: 4rpx; }

.progress-bar { height: 8rpx; background: rgba(255,255,255,0.2); border-radius: 4rpx; margin-top: 20rpx; }
.progress-bar__fill { height: 100%; background: #34d399; border-radius: 4rpx; transition: width 0.3s; }

.course-count-card__sub { font-size: 22rpx; color: rgba(255,255,255,0.6); margin-top: 12rpx; display: block; }

/* 等级卡片 */
.level-card {
  margin: 0 32rpx 24rpx;
  padding: 28rpx;
  background: #fff;
  border-radius: 20rpx;
  box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.06);
}
.level-card__header { display: flex; align-items: center; justify-content: space-between; }
.level-card__name { font-size: 32rpx; font-weight: 700; color: #1a1a1a; }
.level-card__badge { display: flex; align-items: center; gap: 6rpx; background: #667eea; padding: 6rpx 16rpx; border-radius: 20rpx; }
.level-card__badge-text { font-size: 22rpx; color: #fff; font-weight: 600; }

.level-card__progress { display: flex; align-items: center; justify-content: space-between; margin-top: 20rpx; }
.level-card__progress-label { font-size: 24rpx; color: #999; }
.level-card__progress-value { font-size: 28rpx; color: #667eea; font-weight: 700; }

.level-progress-bar { height: 10rpx; background: #f0f0f0; border-radius: 5rpx; margin-top: 16rpx; }
.level-progress-bar__fill { height: 100%; background: linear-gradient(90deg, #667eea, #764ba2); border-radius: 5rpx; transition: width 0.3s; }

.level-card__hint { display: block; font-size: 22rpx; color: #999; margin-top: 12rpx; }

/* 最近在看 */
.recent-section { padding: 0 32rpx; margin-bottom: 24rpx; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20rpx; }
.section-title { font-size: 32rpx; font-weight: 700; color: #1a1a1a; }
.section-more { font-size: 24rpx; color: #999; }

.recent-scroll { white-space: nowrap; }

.course-card {
  display: inline-block;
  width: 260rpx;
  margin-right: 20rpx;
  vertical-align: top;
}
.course-card__cover { width: 260rpx; height: 146rpx; border-radius: 16rpx; background: #eee; }
.course-card__title { display: block; font-size: 26rpx; color: #1a1a1a; margin-top: 12rpx; line-height: 1.4; height: 72rpx; overflow: hidden; }
.course-card__progress { display: flex; align-items: center; gap: 10rpx; margin-top: 10rpx; }
.course-card__progress-bar { flex: 1; height: 6rpx; background: #eee; border-radius: 3rpx; }
.course-card__progress-fill { height: 100%; background: #667eea; border-radius: 3rpx; transition: width 0.3s; }
.course-card__percent { font-size: 20rpx; color: #667eea; font-weight: 600; flex-shrink: 0; }

/* 功能列表 */
.feature-list {
  margin: 0 32rpx;
  background: #fff;
  border-radius: 20rpx;
  overflow: hidden;
  box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.06);
}
.feature-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 32rpx 28rpx;
  border-bottom: 1rpx solid #f0f0f0;
}
.feature-item:last-child { border-bottom: none; }
.feature-item__left { display: flex; align-items: center; gap: 16rpx; }
.feature-item__icon { color: #667eea; }
.feature-item__label { font-size: 28rpx; color: #1a1a1a; }
.feature-item__right { display: flex; align-items: center; gap: 12rpx; }
.feature-item__badge {
  background: #667eea;
  color: #fff;
  font-size: 20rpx;
  padding: 4rpx 12rpx;
  border-radius: 12rpx;
}
</style>
