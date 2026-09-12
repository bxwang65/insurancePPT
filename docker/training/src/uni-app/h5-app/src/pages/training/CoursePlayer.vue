<template>
  <div class="player-page">
    <!-- 顶部栏 -->
    <div class="player-header">
      <button class="back-btn" @click="onBack">‹ 返回</button>
      <span class="player-title">{{ course?.title || '课程详情' }}</span>
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="empty-state" style="padding-top: 80px;">
      <div class="icon">⏳</div>
      <div class="text">加载中...</div>
    </div>

    <!-- 加载失败 -->
    <div v-else-if="loadError" class="empty-state" style="padding-top: 80px;">
      <div class="icon">⚠️</div>
      <div class="text">{{ loadError }}</div>
      <button class="retry-btn" @click="fetchDetail">重试</button>
    </div>

    <template v-else>
      <!-- 视频区域 -->
      <div class="video-wrapper">
        <video
          v-if="videoSrc"
          ref="videoRef"
          class="video-player"
          :src="videoSrc"
          controls
          preload="metadata"
          playsinline
          @play="onPlay"
          @pause="onPause"
          @timeupdate="onTimeUpdate"
          @seeked="onSeeked"
          @ended="onEnded"
          @error="onVideoError"
        ></video>
        <div v-else class="video-placeholder">
          <div class="placeholder-icon">📹</div>
          <div class="placeholder-text">视频待上传</div>
        </div>
      </div>

      <!-- 快进警告横幅 -->
      <div v-if="jumpWarning" class="jump-warn">请正常观看视频</div>

      <!-- 课程信息 -->
      <div class="player-section">
        <div class="player-course-title">{{ course?.title }}</div>
        <div class="player-meta">
          <span>⏱ 时长 {{ course?.duration_minutes || 0 }} min</span>
          <span>📊 进度 {{ progressPercentage }}%</span>
        </div>
        <div class="course-progress">
          <div class="course-progress-bar" :style="{ width: progressPercentage + '%' }"></div>
        </div>
        <div v-if="completed" class="complete-banner">🎉 恭喜完成本课程学习</div>
        <div v-if="blockedMsg" class="blocked-banner">⚠️ {{ blockedMsg }}</div>
      </div>

      <!-- 课件资料 -->
      <div class="player-section">
        <div class="section-title" style="padding: 0 0 12px;">课件资料</div>
        <div v-if="materials.length" class="material-list">
          <div v-for="m in materials" :key="m.id" class="material-item" @click="openMaterial(m)">
            <div class="material-icon">{{ fileTypeIcon(m.file_type) }}</div>
            <div class="material-info">
              <div class="material-name">{{ m.title }}</div>
              <div class="material-size">{{ formatSize(m.file_size) }}</div>
            </div>
            <div class="material-open">打开 ›</div>
          </div>
        </div>
        <div v-else class="empty-state" style="padding: 24px;">
          <div class="text">暂无课件</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { api, resolveMediaUrl } from '../../utils/api'

const props = defineProps({
  courseId: { type: String, required: true },
})
const emit = defineEmits(['back'])

const MAX_JUMP_SECONDS = 15 // 允许最大快进秒数
const HEARTBEAT_MS = 10000  // 心跳间隔

// ============ 状态 ============
const loading = ref(true)
const loadError = ref('')
const course = ref(null)
const videoSrc = ref('')
const materials = ref([])
const progressPercentage = ref(0)
const completed = ref(false)
const blockedMsg = ref('')
const jumpWarning = ref(false)

const videoRef = ref(null)
const isPlaying = ref(false)
let heartbeatTimer = null
let lastValidTime = 0        // 最近一次合法播放位置（秒）
let firstUpdate = true       // 首次 timeupdate 不做快进判定
let recovering = false       // 强制回跳恢复中
let recoverTimer = null
let jumpWarnTimer = null
let maxSyncedSeconds = 0     // 已同步最远秒数（只增不减）
let finalSynced = false

