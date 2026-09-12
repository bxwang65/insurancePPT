<template>
  <!-- 学习记录 -->
  <LearningRecord v-if="view === 'record'" @back="onBackFromSub" />

  <!-- 课程播放 -->
  <CoursePlayer v-else-if="view === 'player' && activeCourse" :course-id="activeCourse.id" @back="onBackFromSub" />

  <!-- 培训首页 -->
  <div v-else>
    <!-- 登录失败重试 -->
    <div v-if="authError" class="empty-state" style="padding-top: 96px;">
      <div class="icon">🔌</div>
      <div class="text">{{ authError }}</div>
      <button class="retry-btn" @click="init">重新连接</button>
    </div>

    <!-- 加载中 -->
    <div v-else-if="loading" class="empty-state" style="padding-top: 96px;">
      <div class="icon">⏳</div>
      <div class="text">加载中...</div>
    </div>

    <!-- 数据加载失败 -->
    <div v-else-if="loadError" class="empty-state" style="padding-top: 96px;">
      <div class="icon">⚠️</div>
      <div class="text">{{ loadError }}</div>
      <button class="retry-btn" @click="fetchProgress">重试</button>
    </div>

    <template v-else>
      <!-- 学员身份卡 + 总进度概览 -->
      <div class="greeting">
        <h1>您好，{{ user?.name || '学员' }}<span v-if="user?.level_name" class="level">{{ user.level_name }}</span></h1>
        <p>已完成 {{ completedCourses }}/{{ totalCourses }} 门课程 · 整体进度 {{ overallProgress }}%</p>
      </div>

      <!-- 学习路径标题 + 学习记录入口 -->
      <div class="section-row">
        <div class="section-title" style="padding-bottom: 0;">📍 学习路径</div>
        <button class="record-entry" @click="view = 'record'">📒 学习记录 ›</button>
      </div>

      <!-- 阶段 Tab -->
      <div class="stage-tabs">
        <button
          v-for="tab in stageTabs"
          :key="tab.key"
          class="stage-btn"
          :class="{ active: activeStage === tab.key }"
          @click="onStageClick(tab.key)"
        >
          {{ tab.name }}{{ isStageLocked(tab.key) ? ' 🔒' : '' }} · {{ stageCompletionMap[tab.key] || 0 }}%
        </button>
      </div>

      <!-- 课程卡片列表 -->
      <div class="course-list">
        <div
          v-for="course in filteredCourses"
          :key="course.id"
          class="course-card"
          @click="onCourseClick(course)"
        >
          <div class="course-cover" :class="{ locked: isCourseLocked(course) }">
            <img v-if="course.cover_image" class="cover-img" :src="resolveMediaUrl(course.cover_image)" alt="" />
            <span v-else>📘</span>
            <span v-if="isCourseLocked(course)" class="lock-icon">🔒</span>
          </div>
          <div class="course-info">
            <div class="course-title">{{ course.title }}</div>
            <div class="course-meta">
              <span>⏱ {{ course.duration_minutes }} min</span>
              <span v-if="course.progress > 0">进度 {{ course.progress }}%</span>
            </div>
            <div class="course-progress">
              <div class="course-progress-bar" :style="{ width: course.progress + '%' }"></div>
            </div>
            <div style="margin-top: 10px;">
              <button class="course-btn" :class="isCourseLocked(course) ? 'disabled' : 'primary'">
                {{ isCourseLocked(course) ? '锁定课程' : (course.progress >= 100 ? '再次学习' : '开始学习') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 空态 -->
        <div v-if="filteredCourses.length === 0" class="empty-state">
          <div class="icon">📭</div>
          <div class="text">该阶段暂无课程数据</div>
        </div>
      </div>
    </template>

    <!-- 轻提示 -->
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api, resolveMediaUrl } from '../../utils/api'
import { getCachedUser } from '../../utils/identity'
import CoursePlayer from './CoursePlayer.vue'
import LearningRecord from './LearningRecord.vue'

const STAGE_ORDER = ['ONBOARDING', 'PRODUCT', 'TRANSFER', 'ADVANCEMENT']
const STAGE_TAB_NAMES = {
  ONBOARDING: '新人训',
  PRODUCT: '产品训',
  TRANSFER: '衔接训',
  ADVANCEMENT: '进阶训',
}
// 2026-08-13: 解锁规则按用户定义
//   新人训: 始终解锁
//   产品训: 新人训视频 ≥ 50% 解锁
//   衔接训: 新人训 ≥ 80% 解锁 (不链产品训, 直接看新人训)
//   进阶训: 衔接训 ≥ 80% 解锁
const STAGE_UNLOCK = {
  ONBOARDING:  { prev: null,         threshold: 0  },
  PRODUCT:     { prev: 'ONBOARDING', threshold: 50 },
  TRANSFER:    { prev: 'ONBOARDING', threshold: 80 },
  ADVANCEMENT: { prev: 'TRANSFER',   threshold: 80 },
}

// ============ 状态 ============
const view = ref('list') // list | player | record
const activeCourse = ref(null)
const user = ref(getCachedUser())

const loading = ref(true)
const loadError = ref('')
const authError = ref('')
const toast = ref('')
let toastTimer = null

const courses = ref([])
const activeStage = ref('ONBOARDING')
const stageCompletionMap = ref({ ONBOARDING: 0, PRODUCT: 0, TRANSFER: 0, ADVANCEMENT: 0 })
const totalCourses = ref(0)
const completedCourses = ref(0)

const stageTabs = computed(() => STAGE_ORDER.map((key) => ({ key, name: STAGE_TAB_NAMES[key] })))
const filteredCourses = computed(() => courses.value.filter((c) => c.stage === activeStage.value))
const overallProgress = computed(() => {
  if (!courses.value.length) return 0
  const sum = courses.value.reduce((acc, c) => acc + Math.min(100, c.progress), 0)
  return Math.round(sum / courses.value.length)
})

// ============ 阶段解锁规则 ============
// 2026-08-14: 管理员 (123@qqq.com / isAdmin=true) 直接可见所有阶段, 不受解锁规则约束
function isStageLocked(stage) {
  if (user.value?.isAdmin) return false
  const rule = STAGE_UNLOCK[stage]
  if (!rule || !rule.prev) return false
  return (stageCompletionMap.value[rule.prev] || 0) < rule.threshold
}
function isCourseLocked(course) {
  return isStageLocked(course.stage)
}

function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2000)
}

