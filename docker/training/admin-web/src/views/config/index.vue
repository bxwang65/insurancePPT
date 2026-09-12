<template>
  <div class="config-container">
    <div class="toolbar">
      <el-button @click="reload">刷新</el-button>
      <span class="warning-tip">⚠️ 修改后立即生效, 影响所有 L/M 评估与佣金计算</span>
    </div>

    <el-table :data="rows" border stripe>
      <el-table-column label="配置" min-width="280">
        <template #default="{ row }">
          <div class="key-cell">
            <div class="key-name">{{ row.key }}</div>
            <div v-if="keyHint(row.key)" class="key-hint">{{ keyHint(row.key) }}</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="当前值" min-width="420">
        <template #default="{ row }">
          <div class="value-rows">
            <div v-for="(r, i) in renderConfigValue(row.key, row.value)" :key="i" class="value-row">
              <span class="value-label">
                {{ r.label }}
                <span v-if="r.unit" class="value-unit">{{ r.unit }}</span>
              </span>
              <span class="value-val">{{ r.value }}</span>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="updated_at" label="更新时间" width="180">
        <template #default="{ row }">{{ formatDateTime(row.updated_at) }}</template>
      </el-table-column>
      <el-table-column prop="updated_by" label="更新人" width="140" />
      <el-table-column label="操作" width="80" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="`编辑配置: ${editingRow?.key}`" width="600px">
      <el-form label-width="100px">
        <el-form-item label="说明">
          <div class="hint">{{ keyHint(editingRow?.key) }}</div>
        </el-form-item>
        <el-form-item label="值 (JSON)">
          <el-input
            v-model="editValueStr"
            type="textarea"
            :rows="14"
            spellcheck="false"
            style="font-family: 'SF Mono', monospace; font-size: 12px;"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'
import { renderConfigValue } from '@/views/shared/renderConfig'

const API_CONFIG = '/admin/config'

const rows = ref<any[]>([])
const dialogVisible = ref(false)
const editingRow = ref<any>(null)
const editValueStr = ref('')
const saving = ref(false)

const formatJson = (v: any) => JSON.stringify(v, null, 2)
const formatDateTime = (iso: string) => iso ? iso.replace('T', ' ').slice(0, 19) : ''

const keyHint = (key: string): string => {
  return {
    L_PROMOTE_HK: 'HK 港险 L 升级阈值 (USD 标保): 任一字段达标即升级',
    L_PROMOTE_SG: 'SG 新加坡 L 升级阈值 (TP)',
    M_PROMOTE: 'M 升级阈值 (招募树 2 级穿透 + 直接招募人数量)',
    RECRUITER_RATES: '招募奖比例 (HK/SG 2 级封顶, ART_BONUS)',
    MGMT_RATES: '管理奖比例 (管理链 2 级封顶)',
    ART_RATES: 'ART 销售者本人提成 (近现代/当代)',
    COMMISSION_TABLE_VERSION: '费用表版本号 (PENDING = 待上传)',
  }[key] ?? ''
}

const reload = async () => {
  try {
    const res: any = await request.get(API_CONFIG)
    const data = res?.data ?? res ?? {}
    rows.value = Object.entries(data).map(([k, v]) => ({ key: k, value: v, updated_at: '-', updated_by: '-' }))
  } catch (e: any) {
    ElMessage.error('加载失败: ' + (e.message || ''))
  }
}

const openEdit = (row: any) => {
  editingRow.value = row
  editValueStr.value = formatJson(row.value)
  dialogVisible.value = true
}

const saveEdit = async () => {
  if (!editingRow.value) return
  let parsed: any
  try {
    parsed = JSON.parse(editValueStr.value)
  } catch {
    ElMessage.error('JSON 格式错误')
    return
  }
  saving.value = true
  try {
    await request.put(`${API_CONFIG}/${editingRow.value.key}`, { value: parsed })
    ElMessage.success('已保存')
    dialogVisible.value = false
    reload()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => reload())
</script>

<style scoped>
.config-container { background: #fff; border-radius: 8px; padding: 20px; }
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; }
.warning-tip { color: #e6a23c; font-size: 13px; }
.json-preview {
  font-family: 'SF Mono', monospace;
  font-size: 12px;
  color: #303133;
  background: #fafbfc;
  padding: 8px;
  border-radius: 4px;
  margin: 0;
  max-height: 100px;
  overflow: auto;
}
.key-cell { display: flex; flex-direction: column; gap: 2px; }
.key-name { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 13px; color: #303133; font-weight: 500; }
.key-hint { font-size: 12px; color: #909399; line-height: 1.5; }
.value-rows { display: flex; flex-direction: column; gap: 4px; }
.value-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; line-height: 1.6; }
.value-label { color: #606266; }
.value-unit { color: #909399; font-size: 11px; margin-left: 4px; }
.value-val { color: #303133; font-weight: 500; font-family: 'SF Mono', Menlo, Consolas, monospace; }
.hint {
  font-size: 13px;
  color: #909399;
  background: #f4f4f5;
  padding: 8px 12px;
  border-radius: 4px;
  border-left: 3px solid #409eff;
}
</style>