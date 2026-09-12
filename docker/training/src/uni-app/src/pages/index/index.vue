<template>
  <view class="min-h-screen bg-[#f4f7fb] flex flex-col">
    <!-- 顶部导航栏 -->
    <view class="px-5 pt-14 pb-2 flex justify-between items-center bg-white/50 backdrop-blur-md sticky top-0 z-40">
      <view class="flex items-center gap-3">
        <view class="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center overflow-hidden shadow-md">
          <text class="text-xl">💼</text>
        </view>
        <text class="text-[18px] font-bold text-gray-900 tracking-wide">融合以琳 · 智库</text>
      </view>
      <view class="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center relative">
        <text class="text-xl">🔔</text>
        <view class="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></view>
      </view>
    </view>

    <scroll-view scroll-y class="flex-1" :show-scrollbar="false">
      <!-- 问候语 -->
      <view class="px-5 mt-4 mb-6">
        <view class="flex items-end gap-3 mb-1">
          <text class="text-[28px] font-bold text-gray-900">您好，{{ userName || '学员' }}</text>
          <view class="bg-blue-100 px-3 py-1 rounded-full mb-1.5">
            <text class="text-[12px] font-bold text-blue-600">{{ levelName || '进阶期 (ADVANCED)' }}</text>
          </view>
        </view>
        <text class="text-[14px] text-gray-500">今天又是精进专业思维的一天 ✨</text>
      </view>

      <!-- 学习路径标题 -->
      <view class="px-5 mb-4 flex items-center gap-2">
        <text class="text-[18px]">📍</text>
        <text class="text-[18px] font-bold text-gray-900">学习路径</text>
      </view>

      <!-- 阶段胶囊 Tab -->
      <scroll-view scroll-x class="px-5 mb-6 whitespace-nowrap" :show-scrollbar="false">
        <view class="flex gap-3 pr-10">
          <view
            v-for="tab in stageTabs"
            :key="tab.key"
            @click="onTabClick(tab.key)"
            class="px-5 py-2.5 rounded-full transition-all duration-300 relative"
            :class="activeTab === tab.key ? 'bg-blue-600 shadow-md shadow-blue-500/30' : 'bg-gray-200/70'"
          >
            <text class="text-[15px] font-medium" :class="activeTab === tab.key ? 'text-white' : 'text-gray-600'">
              {{ tab.name }}
            </text>
            <view v-if="isTabLocked(tab.key)" class="absolute -top-1 -right-1 bg-gray-100 rounded-full p-0.5 border-2 border-white">
              <text class="text-[10px]">🔒</text>
            </view>
          </view>
        </view>
      </scroll-view>

      <!-- 课程单列卡片 -->
      <view class="px-5 flex flex-col gap-4">
        <view
          v-for="(course, index) in filteredCourses"
          :key="course.id"
          @click="onCourseClick(course)"
          class="bg-white p-3.5 rounded-[28px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] flex gap-4 items-center relative overflow-hidden active:scale-[0.98] transition-transform"
        >
          <!-- 封面图 -->
          <view class="w-[90px] h-[90px] rounded-[20px] bg-gray-100 flex-shrink-0 relative overflow-hidden shadow-inner">
            <image class="w-full h-full object-cover" :src="course.cover_image" mode="aspectFill" />
            <!-- 锁定遮罩 -->
            <view v-if="isCourseLocked(course)" class="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center">
              <text class="text-2xl mb-1">🔒</text>
            </view>
          </view>

          <!-- 课程信息 -->
          <view class="flex-1 flex flex-col justify-center py-1">
            <text class="text-[17px] font-bold text-gray-900 leading-tight mb-1.5" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              {{ course.title }}
            </text>
            <view class="flex items-center gap-3 mb-3">
              <view class="flex items-center gap-1 text-gray-400">
                <text class="text-[12px]">⏱</text>
                <text class="text-[13px]">{{ course.duration_minutes }} min</text>
              </view>
              <view v-if="course.progress_percentage > 0" class="flex items-center gap-1 text-blue-500">
                <text class="text-[13px] font-medium">进度 {{ course.progress_percentage }}%</text>
              </view>
            </view>

            <!-- 学习按钮 -->
            <view
              class="w-fit px-5 py-1.5 rounded-full flex items-center justify-center"
              :class="isCourseLocked(course) ? 'bg-gray-100' : 'bg-[#0052D9] shadow-md shadow-blue-500/20'"
            >
              <text class="text-[13px] font-bold tracking-wide" :class="isCourseLocked(course) ? 'text-gray-400' : 'text-white'">
                {{ isCourseLocked(course) ? '锁定课程' : (course.progress_percentage >= 100 ? '再次学习' : '开始学习') }}
              </text>
            </view>
          </view>
        </view>

        <!-- 空状态 -->
        <view v-if="filteredCourses.length === 0" class="py-12 flex flex-col items-center justify-center opacity-50">
          <text class="text-4xl mb-4">📭</text>
          <text class="text-gray-500 text-[15px]">该阶段暂无课程数据</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow, onLoad } from '@dcloudio/uni-app'
