<template>
  <div class="tree-container">
    <div class="toolbar">
      <el-select
        v-model="selectedUserId"
        placeholder="选择员工查看推管树"
        filterable
        style="width: 280px"
        @change="fetchTree"
      >
        <el-option
          v-for="u in allUsers"
          :key="u.id"
          :label="`${u.name} (${u.phone || ''})`"
          :value="u.id"
        />
      </el-select>
      <el-button :disabled="!tree" @click="downloadScreenshot">导出 PNG</el-button>
    </div>

    <div v-if="!tree" class="empty-tip">
      请选择员工查看其推管树 (招募链 + 管理链 + 后代 + 团队业绩)
    </div>

    <div v-else class="tree-content" ref="canvasRef">
        <!-- 中心人物卡片 -->
        <div class="center-card">
          <el-avatar :size="72" :src="tree.user.avatar_url" class="center-avatar">
            {{ tree.user.name.slice(0, 1) }}
          </el-avatar>
          <div class="center-info">
            <div class="center-name">{{ tree.user.name }}</div>
            <div class="center-tags">
              <el-tag type="primary" size="small">L{{ tree.user.current_level }}</el-tag>
              <el-tag type="warning" size="small">M{{ tree.user.current_management_level }}</el-tag>
              <el-tag v-if="tree.user.main_product" size="small">{{ tree.user.main_product }}</el-tag>
            </div>
            <div class="center-meta">入职: {{ formatDate(tree.user.joined_at) }}</div>
          </div>
        </div>

        <!-- 团队业绩卡片 -->
        <div class="metric-card">
          <div class="metric-title">招募树 2 级穿透业绩 (近 6 月)</div>
          <div class="metric-grid">
            <div class="metric-item">
              <div class="metric-value">{{ tree.tree_metrics.direct_recruits }}</div>
              <div class="metric-label">直接招募人</div>
            </div>
            <div class="metric-item">
              <div class="metric-value">${{ formatNum(tree.tree_metrics.tree_2level_total_6m) }}</div>
              <div class="metric-label">合计标保 (HK+SG)</div>
            </div>
            <div class="metric-item">
              <div class="metric-value">${{ formatNum(tree.tree_metrics.tree_2level_HK_6m) }}</div>
              <div class="metric-label">HK 标保</div>
            </div>
            <div class="metric-item">
              <div class="metric-value">TP{{ formatNum(tree.tree_metrics.tree_2level_SG_6m) }}</div>
              <div class="metric-label">SG TP</div>
            </div>
          </div>
        </div>

        <!-- 三栏: 招募链 / 管理链 / 后代 -->
        <div class="tree-grid">
          <!-- 招募链 (向上) -->
          <div class="tree-col">
            <div class="tree-col-title">招募链 (向上 2 级)</div>
            <div v-if="!tree.recruiter_chain.length" class="empty-small">无招募人 (顶层)</div>
            <div
              v-for="node in tree.recruiter_chain"
              :key="`r-${node.id}`"
              class="chain-node"
            >
              <el-avatar :size="36" :src="node.avatar_url">{{ node.name.slice(0, 1) }}</el-avatar>
              <div class="chain-info">
                <div class="chain-name">{{ node.name }}</div>
                <div class="chain-tags">
                  <el-tag size="small" type="primary">L{{ node.current_level }}</el-tag>
                  <el-tag size="small" type="warning">M{{ node.current_management_level }}</el-tag>
                  <span class="chain-depth">第 {{ node.depth }} 级招募人</span>
                </div>
              </div>
              <div class="chain-arrow" v-if="node.depth < 2 && node.depth === tree.recruiter_chain.length">↑</div>
            </div>
          </div>

          <!-- 管理链 (向上) -->
          <div class="tree-col">
            <div class="tree-col-title">管理链 (向上 2 级)</div>
            <div v-if="!tree.manager_chain.length" class="empty-small">无主管 (顶层)</div>
            <div
              v-for="node in tree.manager_chain"
              :key="`m-${node.id}`"
              class="chain-node"
            >
              <el-avatar :size="36" :src="node.avatar_url">{{ node.name.slice(0, 1) }}</el-avatar>
              <div class="chain-info">
                <div class="chain-name">{{ node.name }}</div>
                <div class="chain-tags">
                  <el-tag size="small" type="primary">L{{ node.current_level }}</el-tag>
                  <el-tag size="small" type="warning">M{{ node.current_management_level }}</el-tag>
                  <span class="chain-depth">第 {{ node.depth }} 级主管</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 后代 (向下) -->
          <div class="tree-col">
            <div class="tree-col-title">直接后代 (招募/管理)</div>
            <div v-if="!tree.recruited.length && !tree.manages.length" class="empty-small">无下属</div>
            <div
              v-for="node in [...tree.recruited, ...tree.manages.filter((m: any) => !tree.recruited.find((r: any) => r.id === m.id))]"
              :key="`d-${node.id}`"
              class="chain-node"
            >
              <el-avatar :size="36" :src="node.avatar_url">{{ node.name.slice(0, 1) }}</el-avatar>
              <div class="chain-info">
                <div class="chain-name">{{ node.name }}</div>
                <div class="chain-tags">
                  <el-tag size="small" type="primary">L{{ node.current_level }}</el-tag>
                  <el-tag size="small" type="warning">M{{ node.current_management_level }}</el-tag>
                  <span class="chain-date">{{ formatDate(node.joined_at) }} 入职</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'