// ============ 数据加载 ============
async function fetchDetail() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await api(`/courses/${props.courseId}`)
    course.value = data || null
    materials.value = data?.materials || []
    progressPercentage.value = data?.progress_percentage || 0

    const rawUrl = data?.video_url || ''
    // video_url 为空或本地绝对路径（未上传到服务器）→ 占位
    videoSrc.value = (!rawUrl || rawUrl.startsWith('/Users')) ? '' : resolveMediaUrl(rawUrl)
  } catch (e) {
    console.error('fetchDetail error', e)
    loadError.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

// ============ 进度同步 ============
function calcPercentage(seconds) {
  const v = videoRef.value
  const duration = v?.duration
  if (!duration || duration <= 0) return progressPercentage.value
  return Math.min(100, Math.floor((seconds / duration) * 100))
}

async function syncProgress(percentage, { keepalive = false, currentPosition } = {}) {
  try {
    const body = { courseId: props.courseId, percentage }
    if (currentPosition !== undefined) body.currentPosition = currentPosition
    const data = await api('/user/sync-progress', {
      method: 'POST',
      body,
      keepalive,
    })
    blockedMsg.value = data?.blocked ? (data.warning ?? data.message ?? '当前进度被限制') : ''
  } catch (e) {
    console.error('syncProgress error', e)
  }
}

function heartbeatSync() {
  const v = videoRef.value
  if (!v) return
  // maxSyncedSeconds 只增不减，进度不回退；lastValidTime 为 timeupdate 校验过的合法秒数
  const seconds = Math.max(maxSyncedSeconds, lastValidTime)
  const pct = calcPercentage(seconds)
  if (pct > progressPercentage.value) progressPercentage.value = pct
  syncProgress(pct, { currentPosition: Math.ceil(seconds) })
}

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (isPlaying.value) heartbeatSync()
  }, HEARTBEAT_MS)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

// pause/pagehide/隐藏时的收尾打点（keepalive 保证页面关闭也能送达）
function finalSync() {
  if (!maxSyncedSeconds && !videoRef.value?.currentTime) return
  const seconds = Math.max(maxSyncedSeconds, lastValidTime, videoRef.value?.currentTime || 0)
  const pct = completed.value ? 100 : calcPercentage(seconds)
  syncProgress(pct, { keepalive: true, currentPosition: Math.ceil(seconds) })
}

// ============ 视频事件 ============
function onPlay() {
  isPlaying.value = true
  startHeartbeat()
}

function onPause() {
  isPlaying.value = false
  stopHeartbeat()
  finalSync()
}

function onTimeUpdate() {
  const v = videoRef.value
  if (!v) return
  const t = v.currentTime

  // 防快进兜底：跳跃超过阈值且非首次/非恢复中 → 强制回跳（主判定在 onSeeked）
  if (!firstUpdate && !recovering && t - lastValidTime > MAX_JUMP_SECONDS) {
    rejectJump(v)
    return
  }

  firstUpdate = false
  lastValidTime = t
  if (t > maxSyncedSeconds) maxSyncedSeconds = t

  const pct = calcPercentage(Math.max(maxSyncedSeconds, t))
  if (pct > progressPercentage.value) progressPercentage.value = pct
}

// 快进拦截：警告 + 强制回跳到最近合法位置
function rejectJump(v) {
  jumpWarning.value = true
  clearTimeout(jumpWarnTimer)
  jumpWarnTimer = setTimeout(() => { jumpWarning.value = false }, 2000)
  recovering = true
  v.currentTime = lastValidTime
  clearTimeout(recoverTimer)
  recoverTimer = setTimeout(() => { recovering = false; firstUpdate = true }, 800)
}

function onSeeked() {
  const v = videoRef.value
  if (!v) return
  if (recovering) return // 回跳本身触发的 seeked 不处理
  // 防快进主判定：seek 完成时向前跳跃超过阈值 → 提示 + 强制回跳
  if (v.currentTime - lastValidTime > MAX_JUMP_SECONDS) {
    rejectJump(v)
    return
  }
  // 合法 seek（如向后拖动）：以新位置为基准
  firstUpdate = true
  lastValidTime = v.currentTime
}