// ============ 数据加载 ============
async function init() {
  // 2026-08-12: 鉴权由 App.vue 守门, 此处直接读 4in1 JWT 解出的 user, 不再 ensureSession
  authError.value = ''
  loading.value = true
  user.value = getCachedUser()
  try {
    await fetchProgress()
  } catch (e) {
    console.error('init error', e)
    authError.value = e.message || '加载失败'
    loading.value = false
  }
}

async function fetchProgress() {
  loadError.value = ''
  loading.value = true
  try {
    const data = await api('/user/progress')
    courses.value = (data?.courses || []).map((c) => ({
      id: String(c.id),
      title: c.name || c.title || `课程 ${c.id}`,
      stage: c.stage || 'ONBOARDING',
      stage_name: c.stage_name || '',
      duration_minutes: c.duration_minutes || 0,
      cover_image: c.cover_image || '',
      progress: typeof c.progress === 'number' ? c.progress : (c.progress_percentage || 0),
    }))
    stageCompletionMap.value = data?.stageCompletionMap || { ONBOARDING: 0, PRODUCT: 0, TRANSFER: 0, ADVANCEMENT: 0 }
    totalCourses.value = data?.totalCourses ?? courses.value.length
    completedCourses.value = data?.completedCourses ?? courses.value.filter((c) => c.progress >= 100).length
    // 默认选中第一个未锁定阶段
    const firstUnlocked = STAGE_ORDER.find((s) => !isStageLocked(s))
    if (firstUnlocked) activeStage.value = firstUnlocked
  } catch (e) {
    console.error('fetchProgress error', e)
    loadError.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

// ============ 交互 ============
function onStageClick(stage) {
  if (isStageLocked(stage)) {
    const rule = STAGE_UNLOCK[stage]
    const prevName = STAGE_TAB_NAMES[rule.prev] || '上一阶段'
    showToast(`请先完成${prevName} ${rule.threshold}% 以上`)
    return
  }
  activeStage.value = stage
}

function onCourseClick(course) {
  // 管理员不受课程锁定限制 (与 isStageLocked 同步)
  if (!user.value?.isAdmin && isCourseLocked(course)) {
    const rule = STAGE_UNLOCK[course.stage]
    const prevName = STAGE_TAB_NAMES[rule.prev] || '上一阶段'
    showToast(`请先完成${prevName} ${rule.threshold}% 以上`)
    return
  }
  activeCourse.value = course
  view.value = 'player'
}

function onBackFromSub() {
  view.value = 'list'
  activeCourse.value = null
  fetchProgress() // 回列表时刷新最新进度
}

onMounted(init)
</script>

<style scoped>
.section-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 16px 12px; }
.record-entry { border: none; background: #fff; color: #2563eb; font-size: 13px; font-weight: 600; padding: 6px 12px; border-radius: 99px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.04); }
.cover-img { width: 100%; height: 100%; object-fit: cover; }
.retry-btn { margin-top: 16px; padding: 8px 28px; border: none; border-radius: 99px; background: #2563eb; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(37,99,235,.3); }
.toast { position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); background: rgba(15,23,42,.85); color: #fff; font-size: 13px; padding: 10px 20px; border-radius: 99px; z-index: 100; white-space: nowrap; }
.course-list { padding-bottom: 24px; }
/* 注: .stage-tabs / .stage-btn 全局样式在 App.vue, 含 overflow-x:auto + flex-shrink:0 */
</style>
