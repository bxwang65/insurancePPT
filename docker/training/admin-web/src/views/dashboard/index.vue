<template>
  <div class="dashboard-container">
    <!-- 数据概览卡片 -->
    <el-row :gutter="20" class="stat-cards">
      <el-col :span="6">
        <div class="stat-card stat-primary">
          <div class="stat-icon"><el-icon :size="32"><User /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">{{ summary.total_students }}</div>
            <div class="stat-label">总学员数</div>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card stat-success">
          <div class="stat-icon"><el-icon :size="32"><TrendCharts /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">{{ summary.active_students_this_month }}</div>
            <div class="stat-label">本月活跃学员</div>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card stat-warning">
          <div class="stat-icon"><el-icon :size="32"><Timer /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">{{ summary.avg_learning_hours }}h</div>
            <div class="stat-label">人均学时</div>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card stat-danger">
          <div class="stat-icon"><el-icon :size="32"><Star /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">{{ summary.course_completion_rate }}%</div>
            <div class="stat-label">课程完成率</div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 2026-08-12: 业绩概览 (新增) -->
    <el-row :gutter="20" class="stat-cards">
      <el-col :span="8">
        <div class="stat-card stat-gold">
          <div class="stat-icon"><el-icon :size="32"><Money /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">¥{{ perfStats.totalSales.toLocaleString() }}</div>
            <div class="stat-label">团队总业绩 (HKD)</div>
          </div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card stat-purple">
          <div class="stat-icon"><el-icon :size="32"><Trophy /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">{{ perfStats.avgScore }} 分</div>
            <div class="stat-label">平均综合得分</div>
          </div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card stat-rose">
          <div class="stat-icon"><el-icon :size="32"><Medal /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">
              {{ perfStats.topPerformer?.name || '—' }}
            </div>
            <div class="stat-label">
              业绩之星
              <span v-if="perfStats.topPerformer" class="top-sub">
                ¥{{ perfStats.topPerformer.sales.toLocaleString() }}
              </span>
            </div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 2026-08-14: 业务看板 (基本法视角) -->
    <div class="business-dashboard">
      <!-- 时间维度 toggle -->
      <div class="biz-header">
        <span class="biz-title">业务看板</span>
        <el-radio-group v-model="bizRange" size="small" @change="fetchBusiness">
          <el-radio-button value="month">本月</el-radio-button>
          <el-radio-button value="quarter">本季</el-radio-button>
          <el-radio-button value="year">本年</el-radio-button>
        </el-radio-group>
      </div>

      <!-- 4 核心指标 -->
      <el-row :gutter="20" class="stat-cards" v-if="bizData">
        <el-col :span="6">
          <div class="stat-card stat-gold">
            <div class="stat-icon"><el-icon :size="32"><Money /></el-icon></div>
            <div class="stat-info">
              <div class="stat-value">¥{{ bizData.total_sales.toLocaleString() }}</div>
              <div class="stat-label">团队总标保</div>
            </div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card stat-success">
            <div class="stat-icon"><el-icon :size="32"><Aim /></el-icon></div>
            <div class="stat-info">
              <div class="stat-value">{{ bizData.achievement_rate }}%</div>
              <div class="stat-label">
                业绩达标率
                <span class="top-sub">{{ bizData.reached_count }}/{{ bizData.total_active_users }}</span>
              </div>
            </div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card stat-primary">
            <div class="stat-icon"><el-icon :size="32"><Connection /></el-icon></div>
            <div class="stat-info">
              <div class="stat-value">{{ bizData.total_active_users }}</div>
              <div class="stat-label">招管总人数</div>
            </div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="stat-card stat-purple">
            <div class="stat-icon"><el-icon :size="32"><Trophy /></el-icon></div>
            <div class="stat-info">
              <div class="stat-value">M{{ bizData.avg_management_level.toFixed(1) }}</div>
              <div class="stat-label">
                平均 M 等级
                <span class="top-sub">均分 {{ bizData.avg_score }}</span>
              </div>
            </div>
          </div>
        </el-col>
      </el-row>

      <!-- L / M 等级分布饼图 -->
      <el-row :gutter="20" class="charts-row" v-if="bizData">
        <el-col :span="12">
          <div class="chart-card">
            <div class="chart-title">L 业务等级分布</div>
            <div ref="bizLevelChartRef" class="chart-container"></div>
          </div>
        </el-col>
        <el-col :span="12">
          <div class="chart-card">
            <div class="chart-title">M 管理等级分布</div>
            <div ref="bizMgtChartRef" class="chart-container"></div>
          </div>
        </el-col>
      </el-row>

      <!-- 临门一脚 + M 升级机会 -->
      <el-row :gutter="20" class="biz-lists" v-if="bizData">
        <el-col :span="12">
          <div class="chart-card">
            <div class="chart-title">
              L 临门一脚预警
              <span class="top-sub">(80% - 100% 进度)</span>
            </div>
            <div v-if="!bizData.near_promotion.length" class="empty-hint">
              暂无临门一脚学员 — 当前所有 L1/L2 学员距升级阈值都有差距
            </div>
            <div v-else class="biz-list">
              <div v-for="u in (bizExpanded.near ? bizData.near_promotion : bizData.near_promotion.slice(0, bizListLimit))" :key="u.id" class="biz-list-item">
                <el-avatar :size="32" :src="u.avatar_url">{{ u.name.slice(0, 1) }}</el-avatar>
                <div class="biz-list-main">
                  <div class="biz-list-row1">
                    <span class="biz-list-name">{{ u.name }}</span>
                    <el-tag size="small" type="warning">L{{ u.current_level }} → {{ u.next_level }}</el-tag>
                  </div>
                  <div class="biz-list-row2">
                    6m 标保 ¥{{ u.current_6m.toLocaleString() }} / 阈值 ¥{{ u.threshold.toLocaleString() }}
                  </div>
                  <el-progress :percentage="u.progress_pct" :stroke-width="8" :color="progressColor(u.progress_pct)" />
                </div>
              </div>
              <el-button
                v-if="bizData.near_promotion.length > bizListLimit"
                link
                type="primary"
                size="small"
                class="biz-toggle"
                @click="bizExpanded.near = !bizExpanded.near"
              >
                {{ bizExpanded.near ? '收起' : `展开更多 (+${bizData.near_promotion.length - bizListLimit})` }}
              </el-button>
            </div>
          </div>
        </el-col>
        <el-col :span="12">
          <div class="chart-card">
            <div class="chart-title">
              M 升级机会
              <span class="top-sub">(招人 / 树标保接近阈值)</span>
            </div>
            <div v-if="!bizData.m_upgrade_opportunities.length" class="empty-hint">
              暂无 M 升级机会 — 当前所有未晋升 M 学员距升级阈值都有差距
            </div>
            <div v-else class="biz-list">
              <div v-for="u in (bizExpanded.mgt ? bizData.m_upgrade_opportunities : bizData.m_upgrade_opportunities.slice(0, bizListLimit))" :key="u.id" class="biz-list-item">
                <el-avatar :size="32" :src="u.avatar_url">{{ u.name.slice(0, 1) }}</el-avatar>
                <div class="biz-list-main">
                  <div class="biz-list-row1">
                    <span class="biz-list-name">{{ u.name }}</span>
                    <el-tag size="small" type="primary">M{{ u.current_management_level }} → {{ u.next_level }}</el-tag>
                  </div>
                  <div class="biz-list-row2">
                    招 {{ u.direct_recruits }} 人 (阈值 {{ u.direct_threshold }}) · 树 6m ¥{{ u.tree_6m_total.toLocaleString() }}
                  </div>
                  <el-progress :percentage="u.progress_pct" :stroke-width="8" :color="progressColor(u.progress_pct)" />
                </div>
              </div>
              <el-button
                v-if="bizData.m_upgrade_opportunities.length > bizListLimit"
                link
                type="primary"
                size="small"
                class="biz-toggle"
                @click="bizExpanded.mgt = !bizExpanded.mgt"
              >
                {{ bizExpanded.mgt ? '收起' : `展开更多 (+${bizData.m_upgrade_opportunities.length - bizListLimit})` }}
              </el-button>
            </div>
          </div>
        </el-col>
      </el-row>

      <!-- Top 10 业绩 -->
      <div class="chart-card" v-if="bizData">
        <div class="chart-title">业绩 Top 10</div>
        <el-row :gutter="16" class="top-grid">
          <el-col v-for="(u, i) in bizData.top_performers" :key="u.id" :span="6" class="top-col">
            <div class="top-card" :class="rankClass(i)">
              <div class="top-rank">#{{ i + 1 }}</div>
              <el-avatar :size="40" :src="u.avatar_url">{{ u.name.slice(0, 1) }}</el-avatar>
              <div class="top-info">
                <div class="top-name">{{ u.name }}</div>
                <div class="top-meta">L{{ u.current_level }} · {{ u.performance_score }} 分</div>
                <div class="top-amount">¥{{ u.sales_amount.toLocaleString() }}</div>
              </div>
            </div>
          </el-col>
        </el-row>
      </div>
    </div>

    <!-- 图表区 -->
    <el-row :gutter="20" class="charts-row">
      <!-- 阶段分布柱状图 -->
      <el-col :span="12">
        <div class="chart-card">
          <div class="chart-title">学员阶段分布</div>
          <div ref="stageChartRef" class="chart-container"></div>
        </div>
      </el-col>
      <!-- 课程热度排行榜 -->
      <el-col :span="12">
        <div class="chart-card">
          <div class="chart-title">课程热度排行榜</div>
          <div ref="hotChartRef" class="chart-container"></div>
        </div>
      </el-col>
    </el-row>

    <!-- 实时动态 -->
    <div class="activity-card">
      <div class="activity-title">实时学习动态</div>
      <el-timeline>
        <el-timeline-item
          v-for="(item, index) in summary.recent_activities"
          :key="index"
          :timestamp="formatTime(item.created_at)"
          placement="top"
        >
          <el-card shadow="hover" class="activity-item">
            <div class="activity-content">
              <el-avatar :size="32" :src="item.avatar_url" class="activity-avatar">
                {{ item.user_name.slice(0, 1) }}
              </el-avatar>
              <div class="activity-text">
                <span class="activity-name">{{ item.user_name }}</span>
                <span class="activity-action">{{ item.action }}</span>
                <span class="activity-course">《{{ item.course_title }}》</span>
              </div>
            </div>
          </el-card>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-if="!summary.recent_activities.length" description="暂无动态" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { User, TrendCharts, Timer, Star, Trophy, Money, Medal, Aim, Connection } from '@element-plus/icons-vue'
