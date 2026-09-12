<template>
  <div class="level-container">
    <div class="toolbar">
      <el-button type="primary" :loading="evaluating" @click="evaluateAll">
        <el-icon><Refresh /></el-icon> 全员重评
      </el-button>
      <el-select
        v-model="selectedUserId"
        placeholder="查某人的等级历史"
        filterable
        clearable
        style="width: 240px"
        @change="fetchHistory"
      >
        <el-option v-for="u in allUsers" :key="u.id" :label="u.name" :value="u.id" />
      </el-select>
      <el-button v-if="selectedUserId" @click="evaluateOne">单用户重评</el-button>
    </div>

    <!-- 等级分布 -->
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-title">L 业务等级分布</div>
        <div class="summary-list">
          <div v-for="b in summary.by_level" :key="`l-${b.level}`" class="summary-row">
            <span class="level-badge" :class="`l${b.level}`">L{{ b.level }}</span>
            <span class="summary-count">{{ b.count }} 人</span>
          </div>
        </div>
      </div>
      <div class="summary-card">
        <div class="summary-title">M 管理等级分布</div>
        <div class="summary-list">
          <div v-for="b in summary.by_management_level" :key="`m-${b.level}`" class="summary-row">
            <span class="level-badge mgmt" :class="`m${b.level}`">M{{ b.level }}</span>
            <span class="summary-count">{{ b.count }} 人</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 阈值/比例 (只读展示) -->
    <div class="config-preview">
      <div class="config-title">基本法阈值 (来自 Config 表)</div>
      <div class="config-sections">
        <div v-for="sec in configSections" :key="sec.key" class="config-section">
          <div class="config-section-title">{{ sec.title }}</div>
          <div class="config-rows">
            <div v-for="(r, i) in sec.rows" :key="i" class="config-row">
              <span class="config-label">
                {{ r.label }}
                <span v-if="r.unit" class="config-unit">{{ r.unit }}</span>
              </span>
              <span class="config-value">{{ r.value }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 全员评估结果 (如果跑过 evaluate-all) -->
    <div v-if="evalResults.length" class="eval-results">
      <div class="eval-title">上次评估结果 ({{ evalResults.length }} 人, 升级 {{ promoted }}, 降级 {{ demoted }}, pending {{ pendingCount }})</div>
      <el-table :data="evalResults" border stripe max-height="500">
        <el-table-column prop="user_id" label="user_id" width="220" />
        <el-table-column label="L 变更" width="120">
          <template #default="{ row }">
            <span class="level-old">{{ row.old_level }}</span>
            →
            <span class="level-new">{{ row.new_level }}</span>
          </template>
        </el-table-column>
        <el-table-column label="M 变更" width="120">
          <template #default="{ row }">
            <span class="level-old">{{ row.old_mgmt_level }}</span>
            →
            <span class="level-new">{{ row.new_mgmt_level }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="结果" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="getReasonType(row.reason)">{{ row.reason }}</el-tag>
          </template>
        </el-table-column>
        <!-- 2026-08-16: Phase 7 — pending 显示 -->
        <el-table-column label="Pending (次月生效)" min-width="220">
          <template #default="{ row }">
            <template v-if="row.pending_level !== null || row.pending_management_level !== null">
              <el-tag v-if="row.pending_level !== null && row.pending_level !== undefined" size="small" :type="row.pending_level > row.old_level ? 'success' : 'danger'">
                L → {{ row.pending_level }} ({{ formatDate(row.pending_effective_at) }})
              </el-tag>
              <el-tag v-if="row.pending_management_level !== null && row.pending_management_level !== undefined" size="small" :type="row.pending_management_level > row.old_mgmt_level ? 'success' : 'danger'" style="margin-left: 4px;">
                M → {{ row.pending_management_level }}
              </el-tag>
            </template>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="上下文 (近6月业绩)" min-width="300">
          <template #default="{ row }">
            <span class="ctx-line">HK {{ formatNum(row.context.recent_6m_HK) }} | SG {{ formatNum(row.context.recent_6m_SG) }} | 后代 {{ row.context.direct_recruits }} 人 | 团队 {{ formatNum(row.context.tree_2level_total_6m) }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 单用户 LevelHistory -->
    <div v-if="history.length" class="history-section">
      <div class="history-title">等级变更历史 ({{ history.length }} 条)</div>
      <el-table :data="history" border stripe>
        <el-table-column prop="eval_at" label="评估时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.eval_at) }}</template>
        </el-table-column>
        <el-table-column prop="level" label="L" width="60" />
        <el-table-column prop="mgmt_level" label="M" width="60" />
        <el-table-column label="窗口" width="220">
          <template #default="{ row }">
            {{ formatDate(row.window_start) }} ~ {{ formatDate(row.window_end) }}
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="原因" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="getReasonType(row.reason)">{{ row.reason }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="trigger" label="触发" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.trigger === 'CRON' ? 'info' : 'warning'">{{ row.trigger }}</el-tag>
          </template>
        </el-table-column>
        <!-- 2026-08-16: Phase 7 — effective_at + status 列 -->
        <el-table-column label="生效时间" width="120">
          <template #default="{ row }">
            {{ row.effective_at ? formatDate(row.effective_at) : '—' }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="getStatusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'
import { renderConfigSections } from '@/views/shared/renderConfig'

const API_LEVEL = '/admin/level'
const API_CONFIG = '/admin/config'
const API_USERS = '/admin/users'

const summary = reactive<{ by_level: any[]; by_management_level: any[] }>({ by_level: [], by_management_level: [] })
const thresholds = ref<any>({})
const configSections = computed(() => renderConfigSections(thresholds.value ?? {}))
const evalResults = ref<any[]>([])
const promoted = ref(0)
const demoted = ref(0)
const evaluating = ref(false)

const allUsers = ref<{ id: string; name: string }[]>([])
const selectedUserId = ref<string>('')
const history = ref<any[]>([])

const formatNum = (n: number) => (n ?? 0).toLocaleString()
const formatDate = (iso: string) => iso ? iso.slice(0, 10) : ''
const formatDateTime = (iso: string) => iso ? iso.replace('T', ' ').slice(0, 16) : ''

const getReasonType = (r: string) => {
  return { PROMOTE: 'success', DEMOTE: 'danger', MAINTAIN: 'info', INITIAL: '' }[r] ?? ''
}

const pendingCount = computed(
  () => evalResults.value.filter((r: any) => r.pending_level !== null || r.pending_management_level !== null).length,
)
const getStatusType = (s: string) => ({ STAGED: 'warning', COMMITTED: 'success', CANCELLED: 'info' }[s] ?? '')
const statusLabel = (s: string) => ({ STAGED: '待生效', COMMITTED: '已生效', CANCELLED: '已撤回' }[s] ?? s)

const fetchSummary = async () => {
  try {
    const res: any = await request.get(`${API_LEVEL}/summary`)
    Object.assign(summary, res?.data ?? { by_level: [], by_management_level: [] })
  } catch { /* noop */ }
}

const fetchConfig = async () => {
  try {
    const res: any = await request.get(API_CONFIG)
    thresholds.value = res?.data ?? {}
  } catch { /* noop */ }
}

const fetchUsers = async () => {
  const res: any = await request.get(API_USERS, { params: { limit: 1000 } })
  allUsers.value = (res?.data?.users ?? res?.users ?? []).map((u: any) => ({ id: u.id, name: u.name }))
}

const evaluateAll = async () => {
  evaluating.value = true
  try {
    const res: any = await request.post(`${API_LEVEL}/evaluate-all`)
    const data = res?.data ?? res
    evalResults.value = data.results ?? []
    promoted.value = data.promoted ?? 0
    demoted.value = data.demoted ?? 0
    ElMessage.success(`评估完成: ${evalResults.value.length} 人, 升级 ${promoted.value}, 降级 ${demoted.value}`)
    fetchSummary()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '评估失败')
  } finally {
    evaluating.value = false
  }
}

const evaluateOne = async () => {
  if (!selectedUserId.value) return
  try {
    const res: any = await request.post(`${API_LEVEL}/evaluate/${selectedUserId.value}`)
    const r = res?.data ?? res
    ElMessage.success(`评估完成: L ${r.old_level}→${r.new_level}, M ${r.old_mgmt_level}→${r.new_mgmt_level}, ${r.reason}`)
    fetchHistory()
    fetchSummary()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '评估失败')
  }
}

const fetchHistory = async () => {
  if (!selectedUserId.value) { history.value = []; return }
  try {
    const res: any = await request.get(`${API_USERS}/${selectedUserId.value}/level-history`)
    history.value = res?.data ?? []
  } catch {
    history.value = []
  }
}

onMounted(() => {
  fetchSummary()
  fetchConfig()
  fetchUsers()
})
</script>

<style scoped>
.level-container { background: #fff; border-radius: 8px; padding: 20px; }
.toolbar { display: flex; gap: 12px; margin-bottom: 20px; align-items: center; }
.summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
.summary-card { background: #fafbfc; border-radius: 12px; padding: 20px; border: 1px solid #f0f0f0; }
.summary-title { font-size: 14px; font-weight: 600; color: #303133; margin-bottom: 12px; }
.summary-list { display: flex; gap: 20px; }
.summary-row { display: flex; align-items: center; gap: 6px; }
.summary-count { font-size: 13px; color: #606266; }
.level-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-weight: 600;
  font-size: 13px;
}
.level-badge.l1 { background: #ecf5ff; color: #409eff; }
.level-badge.l2 { background: #fdf6ec; color: #e6a23c; }
.level-badge.l3 { background: #fef0f0; color: #f56c6c; }
.level-badge.mgmt { background: #f0f9eb; color: #67c23a; }
.level-badge.m1 { background: #f0f9eb; color: #67c23a; }
.level-badge.m2 { background: #fdf6ec; color: #e6a23c; }
.level-badge.m3 { background: #fef0f0; color: #f56c6c; }
.config-preview { background: #fafbfc; border-radius: 8px; padding: 16px; border: 1px solid #f0f0f0; margin-bottom: 20px; }
.config-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; }
.config-sections { display: flex; flex-direction: column; gap: 12px; }
.config-section { background: #fff; border-radius: 6px; padding: 10px 12px; border: 1px solid #ebeef5; }
.config-section-title { font-size: 12px; font-weight: 600; color: #409eff; margin-bottom: 6px; }
.config-rows { display: flex; flex-direction: column; gap: 4px; }
.config-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; line-height: 1.6; }
.config-label { color: #606266; }
.config-unit { color: #909399; font-size: 11px; margin-left: 4px; }
.config-value { color: #303133; font-weight: 500; font-family: 'SF Mono', Menlo, Consolas, monospace; }
.eval-results, .history-section { margin-top: 20px; }
.eval-title, .history-title { font-size: 14px; font-weight: 600; color: #303133; margin-bottom: 12px; }
.level-old { color: #909399; }
.level-new { color: #409eff; font-weight: 600; }
.ctx-line { font-family: 'SF Mono', monospace; font-size: 12px; color: #606266; }
</style>