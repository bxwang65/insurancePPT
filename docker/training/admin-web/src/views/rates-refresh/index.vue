<template>
  <div class="rates-refresh-container">
    <el-card shadow="never" class="form-card">
      <template #header>
        <div class="card-header">
          <span class="card-title">🔄 季度佣金率刷新</span>
          <el-tag size="small" type="warning">Phase 4 · 仅管理员</el-tag>
        </div>
      </template>

      <el-alert
        :title="`流程: 上传 10 PDF + 1 CSV → 暂存 → 校准 (${pdfList.length + 1} 文件就绪后开始)`"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 16px;"
      />

      <el-form :model="form" :rules="rules" ref="formRef" label-width="120px">
        <el-row :gutter="16">
          <el-col :xs="24" :sm="12">
            <el-form-item label="季度标识" prop="quarter">
              <el-input
                v-model="form.quarter"
                placeholder="2026Q4"
                :disabled="running"
              >
                <template #append>
                  <el-tooltip content="形如 2026Q4 / 2027Q1, 跟历史归档命名一致" placement="top">
                    <el-icon><QuestionFilled /></el-icon>
                  </el-tooltip>
                </template>
              </el-input>
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="12">
            <el-form-item label="生效日期" prop="effective_from">
              <el-date-picker
                v-model="form.effective_from"
                type="date"
                value-format="YYYY-MM-DD"
                format="YYYY-MM-DD"
                placeholder="选择 PDF 生效日期"
                :disabled="running"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">10 个 PDF 费率表</el-divider>

        <el-row :gutter="16">
          <el-col v-for="p in pdfList" :key="p.field" :xs="24" :sm="12" :md="8">
            <el-form-item :label="p.label">
              <el-upload
                :show-file-list="false"
                :before-upload="makeBeforePdfUpload(p.field)"
                :http-request="makeHttpRequest(p.field, true)"
                accept=".pdf"
                :disabled="running"
              >
                <el-button :type="form.pdfs[p.field] ? 'success' : 'primary'" plain :disabled="running">
                  <el-icon><Upload /></el-icon>
                  <span>{{ form.pdfs[p.field]?.name || '选择 PDF' }}</span>
                </el-button>
              </el-upload>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">参考表 CSV (季度对账用)</el-divider>

        <el-form-item label="参考表">
          <el-upload
            :show-file-list="false"
            :before-upload="beforeCsvUpload"
            :http-request="makeHttpRequest('csv', false)"
            accept=".csv"
            :disabled="running"
          >
            <el-button :type="form.csv ? 'success' : 'primary'" plain :disabled="running">
              <el-icon><Document /></el-icon>
              <span>{{ form.csv?.name || '选择 CSV' }}</span>
            </el-button>
          </el-upload>
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            :loading="uploading"
            :disabled="!canUpload || running"
            @click="onUpload"
          >
            <el-icon><UploadFilled /></el-icon>
            <span>上传文件到暂存</span>
          </el-button>

          <el-button
            type="success"
            :loading="running"
            :disabled="!canStartCalibrate || uploading"
            @click="onCalibrate"
            style="margin-left: 12px;"
          >
            <el-icon><VideoPlay /></el-icon>
            <span>{{ running ? '校准中...' : '开始校准' }}</span>
          </el-button>

          <span v-if="lastUploadAt" class="upload-info">
            上次上传: {{ lastUploadAt }} · {{ uploadPath }}
          </span>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 校准日志区 -->
    <el-card
      v-if="runId || running"
      shadow="never"
      class="log-card"
      style="margin-top: 16px;"
    >
      <template #header>
        <div class="card-header">
          <span class="card-title">📋 校准日志</span>
          <el-tag v-if="runStatus === 'pass'" type="success" size="small">PASS</el-tag>
          <el-tag v-else-if="runStatus === 'fail'" type="danger" size="small">FAIL</el-tag>
          <el-tag v-else-if="runStatus === 'running'" type="warning" size="small">运行中</el-tag>
        </div>
      </template>

      <el-alert
        v-if="runStatus === 'pass'"
        title="✅ 校准成功 — 新佣金率已生效, 可在 [佣金费率查询] 页验证"
        type="success"
        :closable="false"
        show-icon
        style="margin-bottom: 12px;"
      />
      <el-alert
        v-else-if="runStatus === 'fail'"
        title="❌ 校准失败 — 看下方日志里的 ✗ 项, 修复后再上传"
        type="error"
        :closable="false"
        show-icon
        style="margin-bottom: 12px;"
      />

      <pre ref="logRef" class="log-pre">{{ logText }}</pre>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onBeforeUnmount, nextTick } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import {
  Upload, UploadFilled, Document, VideoPlay, QuestionFilled,
} from '@element-plus/icons-vue'
import request from '@/utils/request'