import { get } from '@/utils/request'

// ============ 登录拦截 ============
onLoad(() => {
  const token = uni.getStorageSync('token')
  if (!token) {
    uni.reLaunch({ url: '/pages/login/index' })
  }
})

// ============ 类型定义 ============
interface Course {
  id: string
  title: string
  cover_image: string
  stage: string
  stage_name: string
  duration_minutes: number
  description?: string
  video_url?: string
  progress_percentage: number
  materials?: Material[]
}

interface Material {
  id: string
  title: string
  file_type: string
  file_size?: number
}

const STAGE_ORDER = ['ONBOARDING', 'TRANSFER', 'ADVANCEMENT']
const STAGE_TAB_NAMES: Record<string, string> = {
  ONBOARDING: '入职期',
  TRANSFER: '衔接期',
  ADVANCEMENT: '进阶期',
}
const UNLOCK_THRESHOLD = 80

// ============ 状态 ============
const userName = ref('学员')
const levelName = ref('初阶阶段')

const activeTab = ref('ONBOARDING')
const courses = ref<Course[]>([])

const stageCompletionMap = ref<Record<string, number>>({
  ONBOARDING: 0,
  TRANSFER: 0,
  ADVANCEMENT: 0,
})

const stageTabs = computed(() =>
  STAGE_ORDER.map((key) => ({
    key,
    name: STAGE_TAB_NAMES[key],
  }))
)

const filteredCourses = computed(() =>
  courses.value.filter((c) => c.stage === activeTab.value)
)

function getTabProgress(stage: string): string {
  return `${stageCompletionMap.value[stage] || 0}%`
}

function isTabLocked(stage: string): boolean {
  const idx = STAGE_ORDER.indexOf(stage)
  if (idx === 0) return false
  const prevStage = STAGE_ORDER[idx - 1]
  const prevPct = stageCompletionMap.value[prevStage] || 0
  return prevPct < UNLOCK_THRESHOLD
}

function isCourseLocked(course: Course): boolean {
  return isTabLocked(course.stage)
}

function calcStageCompletion(stage: string) {
  const stageCourses = courses.value.filter((c) => c.stage === stage)
  if (!stageCourses.length) return 0
  const done = stageCourses.filter((c) => c.progress_percentage >= 100).length
  return Math.round((done / stageCourses.length) * 100)
}

async function fetchAll() {
  uni.showLoading({ title: '加载中...' })
  try {
    // 使用后端 /user/progress 接口，包含课程列表和进度
    const res: any = await get('/user/progress')
    if (res?.data) {
      // 填充课程列表（后端返回的课程含真实 progress）
      courses.value = res.data.courses.map((c: any) => ({
        id: String(c.id),
        title: c.name || c.title || `课程 ${c.id}`,
        cover_image: '',
        stage: c.stage || 'ONBOARDING',
        stage_name: c.stage_name || '新人培训',
        duration_minutes: c.duration_minutes || 0,
        video_url: c.url || '',
        pdf_url: '',
        progress_percentage: typeof c.progress === 'number' ? c.progress : 0,
      }))

      // 计算各阶段完成百分比
      for (const stage of STAGE_ORDER) {
        stageCompletionMap.value[stage] = calcStageCompletion(stage)
      }

      // 默认选中第一个未锁定的阶段
      const firstUnlocked = STAGE_ORDER.find((s) => !isTabLocked(s))
      if (firstUnlocked) activeTab.value = firstUnlocked
    }
  } catch (e) {
    console.error('fetchAll error', e)
    uni.showToast({ title: '加载失败', icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}

function onTabClick(stage: string) {
  if (isTabLocked(stage)) {
    const prevName = STAGE_TAB_NAMES[STAGE_ORDER[STAGE_ORDER.indexOf(stage) - 1]]
    uni.showToast({ title: `请先完成 ${prevName} 80% 以上`, icon: 'none', duration: 2000 })
    return
  }
  activeTab.value = stage
}

function onCourseClick(course: Course) {
  if (isCourseLocked(course)) {
    uni.showToast({ title: '请先解锁当前阶段', icon: 'none' })
    return
  }
  uni.navigateTo({
    url: `/pages/course/detail?id=${course.id}&title=${encodeURIComponent(course.title)}`,
  })
}

function switchTab(tab: 'index' | 'ai' | 'my') {
  if (tab === 'index') uni.reLaunch({ url: '/pages/index/index' })
  if (tab === 'ai') uni.reLaunch({ url: '/pages/ai/index' })
  if (tab === 'my') uni.reLaunch({ url: '/pages/my/index' })
}

onShow(() => {
  fetchAll()
})
</script>

<style scoped>
::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
  color: transparent;
}
</style>