import request from '@/utils/request'
import * as echarts from 'echarts'

interface DashboardSummary {
  total_students: number
  active_students_this_month: number
  avg_learning_hours: number
  course_completion_rate: number
  stage_distribution: { name: string; count: number }[]
  top_courses: { id: string; title: string; view_count: number; like_count: number }[]
  recent_activities: {
    user_id: string
    user_name: string
    avatar_url?: string
    action: string
    course_title: string
    created_at: string
  }[]
}

const summary = reactive<DashboardSummary>({
  total_students: 0,
  active_students_this_month: 0,
  avg_learning_hours: 0,
  course_completion_rate: 0,
  stage_distribution: [],
  top_courses: [],
  recent_activities: [],
})

// 2026-08-12: 业绩统计 (从 /admin/users 客户端聚合)
const perfStats = reactive({
  totalSales: 0,
  avgScore: 0,
  topPerformer: null as { name: string; sales: number; score: number } | null,
})

const fetchPerfStats = async () => {
  try {
    // 拿全量员工 (limit=1000 兜底), 客户端聚合
    const res = await request.get('/admin/users', { params: { limit: 1000 } })
    const list = res?.data?.users || []
    if (!list.length) return
    const totalSales = list.reduce((s: number, u: any) => s + (u.sales_amount || 0), 0)
    const avgScore = Math.round(
      list.reduce((s: number, u: any) => s + (u.performance_score || 0), 0) / list.length,
    )
    // 业绩之星: 按 sales 排, 同分按 score
    const top = [...list].sort((a: any, b: any) => {
      const sd = (b.sales_amount || 0) - (a.sales_amount || 0)
      return sd !== 0 ? sd : (b.performance_score || 0) - (a.performance_score || 0)
    })[0]
    perfStats.totalSales = totalSales
    perfStats.avgScore = avgScore
    perfStats.topPerformer = top
      ? { name: top.name, sales: top.sales_amount || 0, score: top.performance_score || 0 }
      : null
  } catch (e) {
    console.error('获取业绩统计失败', e)
  }
}

