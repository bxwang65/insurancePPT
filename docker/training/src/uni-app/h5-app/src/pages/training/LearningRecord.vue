<template>
  <div class="record-page">
    <!-- 顶部栏 -->
    <div class="record-header">
      <button class="back-btn" @click="emit('back')">‹ 返回</button>
      <span class="record-title">📒 学习记录</span>
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
      <button class="retry-btn" @click="fetchBill">重试</button>
    </div>

    <template v-else>
      <!-- 统计卡片：累计学时 / 完成课程数 -->
      <div class="stat-row">
        <div class="stat-card">
          <div class="stat-num">{{ bill.totalHours }}</div>
          <div class="stat-label">累计学时（小时）</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">{{ bill.completedCount }}</div>
          <div class="stat-label">已完成课程（门）</div>
        </div>
      </div>

      <!-- 学习足迹时间轴 -->
      <div class="timeline-section">
        <div class="section-title" style="padding: 0 0 12px;">学习足迹</div>
        <div v-if="bill.history.length" class="timeline">
          <div v-for="(item, i) in bill.history" :key="i" class="timeline-item">
            <div class="timeline-dot" :class="{ done: item.action === '完成了课程' }"></div>
            <div class="timeline-body">
              <div class="timeline-text">
                <span :class="{ 'is-done': item.action === '完成了课程' }">{{ item.action }}</span>
                「{{ item.courseName }}」
              </div>
              <div class="timeline-date">{{ item.date }}</div>
            </div>
          </div>
        </div>
        <div v-else class="empty-state" style="padding: 24px;">
          <div class="icon">🌱</div>
          <div class="text">还没有学习足迹，快去学习吧</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { api } from '../../utils/api'

const emit = defineEmits(['back'])

const loading = ref(true)
const loadError = ref('')
// GET /api/user/bill 真实结构：{ totalHours, completedCount, history: [{ date, action, courseName }] }
const bill = reactive({ totalHours: 0, completedCount: 0, history: [] })

async function fetchBill() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await api('/user/bill')
    bill.totalHours = data?.totalHours ?? 0
    bill.completedCount = data?.completedCount ?? 0
    bill.history = data?.history || []
  } catch (e) {
    console.error('fetchBill error', e)
    loadError.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(fetchBill)
</script>

<style scoped>
.record-page { min-height: 100%; background: #f4f7fb; }
.record-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #fff; border-bottom: 1px solid #f1f5f9; position: sticky; top: 0; z-index: 10; }
.back-btn { padding: 6px 14px; border-radius: 8px; border: none; background: #f1f5f9; font-size: 14px; color: #334155; cursor: pointer; font-weight: 500; }
.record-title { font-size: 16px; font-weight: 600; color: #0f172a; }
.stat-row { display: flex; gap: 12px; padding: 16px; }
.stat-card { flex: 1; background: #fff; border-radius: 16px; padding: 20px 16px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,.03); }
.stat-num { font-size: 28px; font-weight: 700; color: #2563eb; }
.stat-label { font-size: 12px; color: #94a3b8; margin-top: 4px; }
.timeline-section { background: #fff; margin: 0 16px 24px; border-radius: 16px; padding: 16px; box-shadow: 0 4px 20px rgba(0,0,0,.03); }
.timeline { display: flex; flex-direction: column; }
.timeline-item { display: flex; gap: 12px; position: relative; padding-bottom: 18px; }
.timeline-item:not(:last-child)::before { content: ''; position: absolute; left: 5px; top: 14px; bottom: 0; width: 2px; background: #e2e8f0; }
.timeline-dot { width: 12px; height: 12px; border-radius: 50%; background: #cbd5e1; flex-shrink: 0; margin-top: 3px; z-index: 1; }
.timeline-dot.done { background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.15); }
.timeline-body { flex: 1; min-width: 0; }
.timeline-text { font-size: 14px; color: #334155; word-break: break-all; }
.timeline-text .is-done { color: #15803d; font-weight: 600; }
.timeline-date { font-size: 11px; color: #94a3b8; margin-top: 3px; }
.retry-btn { margin-top: 16px; padding: 8px 28px; border: none; border-radius: 99px; background: #2563eb; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
</style>