// 10 PDF form field 映射 (跟 server.ts 一致)
interface PdfSlot {
  field: string
  filename: string  // 服务器端期望的目标文件名
  label: string     // UI 显示名
}
const pdfList: PdfSlot[] = [
  { field: 'pdf_npi_L1',      filename: '7月HXNPI费率表L1.pdf',      label: 'NPI L1' },
  { field: 'pdf_npi_L2',      filename: '7月HXNPI费率表L2.pdf',      label: 'NPI L2' },
  { field: 'pdf_npi_L3',      filename: '7月HXNPI费率表L3.pdf',      label: 'NPI L3' },
  { field: 'pdf_npi_direct',  filename: '7月HXNPI费率表直接伯乐.pdf', label: 'NPI 直接伯乐' },
  { field: 'pdf_npi_indirect',filename: '7月HXNPI费率表间接伯乐.pdf', label: 'NPI 间接伯乐' },
  { field: 'pdf_pi_L1',       filename: '7月HXPI费率表L1.pdf',       label: 'PI L1' },
  { field: 'pdf_pi_L2',       filename: '7月HXPI费率表L2.pdf',       label: 'PI L2' },
  { field: 'pdf_pi_L3',       filename: '7月HXPI费率表L3.pdf',       label: 'PI L3' },
  { field: 'pdf_pi_direct',   filename: '7月HXPI费率表直接伯乐.pdf',  label: 'PI 直接伯乐' },
  { field: 'pdf_pi_indirect', filename: '7月HXPI费率表间接伯乐.pdf',  label: 'PI 间接伯乐' },
]

const formRef = ref<FormInstance>()
const logRef = ref<HTMLPreElement>()

const form = reactive({
  quarter: '',
  effective_from: new Date().toISOString().slice(0, 10),  // 默认今天
  pdfs: {} as Record<string, File | null>,
  csv: null as File | null,
})

const rules = reactive<FormRules>({
  quarter: [
    { required: true, message: '请输入季度标识', trigger: 'blur' },
    { pattern: /^\d{4}Q[1-4]$/, message: '必须形如 2026Q4 (Q1~Q4)', trigger: 'blur' },
  ],
  effective_from: [
    { required: true, message: '请选择生效日期', trigger: 'change' },
  ],
})

// 已选齐 10 PDF + 1 CSV
const canUpload = computed(() =>
  /^\d{4}Q[1-4]$/.test(form.quarter)
  && /^\d{4}-\d{2}-\d{2}$/.test(form.effective_from)
  && pdfList.every(p => form.pdfs[p.field])
  && form.csv
)

// 已上传过 (lastUploadAt 已填) 才能开始校准
const lastUploadAt = ref('')
const uploadPath = ref('')
const canStartCalibrate = computed(() => lastUploadAt.value !== '')

const uploading = ref(false)
const running = ref(false)
const runId = ref('')
const runStatus = ref('')  // '' | 'running' | 'pass' | 'fail'
const logText = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null