const stageChartRef = ref<HTMLDivElement>()
const hotChartRef = ref<HTMLDivElement>()

const formatTime = (isoStr: string) => {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

const fetchDashboard = async () => {
  try {
    const res = await request.get('/admin/stats/dashboard/summary')
    if (res.success) {
      Object.assign(summary, res.data)
      initCharts()
    }
  } catch (e) {
    console.error('获取看板数据失败', e)
  }
  await fetchPerfStats()
}

let stageChart: echarts.ECharts | null = null
let hotChart: echarts.ECharts | null = null
let bizLevelChart: echarts.ECharts | null = null
let bizMgtChart: echarts.ECharts | null = null

// 2026-08-14: 业务看板
const bizRange = ref<'month' | 'quarter' | 'year'>('month')
const bizData = ref<any>(null)
const bizLevelChartRef = ref<HTMLDivElement>()
const bizMgtChartRef = ref<HTMLDivElement>()
// 2026-08-14: 临门一脚 / M 升级机会 默认显示前 5 个, 点击"展开更多"看全部
const bizListLimit = 5
const bizExpanded = ref({ near: false, mgt: false })

const fetchBusiness = async () => {
  try {
    const res = await request.get('/admin/stats/business', { params: { range: bizRange.value } })
    if (res?.success) {
      bizData.value = res.data
      // 下一个 tick 等待 DOM ref 生效后再 init
      setTimeout(() => initBizCharts(), 0)
    }
  } catch (e) {
    console.error('获取业务看板失败', e)
  }
}

const progressColor = (pct: number) => {
  if (pct >= 95) return '#f56c6c'  // 红: 临门一脚紧急
  if (pct >= 85) return '#e6a23c'  // 橙
  return '#409eff'                 // 蓝
}

const rankClass = (i: number) => {
  if (i === 0) return 'rank-gold'
  if (i === 1) return 'rank-silver'
  if (i === 2) return 'rank-bronze'
  return 'rank-normal'
}

const initBizCharts = () => {
  if (!bizData.value) return
  const pieColors = ['#67c23a', '#409eff', '#9254de']
  const pieColors2 = ['#909399', '#67c23a', '#409eff', '#9254de']

  if (bizLevelChartRef.value) {
    if (!bizLevelChart) bizLevelChart = echarts.init(bizLevelChartRef.value)
    bizLevelChart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} 人 ({d}%)' },
      legend: { bottom: 0, textStyle: { color: '#666' } },
      series: [
        {
          name: 'L 等级',
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          data: [
            { value: bizData.value.level_distribution.L1, name: 'L1 初阶', itemStyle: { color: pieColors[0] } },
            { value: bizData.value.level_distribution.L2, name: 'L2 中阶', itemStyle: { color: pieColors[1] } },
            { value: bizData.value.level_distribution.L3, name: 'L3 高阶', itemStyle: { color: pieColors[2] } },
          ],
          label: { show: true, formatter: '{b}\n{c} 人', fontSize: 12 },
        },
      ],
    })
  }
  if (bizMgtChartRef.value) {
    if (!bizMgtChart) bizMgtChart = echarts.init(bizMgtChartRef.value)
    bizMgtChart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} 人 ({d}%)' },
      legend: { bottom: 0, textStyle: { color: '#666' } },
      series: [
        {
          name: 'M 等级',
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          data: [
            { value: bizData.value.management_distribution.M0, name: 'M0 未晋升', itemStyle: { color: pieColors2[0] } },
            { value: bizData.value.management_distribution.M1, name: 'M1', itemStyle: { color: pieColors2[1] } },
            { value: bizData.value.management_distribution.M2, name: 'M2', itemStyle: { color: pieColors2[2] } },
            { value: bizData.value.management_distribution.M3, name: 'M3', itemStyle: { color: pieColors2[3] } },
          ],
          label: { show: true, formatter: '{b}\n{c} 人', fontSize: 12 },
        },
      ],
    })
  }
}

