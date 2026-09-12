<template>
  <view class="detail-container">

    <!-- 固定在顶部的返回键 -->
    <view class="custom-back-btn" @click="goBack">
      <text class="back-arrow">←</text>
      <text class="back-text">返回</text>
    </view>

    <!-- 视频播放器 -->
    <view class="video-wrapper" style="width: 100%; height: 420rpx; background: #000;">
      <video
        v-if="videoUrl"
        id="myVideo"
        class="video-player"
        :src="videoUrl"
        :poster="coverImage"
        controls
        :show-center-play-btn="true"
        :show-fullscreen-btn="true"
        :enable-progress-gesture="false"
        enable-play-gesture
        show-playback-rate-btn
        @play="onPlay"
        @pause="onPause"
        @timeupdate="onTimeUpdate"
        @ended="onEnded"
        @error="onVideoError"
      ></video>
      <view v-else class="video-placeholder">
        <text class="placeholder-icon">📹</text>
        <text class="placeholder-text">暂无视频</text>
      </view>
    </view>

    <!-- 课程信息 -->
    <view class="course-header">
      <text class="course-title">{{ courseTitle }}</text>
      <view class="course-meta">
        <view class="meta-item">
          <text class="meta-icon">⏱</text>
          <text class="meta-text">已学习 {{ watchedSeconds }} 秒</text>
        </view>
        <view class="meta-item">
          <text class="meta-icon">📊</text>
          <text class="meta-text">进度 {{ progressPercentage }}%</text>
        </view>
      </view>
      <!-- 进度条 -->
      <view class="progress-bar-wrap">
        <view class="progress-bar" :style="{ width: progressPercentage + '%' }"></view>
      </view>
    </view>

    <!-- 课件列表 -->
    <view class="materials-section">
      <text class="section-title">课件资料</text>
      <view v-if="materials.length > 0" class="material-list">
        <view
          v-for="material in materials"
          :key="material.id"
          class="material-item"
          @click="downloadMaterial(material)"
        >
          <view class="material-icon">
            <text>{{ getFileTypeIcon(material.file_type) }}</text>
          </view>
          <view class="material-info">
            <text class="material-name">{{ material.title }}</text>
            <text class="material-size">{{ formatFileSize(material.file_size) }}</text>
          </view>
          <view class="download-btn">
            <text class="download-icon">↓</text>
          </view>
        </view>
      </view>
      <view v-else class="empty-materials">
        <text>暂无课件</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { get, post, getBaseUrl } from '@/utils/request'
import { resolveMediaUrl } from '@/utils/oss-url'

// ============ 类型定义 ============
interface Material {
  id: string
  title: string
  file_type: string
  file_url: string
  file_size?: number
}

interface CourseDetail {
  id: string
  title: string
  cover_image: string
  video_url: string
  stage: string
  stage_name: string
  duration_minutes: number
  description?: string
  progress_percentage: number
  materials?: Material[]
}

// ============ 状态 ============
const courseId = ref('')
const courseTitle = ref('')
const videoUrl = ref('')
const coverImage = ref('')
const progressPercentage = ref(0)
const watchedSeconds = ref(0)
const materials = ref<Material[]>([])

// 播放进度状态
const lastPlayTime = ref(0)       // 上次记录的播放位置（秒）
const isPlaying = ref(false)
const heartbeatTimer = ref<ReturnType<typeof setInterval> | null>(null)
const MAX_JUMP_SECONDS = 15        // 允许最大快进秒数

// 防作弊：记录已同步的最远进度
const maxSyncedSeconds = ref(0)