import html2canvas from 'html2canvas'

const API_TREE = '/admin/users'
const API_USERS = '/admin/users'

const selectedUserId = ref<string>('')
const allUsers = ref<{ id: string; name: string; phone: string }[]>([])
const tree = ref<any>(null)
const canvasRef = ref<HTMLDivElement>()

const formatNum = (n: number) => (n ?? 0).toLocaleString()
const formatDate = (iso: string) => iso ? iso.split('T')[0] : ''

const fetchUsers = async () => {
  const res: any = await request.get(API_USERS, { params: { limit: 1000 } })
  allUsers.value = (res?.data?.users ?? res?.users ?? []).map((u: any) => ({
    id: u.id, name: u.name, phone: u.phone,
  }))
}

const fetchTree = async () => {
  if (!selectedUserId.value) { tree.value = null; return }
  try {
    const res: any = await request.get(`${API_TREE}/${selectedUserId.value}/tree`)
    tree.value = res?.data ?? res
  } catch (e: any) {
    ElMessage.error('获取推管树失败')
  }
}

const downloadScreenshot = async () => {
  if (!canvasRef.value) return
  try {
    const canvas = await html2canvas(canvasRef.value, { backgroundColor: '#f4f7fb', scale: 2 })
    const link = document.createElement('a')
    link.href = canvas.toDataURL('image/png')
    link.download = `tree-${tree.value?.user?.name ?? 'user'}.png`
    link.click()
  } catch {
    ElMessage.error('截图失败 (可能 html2canvas 未安装, 请 npm i html2canvas)')
  }
}

onMounted(async () => {
  await fetchUsers()
  // 优先 sessionStorage 传来的 focus (从学员档案跳转)
  const focusId = sessionStorage.getItem('tree_focus_user_id')
  if (focusId) {
    selectedUserId.value = focusId
    await fetchTree()
    sessionStorage.removeItem('tree_focus_user_id')
  }
})
</script>

<style scoped>
.tree-container { background: #fff; border-radius: 8px; padding: 20px; }
.toolbar { display: flex; gap: 12px; margin-bottom: 20px; }
.empty-tip { padding: 80px 0; text-align: center; color: #909399; }
.tree-content { display: flex; flex-direction: column; gap: 20px; }
.center-card {
  background: linear-gradient(135deg, #409eff, #79bbff);
  border-radius: 12px;
  padding: 24px;
  display: flex;
  gap: 20px;
  align-items: center;
  color: #fff;
}
.center-avatar { background: rgba(255,255,255,0.3); font-size: 28px; }
.center-name { font-size: 22px; font-weight: 700; }
.center-tags { display: flex; gap: 6px; margin: 6px 0; }
.center-tags .el-tag { background: rgba(255,255,255,0.9); }
.center-meta { font-size: 12px; opacity: 0.85; }
.metric-card {
  background: #fafbfc;
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #f0f0f0;
}
.metric-title { font-size: 14px; font-weight: 600; color: #303133; margin-bottom: 16px; }
.metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.metric-item { text-align: center; background: #fff; border-radius: 8px; padding: 16px 8px; }
.metric-value { font-size: 22px; font-weight: 700; color: #409eff; font-family: 'SF Mono', monospace; }
.metric-label { font-size: 12px; color: #909399; margin-top: 4px; }
.tree-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
.tree-col {
  background: #fafbfc;
  border-radius: 12px;
  padding: 16px;
  border: 1px solid #f0f0f0;
}
.tree-col-title { font-size: 14px; font-weight: 600; color: #303133; margin-bottom: 12px; }
.empty-small { padding: 20px 0; text-align: center; color: #c0c4cc; font-size: 13px; }
.chain-node {
  display: flex;
  gap: 12px;
  align-items: center;
  background: #fff;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
  border: 1px solid #f0f0f0;
}
.chain-name { font-weight: 600; color: #303133; font-size: 14px; }
.chain-tags { display: flex; gap: 4px; margin-top: 4px; align-items: center; }
.chain-depth, .chain-date { font-size: 11px; color: #909399; margin-left: 4px; }
.chain-arrow { font-size: 20px; color: #409eff; }
</style>