const initCharts = () => {
  if (stageChartRef.value && summary.stage_distribution.length) {
    stageChart = echarts.init(stageChartRef.value)
    stageChart.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: summary.stage_distribution.map((s) => s.name),
        axisLabel: { color: '#666' },
      },
      yAxis: { type: 'value', axisLabel: { color: '#666' } },
      series: [
        {
          type: 'bar',
          data: summary.stage_distribution.map((s) => s.count),
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#409eff' },
              { offset: 1, color: '#79bbff' },
            ]),
            borderRadius: [4, 4, 0, 0],
          },
          barWidth: '40%',
        },
      ],
      grid: { left: 50, right: 20, top: 20, bottom: 30 },
    })
  }

  if (hotChartRef.value && summary.top_courses.length) {
    hotChart = echarts.init(hotChartRef.value)
    const sorted = [...summary.top_courses].sort((a, b) => b.view_count - a.view_count)
    hotChart.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'value',
        axisLabel: { color: '#666' },
      },
      yAxis: {
        type: 'category',
        data: sorted.map((c) => c.title.replace(/《|》/g, '')).slice(0, 5).reverse(),
        axisLabel: { color: '#666', fontSize: 12 },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((c) => c.view_count).slice(0, 5).reverse(),
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: '#67c23a' },
              { offset: 1, color: '#95d475' },
            ]),
            borderRadius: [0, 4, 4, 0],
          },
          barWidth: '50%',
        },
      ],
      grid: { left: 140, right: 40, top: 10, bottom: 30 },
    })
  }
}