// ============ 工具函数 ============
function getFileTypeIcon(fileType: string): string {
  const iconMap: Record<string, string> = {
    pdf: '📄',
    ppt: '📊',
    pptx: '📊',
    doc: '📝',
    docx: '📝',
    xls: '📈',
    xlsx: '📈',
    mp4: '🎬',
    mp3: '🎵',
  }
  return iconMap[fileType.toLowerCase()] || '📎'
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function goBack() {
  uni.navigateBack()
}

// ============ 视频事件处理 ============
function onPlay(e: any) {
  isPlaying.value = true
  lastPlayTime.value = e.detail.currentTime
  startHeartbeat()
}

function onPause() {
  isPlaying.value = false
  stopHeartbeat()
}

function onTimeUpdate(e: any) {
  const currentTime = e.detail.currentTime
  const duration = e.detail.duration

  // 防作弊：检测快进
  if (currentTime > lastPlayTime.value + MAX_JUMP_SECONDS) {
    // 非法快进，强制跳回
    uni.showToast({ title: '请正常观看视频', icon: 'none' })
    // 这里通过 videoContext 操作会有限制，提示用户即可
    lastPlayTime.value = lastPlayTime.value + MAX_JUMP_SECONDS
  } else {
    lastPlayTime.value = currentTime
  }

  // 记录最远进度（只增不减）
  if (currentTime > maxSyncedSeconds.value) {
    maxSyncedSeconds.value = currentTime
  }

  // 更新本地进度
  if (duration > 0) {
    progressPercentage.value = Math.min(100, Math.round((currentTime / duration) * 100))
    watchedSeconds.value = Math.round(currentTime)
  }
}

function onEnded() {
  isPlaying.value = false
  stopHeartbeat()
  progressPercentage.value = 100
  syncProgress(true)
  uni.showToast({ title: '恭喜完成课程', icon: 'success' })
}

function onVideoError(e: any) {
  console.error('视频播放错误', e)
  uni.showToast({ title: '视频加载失败', icon: 'none' })
}

// ============ 心跳同步 ============
function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer.value = setInterval(() => {
    if (isPlaying.value) {
      syncProgress(false)
    }
  }, 10000) // 每10秒同步一次
}

function stopHeartbeat() {
  if (heartbeatTimer.value) {
    clearInterval(heartbeatTimer.value)
    heartbeatTimer.value = null
  }
}

async function syncProgress(isCompleted: boolean = false) {
  try {
    await post('/user/sync-progress', {
      courseId: courseId.value,
      percentage: progressPercentage.value,
    })
  } catch (e) {
    console.error('同步进度失败', e)
  }
}

// ============ 课件下载 ============
async function downloadMaterial(material: Material) {
  if (!material.file_url) {
    uni.showToast({ title: '文件地址无效', icon: 'none' })
    return
  }

  uni.showLoading({ title: '正在下载...' })

  try {
    // 2026-08-31: OSS key → /api/upload/sign, /uploads/ → base URL
    const filePath = await resolveMediaUrl(material.file_url)

    const downloadTask = uni.downloadFile({
      url: filePath,
      success: (res) => {
        uni.hideLoading()
        if (res.statusCode === 200) {
          uni.openDocument({
            filePath: res.tempFilePath,
            fileType: material.file_type.toLowerCase() as any,
            success: () => {
              console.log('打开文档成功')
            },
            fail: () => {
              uni.showToast({ title: '无法打开该文件', icon: 'none' })
            },
          })
        } else {
          uni.showToast({ title: '下载失败', icon: 'none' })
        }
      },
      fail: () => {
        uni.hideLoading()
        uni.showToast({ title: '下载失败', icon: 'none' })
      },
    })

    // 超时处理
    setTimeout(() => {
      downloadTask.abort()
    }, 30000)
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: '下载异常', icon: 'none' })
  }
}