function onEnded() {
  const v = videoRef.value
  isPlaying.value = false
  stopHeartbeat()
  progressPercentage.value = 100
  completed.value = true
  // 完结打点：currentPosition 取 duration 与 maxSyncedSeconds 的大者，向上取整
  const endSeconds = Math.ceil(Math.max(v?.duration || 0, maxSyncedSeconds))
  syncProgress(100, { currentPosition: endSeconds })
}

function onVideoError() {
  loadError.value = ''
  jumpWarning.value = false
  console.error('video error')
}

// ============ 课件 ============
function openMaterial(m) {
  if (!m.file_url) return
  const url = resolveMediaUrl(m.file_url)
  // 仅允许 http/https 绝对地址或同源相对路径，防 javascript:/data: 协议
  if (!/^(https?:\/\/|\/)/i.test(url)) return
  window.open(url, '_blank')
}

function fileTypeIcon(type) {
  const map = { pdf: '📄', ppt: '📊', pptx: '📊', doc: '📝', docx: '📝', xls: '📈', xlsx: '📈', mp4: '🎬', mp3: '🎵' }
  return map[(type || '').toLowerCase()] || '📎'
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// ============ 页面可见性收尾打点 ============
function onPageHide() {
  finalSync()
}
function onVisibilityChange() {
  if (document.visibilityState === 'hidden') finalSync()
}

function onBack() {
  finalSynced = true
  finalSync()
  emit('back')
}

onMounted(() => {
  fetchDetail()
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  stopHeartbeat()
  clearTimeout(recoverTimer)
  clearTimeout(jumpWarnTimer)
  window.removeEventListener('pagehide', onPageHide)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (!finalSynced) finalSync()
})
</script>

<style scoped>
.player-page { min-height: 100%; background: #f4f7fb; }
.player-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #fff; border-bottom: 1px solid #f1f5f9; position: sticky; top: 0; z-index: 10; }
.back-btn { padding: 6px 14px; border-radius: 8px; border: none; background: #f1f5f9; font-size: 14px; color: #334155; cursor: pointer; font-weight: 500; }
.player-title { font-size: 16px; font-weight: 600; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.video-wrapper { width: 100%; aspect-ratio: 16 / 9; background: #000; }
.video-player { width: 100%; height: 100%; display: block; }
.video-placeholder { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
.placeholder-icon { font-size: 40px; }
.placeholder-text { font-size: 14px; color: rgba(255,255,255,.5); }
.jump-warn { background: #fef3c7; color: #b45309; font-size: 13px; text-align: center; padding: 8px; font-weight: 600; }
.player-section { background: #fff; margin: 12px 16px; border-radius: 16px; padding: 16px; box-shadow: 0 4px 20px rgba(0,0,0,.03); }
.player-course-title { font-size: 17px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
.player-meta { font-size: 12px; color: #94a3b8; display: flex; gap: 14px; margin-bottom: 10px; }
.complete-banner { margin-top: 12px; background: #dcfce7; color: #15803d; font-size: 13px; font-weight: 600; text-align: center; padding: 8px; border-radius: 10px; }
.blocked-banner { margin-top: 12px; background: #fef3c7; color: #b45309; font-size: 13px; text-align: center; padding: 8px; border-radius: 10px; }
.material-list { display: flex; flex-direction: column; gap: 10px; }
.material-item { display: flex; align-items: center; gap: 12px; background: #f8fafc; border-radius: 12px; padding: 12px; cursor: pointer; transition: transform .1s; }
.material-item:active { transform: scale(.98); }
.material-icon { width: 40px; height: 40px; border-radius: 10px; background: #fff; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
.material-info { flex: 1; min-width: 0; }
.material-name { font-size: 14px; color: #0f172a; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.material-size { font-size: 11px; color: #94a3b8; margin-top: 2px; }
.material-open { font-size: 12px; color: #2563eb; font-weight: 600; flex-shrink: 0; }
.retry-btn { margin-top: 16px; padding: 8px 28px; border: none; border-radius: 99px; background: #2563eb; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
</style>