const handleResize = () => {
  stageChart?.resize()
  hotChart?.resize()
  bizLevelChart?.resize()
  bizMgtChart?.resize()
}

onMounted(() => {
  fetchDashboard()
  fetchBusiness()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  stageChart?.dispose()
  stageChart = null
  hotChart?.dispose()
  hotChart = null
  bizLevelChart?.dispose()
  bizLevelChart = null
  bizMgtChart?.dispose()
  bizMgtChart = null
})
</script>

<style scoped>
.dashboard-container {
  padding: 0;
}

.stat-cards {
  margin-bottom: 20px;
}

.stat-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.stat-primary { border-left: 4px solid #409eff; }
.stat-success { border-left: 4px solid #67c23a; }
.stat-gold { border-left: 4px solid #e6a23c; }
.stat-purple { border-left: 4px solid #9254de; }
.stat-rose { border-left: 4px solid #f78989; }
.top-sub { margin-left: 6px; color: #e6a23c; font-weight: 600; font-size: 12px; }
.stat-warning { border-left: 4px solid #e6a23c; }
.stat-danger  { border-left: 4px solid #f56c6c; }

.stat-icon {
  color: #c0c4cc;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: #303133;
  line-height: 1;
}

.stat-label {
  font-size: 13px;
  color: #909399;
  margin-top: 6px;
}

.charts-row {
  margin-bottom: 20px;
}

.chart-card {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.chart-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f0f0f0;
}

.chart-container {
  width: 100%;
  height: 280px;
}

.activity-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.activity-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
}

.activity-item {
  border: none !important;
  padding: 8px 12px !important;
}

.activity-content {
  display: flex;
  align-items: center;
  gap: 10px;
}

.activity-avatar {
  background: #409eff;
  color: #fff;
  flex-shrink: 0;
}

.activity-text {
  font-size: 13px;
  color: #606266;
  line-height: 1.5;
}

.activity-name {
  color: #409eff;
  font-weight: 600;
  margin-right: 4px;
}

.activity-action {
  color: #909399;
  margin-right: 4px;
}

.activity-course {
  color: #303133;
  font-weight: 500;
}

/* ===== 2026-08-14: 业务看板 ===== */
.business-dashboard {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.biz-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #f0f0f0;
}

.biz-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.biz-lists {
  margin-bottom: 20px;
}

.empty-hint {
  color: #909399;
  font-size: 13px;
  padding: 32px 16px;
  text-align: center;
}

.biz-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 360px;
  overflow-y: auto;
}

.biz-toggle {
  align-self: center;
  margin-top: 4px;
}

.biz-list-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px;
  border-radius: 6px;
  background: #fafbfc;
}

.biz-list-main {
  flex: 1;
  min-width: 0;
}

.biz-list-row1 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.biz-list-name {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.biz-list-row2 {
  font-size: 12px;
  color: #606266;
  margin-bottom: 6px;
}

/* Top 10 业绩卡片 */
.top-grid {
  margin-top: 4px;
}

.top-col {
  margin-bottom: 12px;
}

.top-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  background: #fafbfc;
  border: 1px solid #f0f0f0;
  transition: all 0.2s;
}

.top-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.top-rank {
  font-size: 14px;
  font-weight: 700;
  color: #909399;
  width: 28px;
  flex-shrink: 0;
}

.top-info {
  flex: 1;
  min-width: 0;
}

.top-name {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.top-meta {
  font-size: 11px;
  color: #909399;
  margin: 2px 0;
}

.top-amount {
  font-size: 14px;
  font-weight: 700;
  color: #e6a23c;
}

.rank-gold {
  background: linear-gradient(135deg, #fff7e6, #ffeac2);
  border-color: #e6a23c;
}

.rank-gold .top-rank { color: #e6a23c; }

.rank-silver {
  background: linear-gradient(135deg, #f4f4f5, #e9e9eb);
  border-color: #909399;
}

.rank-silver .top-rank { color: #606266; }

.rank-bronze {
  background: linear-gradient(135deg, #fef0e6, #fcd9b6);
  border-color: #d99a5b;
}

.rank-bronze .top-rank { color: #d99a5b; }
</style>