function beforePdfUpload(file: File, field: string): boolean {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    ElMessage.error(`${field} 必须是 PDF`)
    return false
  }
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.error(`${field} 大于 10MB`)
    return false
  }
  return true  // 阻止 el-upload 默认上传, 走 http-request
}

function beforeCsvUpload(file: File): boolean {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    ElMessage.error('参考表必须是 CSV')
    return false
  }
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.error('CSV 大于 5MB')
    return false
  }
  return true
}

// 工厂: 让模板里直接绑 (:before-upload="makeBeforePdfUpload(p.field)")
//   避免 inline arrow 让 vue-tsc 推断不出参数类型
function makeBeforePdfUpload(field: string) {
  return (file: File) => beforePdfUpload(file, field)
}
function makeHttpRequest(field: string, isPdf: boolean) {
  return (opts: { file: File }) => {
    if (!opts?.file) return
    if (isPdf) form.pdfs[field] = opts.file
    else if (field === 'csv') form.csv = opts.file
  }
}

async function onUpload() {
  if (!formRef.value) return
  await formRef.value.validate()
  if (!canUpload.value) return

  uploading.value = true
  try {
    const fd = new FormData()
    fd.append('quarter', form.quarter)
    fd.append('effective_from', form.effective_from)
    fd.append('csv', form.csv!)
    for (const p of pdfList) {
      fd.append(p.field, form.pdfs[p.field]!)
    }

    const resp = await request.post('/api/admin/rates/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }) as any

    if (!resp?.ok) throw new Error(resp?.message || '上传失败')

    lastUploadAt.value = new Date().toLocaleString('zh-CN')
    uploadPath.value = `${resp.path.pdfs} + ${resp.path.csv}`
    ElMessage.success(`已暂存 ${resp.file_count} 个文件到 ${resp.quarter}`)
  } catch (e: any) {
    ElMessage.error(`上传失败: ${e?.response?.data?.message || e?.message || 'unknown'}`)
  } finally {
    uploading.value = false
  }
}

async function onCalibrate() {
  if (!canStartCalibrate.value) return

  running.value = true
  runStatus.value = 'running'
  logText.value = '▶ 启动中...\n'
  try {
    const resp = await request.post('/api/admin/rates/calibrate', {
      quarter: form.quarter,
      effective_from: form.effective_from,
    }) as any

    if (!resp?.ok || !resp?.runId) throw new Error(resp?.message || '启动失败')

    runId.value = resp.runId
    startPolling(resp.runId)
  } catch (e: any) {
    ElMessage.error(`启动失败: ${e?.response?.data?.message || e?.message || 'unknown'}`)
    running.value = false
    runStatus.value = ''
  }
}

function startPolling(id: string) {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const resp = await request.get(`/api/admin/rates/calibrate/${id}`) as any
      runStatus.value = resp.status
      logText.value = (resp.log_lines || []).join('\n')
      await nextTick()
      if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight

      if (resp.status === 'pass' || resp.status === 'fail') {
        stopPolling()
        running.value = false
        if (resp.status === 'pass') {
          ElMessage.success('校准完成')
        } else {
          ElMessage.error('校准失败, 看日志')
        }
      }
    } catch (e: any) {
      // 404 = runId 过期, 静默停止
      if (e?.response?.status === 404) {
        stopPolling()
        running.value = false
        runStatus.value = 'fail'
      } else {
        // 网络错误继续重试
      }
    }
  }, 2000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

onBeforeUnmount(stopPolling)
</script>

<style scoped>
.rates-refresh-container {
  padding: 0;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card-title {
  font-size: 16px;
  font-weight: 600;
}
.upload-info {
  margin-left: 16px;
  color: #909399;
  font-size: 13px;
}
.log-pre {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 16px;
  border-radius: 4px;
  max-height: 500px;
  overflow-y: auto;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
:deep(.el-upload) {
  display: block;
}
</style>