// ============ 数据加载 ============
async function fetchCourseDetail() {
  uni.showLoading({ title: '加载中...' })

  try {
    // 使用 GET /courses/:id 获取课程详情（含课件和进度）
    const res: any = await get(`/courses/${courseId.value}`)
    const course = res?.data

    if (course) {
      courseTitle.value = course.title || ''
      coverImage.value = course.cover_image || ''

      // 处理视频 URL (2026-08-31: OSS key → /api/upload/sign 拿 1h 签名 URL)
      videoUrl.value = await resolveMediaUrl(course.video_url || '')

      // 课件列表
      if (course.materials && course.materials.length > 0) {
        materials.value = course.materials.map((m: any) => ({
          id: m.id,
          title: m.title,
          file_type: m.file_type || 'pdf',
          file_url: m.file_url || '',
          file_size: m.file_size || 0,
        }))
      } else {
        materials.value = []
      }

      progressPercentage.value = course.progress_percentage || 0
      watchedSeconds.value = 0
      maxSyncedSeconds.value = 0
    } else {
      courseTitle.value = '未知课程'
      videoUrl.value = ''
      materials.value = []
      progressPercentage.value = 0
      watchedSeconds.value = 0
      maxSyncedSeconds.value = 0
    }
  } catch (e: any) {
    console.error('fetchCourseDetail error', e)
    uni.showToast({ title: '加载失败', icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}

// ============ 页面周期 ============
onMounted(() => {
  const pages = getCurrentPages()
  const currentPage = pages[pages.length - 1] as any
  const options = currentPage.options || currentPage.$page?.options || {}

  courseId.value = options.id || ''
  courseTitle.value = decodeURIComponent(options.title || '')

  if (courseId.value) {
    fetchCourseDetail()
  }
})

onUnmounted(() => {
  stopHeartbeat()
  // 离开页面时同步最终进度
  if (maxSyncedSeconds.value > 0) {
    syncProgress(false)
  }
})
</script>

<style scoped lang="scss">
.detail-container {
  min-height: 100vh;
  background-color: #fff;
  position: relative;
  padding-top: calc(env(safe-area-inset-top) + 100rpx);
  box-sizing: border-box;
}

/* 固定在顶部的返回键 */
.custom-back-btn {
  position: absolute;
  top: env(safe-area-inset-top);
  left: 30rpx;
  padding: 20rpx 0;
  display: flex;
  align-items: center;
  z-index: 999;
  cursor: pointer;
}
.back-arrow { font-size: 40rpx; color: #333; font-weight: bold; margin-right: 10rpx; }
.back-text { font-size: 32rpx; color: #333; }

/* 视频区域 */
.video-wrapper {
  width: 100%;
}

/* 视频区域 */
.video-wrap {
  width: 100%;
  height: 420rpx;
  background: #000;
  position: relative;
}

.video-player {
  width: 100%;
  height: 100%;
}

.video-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
}

.placeholder-icon {
  font-size: 80rpx;
}

.placeholder-text {
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.5);
}

/* 课程头部 */
.course-header {
  background: #fff;
  padding: 24rpx 32rpx;
  margin-bottom: 16rpx;
}

.course-header .course-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #1a1a2e;
  display: block;
  margin-bottom: 16rpx;
}

.course-meta {
  display: flex;
  gap: 32rpx;
  margin-bottom: 16rpx;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6rpx;
}

.meta-icon {
  font-size: 24rpx;
}

.meta-text {
  font-size: 24rpx;
  color: #606266;
}

.progress-bar-wrap {
  height: 6rpx;
  background: #e4e7ed;
  border-radius: 3rpx;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #409eff, #79bbff);
  transition: width 0.3s;
}

/* 课件区域 */
.materials-section {
  background: #fff;
  padding: 24rpx 32rpx;
}

.section-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #1a1a2e;
  display: block;
  margin-bottom: 20rpx;
}

.material-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.material-item {
  display: flex;
  align-items: center;
  background: #f5f7fa;
  border-radius: 12rpx;
  padding: 20rpx 24rpx;
  gap: 16rpx;
}

.material-icon {
  width: 64rpx;
  height: 64rpx;
  background: #fff;
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  flex-shrink: 0;
}

.material-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  overflow: hidden;
}

.material-name {
  font-size: 28rpx;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.material-size {
  font-size: 22rpx;
  color: #909399;
}

.download-btn {
  width: 56rpx;
  height: 56rpx;
  background: #409eff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.download-icon {
  font-size: 28rpx;
  color: #fff;
  font-weight: 700;
}

.empty-materials {
  text-align: center;
  padding: 48rpx;
  color: #909399;
  font-size: 26rpx;
}
</style>
