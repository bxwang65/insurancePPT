<template>
  <div class="rates-container">
    <!-- 查询表单 -->
    <el-card shadow="never" class="query-card">
      <template #header>
        <div class="card-header">
          <span class="card-title">💰 佣金费率查询 (HK)</span>
          <el-tag size="small" type="info">Phase 1 · 仅管理员可见</el-tag>
        </div>
      </template>

      <el-form :model="form" label-width="100px" label-position="right">
        <el-row :gutter="16">
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="公司" required>
              <el-select
                v-model="form.company"
                placeholder="选择公司"
                filterable
                clearable
                :loading="loadingProducts"
                @change="onCompanyChange"
                @focus="onFormChange"
                style="width: 100%"
              >
                <el-option
                  v-for="c in companies"
                  :key="c"
                  :label="c"
                  :value="c"
                />
              </el-select>
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="产品代码">
              <el-select
                v-model="form.code"
                placeholder="选择产品 (留空=该公司所有)"
                filterable
                clearable
                :disabled="!form.company"
                style="width: 100%"
                @change="onFormChange"
              >
                <el-option
                  v-for="p in codeOptions"
                  :key="`${p.code}|${p.plan}|${p.term}`"
                  :value="p.code"
                >
                  <!-- 2026-08-16: 活动 badge 放最前 + flex 布局, 防止长 plan 名把右侧 badge 挤出可见区 -->
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <el-tag
                      v-if="p.is_activity"
                      type="success"
                      size="small"
                      style="flex-shrink: 0;"
                    >活动</el-tag>
                    <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                      [{{ p.code || '空' }}] ({{ p.term }}年) — {{ p.plan }}
                    </span>
                  </div>
                </el-option>
              </el-select>
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="缴费年期" required>
              <el-select
                v-model="form.term"
                placeholder="选择年期"
                :disabled="availableTerms.length === 0"
                style="width: 100%"
                @change="onFormChange"
              >
                <el-option
                  v-for="t in availableTerms"
                  :key="t"
                  :label="`${t}年`"
                  :value="t"
                />
              </el-select>
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="年缴保费" required>
              <el-input-number
                v-model="form.premium"
                :min="1000"
                :step="10000"
                :max="10000000"
                :precision="0"
                style="width: 100%"
                @change="onFormChange"
              />
              <span class="unit-hint">USD / 年</span>
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="级别">
              <el-radio-group v-model="form.level" @change="onCatalogChange">
                <el-radio-button label="L1">L1</el-radio-button>
                <el-radio-button label="L2">L2</el-radio-button>
                <el-radio-button label="L3">L3</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-col>

          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="客户类型">
              <el-radio-group v-model="form.investor" @change="onCatalogChange">
                <el-radio-button label="npi">NPI (非合格)</el-radio-button>
                <el-radio-button label="pi">PI (合格)</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSubmit">
            <el-icon><Search /></el-icon>
            <span>查询佣金</span>
          </el-button>
          <el-button @click="resetForm">
            <el-icon><RefreshLeft /></el-icon>
            <span>重置</span>
          </el-button>
          <span class="form-hint">
            提示: 简单结果用 /preview (代理视图, 只返积分); 完整明细用 /lookup (admin 视图)
          </span>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 错误 -->
    <el-alert
      v-if="errorMsg"
      :title="errorMsg"
      type="error"
      :closable="false"
      show-icon
      class="result-card"
    />

    <!-- 简单结果 (代理视图) -->
    <el-card v-if="preview" shadow="never" class="result-card">
      <template #header>
        <div class="card-header">
          <span class="card-title">📊 简单结果 (代理视图 · /preview)</span>
          <el-tag v-if="preview.is_activity" type="success" size="small">
            活动版 · 截止 {{ preview.issue_deadline || preview.activity_deadline || '?' }}{{ preview.issue_deadline ? '签发' : '' }}
          </el-tag>
        </div>
      </template>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="产品名">{{ preview.plan }}</el-descriptions-item>
        <el-descriptions-item label="公司">{{ preview.company }}</el-descriptions-item>
        <el-descriptions-item label="产品代码">{{ preview.code || '(空)' }}</el-descriptions-item>
        <el-descriptions-item label="年期">{{ preview.term }}年</el-descriptions-item>
        <el-descriptions-item label="年缴保费">
          ${{ formatMoney(preview.premium) }}
        </el-descriptions-item>
        <el-descriptions-item label="币种">{{ preview.currency }}</el-descriptions-item>
        <el-descriptions-item label="总佣金 (USD)">
          <span class="big-number">${{ formatMoney(preview.total_usd) }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="积分">
          <span class="big-number highlight">{{ formatPoints(preview.points) }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- 完整明细 (admin 视图) -->
    <el-card v-if="fullResult" shadow="never" class="result-card">
      <template #header>
        <div class="card-header">
          <span class="card-title">
            📋 完整明细 (admin 视图 · /lookup) · {{ fullResult.level }} {{ fullResult.investor.toUpperCase() }}
          </span>
          <el-tag size="small" type="warning">仅管理员可见</el-tag>
        </div>
      </template>

      <el-table :data="breakdownRows" border stripe size="default">
        <el-table-column prop="label" label="项目" min-width="140">
          <template #default="{ row }">
            <span :class="{ 'subtotal-label': row.subtotal, 'total-label': row.total }">
              {{ row.label }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="百分比" width="120" align="right">
          <template #default="{ row }">
            <span :class="{ 'subtotal-label': row.subtotal, 'total-label': row.total }">
              {{ row.pct.toFixed(2) }}%
            </span>
          </template>
        </el-table-column>
        <el-table-column label="金额 (USD)" min-width="160" align="right">
          <template #default="{ row }">
            <span :class="{ 'subtotal-label': row.subtotal, 'total-amount': row.total }">
              ${{ formatMoney(row.usd) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="160">
          <template #default="{ row }">
            <span class="muted">{{ row.note || '' }}</span>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="fullResult.warnings?.length" class="warnings">
        <el-alert
          v-for="w in fullResult.warnings"
          :key="w"
          :title="w"
          type="warning"
          :closable="false"
          show-icon
          class="warning-item"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, RefreshLeft } from '@element-plus/icons-vue'

interface Product {
  company: string
  code: string
  plan: string
  term: number
  is_activity?: number       // 2026-08-16: 后端 list_products 返此字段, UI 用于显示活动标记
  activity_deadline?: string | null
}

interface PreviewResp {
  company: string
  code: string
  plan: string
  term: number
  level: string
  investor: string
  currency: string
  premium: number
  is_activity: boolean
  activity_deadline: string | null
  issue_deadline?: string | null  // 2026-08-16: "签发" 截止日, 优先显示
  total_usd: number
  points: number
}

interface LookupResp extends PreviewResp {
  y1_pct: number; y2_pct: number; y3_pct: number; y4_pct: number; y5_pct: number
  add_pct: number; total_pct: number; direct_pct: number; indirect_pct: number
  y1_usd: number; y2_usd: number; y3_usd: number; y4_usd: number; y5_usd: number
  renew_usd: number; add_usd: number; direct_usd: number; indirect_usd: number
  warnings: string[]
}

// === 表单 ===
const form = reactive({
  company: '',
  code: '',
  term: 5,
  premium: 100000,
  level: 'L2',
  investor: 'npi',
})

// === 状态 ===
const products = ref<Product[]>([])
const loadingProducts = ref(false)
const loading = ref(false)
const preview = ref<PreviewResp | null>(null)
const fullResult = ref<LookupResp | null>(null)
const errorMsg = ref('')

// === 计算属性 ===
const companies = computed(() =>
  [...new Set(products.value.map(p => p.company))].sort()
)

const codeOptions = computed(() => {
  if (!form.company) return []
  // 2026-08-16: 同 (code, plan, term) 多版本时只留活动版 (is_activity=1)
  //   非活动版是基础版, 活动版是季度促销价; 活动版优先避免用户查错
  //   例 1: AXA 安盛 C05505 (非活动) vs CC05505 (活动) — 不同 code, 都保留, 活动版标"活动" badge
  //   例 2: 永M 萬年青星河傳承 (term=2/5) + 尊享 (term=2/5), 4 个产品都显示
  const sameKey = new Map<string, Product>()
  for (const p of products.value.filter(pp => pp.company === form.company)) {
    const key = `${p.code}|${p.plan}|${p.term}`
    const existing = sameKey.get(key)
    if (!existing || (p.is_activity && !existing.is_activity)) {
      sameKey.set(key, p)
    }
  }
  return [...sameKey.values()]
})

const availableTerms = computed(() => {
  if (!form.company) return []
  const filtered = products.value.filter(p =>
    p.company === form.company && (form.code === '' || p.code === form.code)
  )
  return [...new Set(filtered.map(p => p.term))].sort((a, b) => a - b)
})

const breakdownRows = computed(() => {
  if (!fullResult.value) return []
  const r = fullResult.value
  // 2026-08-16: 明细改成 "首年 L1 基础 + 加点 + y2/y3/y4/y5 续期"
  //   伯乐 (直接/间接) 不在此处展示 — 伯乐是下线出单时给上线的,
  //   自己出单没有, 应在 我的档案 → 推管树 看下线开单贡献
  const rows: Array<{ label: string; pct: number; usd: number; total?: boolean; subtotal?: boolean; note?: string }> = []

  if (r.investor === 'npi') {
    // 首年 L1 基础 = y1 (NPI 首年 = base)
    rows.push({ label: '首年 L1 基础', pct: r.y1_pct, usd: r.y1_usd, note: 'NPI y1 base' })

    // 加点 (L2/L3 才有)
    if (r.add_pct > 0) {
      rows.push({ label: '加点', pct: r.add_pct, usd: r.add_usd, note: `${r.level} 级别加点` })
    }

    // y2/y3/y4/y5 续期分别列 (NPI 才有)
    if (r.y2_usd) rows.push({ label: 'y2 续期', pct: r.y2_pct, usd: r.y2_usd, note: '续期第二年' })
    if (r.y3_usd) rows.push({ label: 'y3 续期', pct: r.y3_pct, usd: r.y3_usd, note: '续期第三年' })
    if (r.y4_usd) rows.push({ label: 'y4 续期', pct: r.y4_pct, usd: r.y4_usd, note: '续期第四年' })
    if (r.y5_usd) rows.push({ label: 'y5 续期', pct: r.y5_pct, usd: r.y5_usd, note: '续期第五年' })
  } else {
    // PI: 一次性 (基础+加点合成 total), 按用户口径展开
    const basePct = r.total_pct - r.add_pct
    const baseUsd = basePct * r.premium / 100
    rows.push({ label: '首年 L1 基础', pct: basePct, usd: baseUsd, note: 'PI base (total - add)' })

    if (r.add_pct > 0) {
      const addUsd = r.add_pct * r.premium / 100
      rows.push({ label: '加点', pct: r.add_pct, usd: addUsd, note: `${r.level} 级别加点` })
    }

    // PI 没有 y2-y5 续期, 但前端若仍有数据 (旧版本) 也兼容展示
    if (r.y2_usd) rows.push({ label: 'y2 续期', pct: r.y2_pct, usd: r.y2_usd, note: '续期第二年' })
    if (r.y3_usd) rows.push({ label: 'y3 续期', pct: r.y3_pct, usd: r.y3_usd, note: '续期第三年' })
    if (r.y4_usd) rows.push({ label: 'y4 续期', pct: r.y4_pct, usd: r.y4_usd, note: '续期第四年' })
    if (r.y5_usd) rows.push({ label: 'y5 续期', pct: r.y5_pct, usd: r.y5_usd, note: '续期第五年' })
  }

  // 总计 = 基础 + 加点 + 续期 (不含伯乐 — 伯乐另算)
  const totalNoBerlue = rows.reduce((sum, x) => sum + x.usd, 0)
  rows.push({
    label: '总计', pct: totalNoBerlue / r.premium * 100, usd: totalNoBerlue,
    total: true, note: '基础+加点+续期 (伯乐不计入, 走下线出单)',
  })
  return rows
})

// === 工具 ===
function formatMoney(v: number): string {
  return (v ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatPoints(v: number): string {
  return (v ?? 0).toLocaleString('en-US')
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// === 数据加载 ===
async function loadProducts() {
  loadingProducts.value = true
  try {
    // 2026-08-16: 跟随 form.investor / form.level 动态加载, 否则切 investor 后 dropdown 里的
    //   code 在新表里不存在 (例 CC05505 只在 pi_fee_*, 切 npi 就 404)
    const res = await fetch(`/api/rates/products?level=${form.level}&investor=${form.investor}`, {
      headers: getAuthHeaders(),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || `HTTP ${res.status}`)
    }
    const data = await res.json()
    products.value = data.items || []
    if (products.value.length === 0) {
      ElMessage.warning(`产品列表为空 (${form.investor.toUpperCase()} ${form.level})`)
    }
  } catch (e: any) {
    ElMessage.error('产品列表加载失败: ' + (e?.message || e))
    errorMsg.value = '产品列表加载失败: ' + (e?.message || e)
  } finally {
    loadingProducts.value = false
  }
}

// === 交互 ===
function onCompanyChange() {
  form.code = ''
  // 重置 term 为该公司第一个可选年期
  const terms = availableTerms.value
  if (terms.length > 0) {
    form.term = terms[0]
  } else {
    form.term = 5
  }
  onFormChange()
}

// 2026-08-16: 表单字段改了立刻清空结果, 防止 stale 数据误导用户
//   (例: 用户先查 CPIC + 5 年, 然后切到 永M + 2 年, 简单结果卡片
//   应该消失, 不能继续显示上次 CPIC 的数据)
function onFormChange() {
  preview.value = null
  fullResult.value = null
  errorMsg.value = ''
}

// 2026-08-16: investor / level 切换后, 产品 dropdown 必须重拉 (NPI 表和 PI 表产品不同)
//   不然用户切 investor 后 dropdown 里仍显示上个表的 code, 选了之后 /preview 404
async function onCatalogChange() {
  form.code = ''
  form.term = 5
  preview.value = null
  fullResult.value = null
  errorMsg.value = ''
  await loadProducts()
}

async function onSubmit() {
  if (!form.company) {
    ElMessage.warning('请先选择公司')
    return
  }
  if (!form.term) {
    ElMessage.warning('请选择缴费年期')
    return
  }
  if (!form.premium || form.premium <= 0) {
    ElMessage.warning('请输入年缴保费 (> 0)')
    return
  }

  loading.value = true
  errorMsg.value = ''
  preview.value = null
  fullResult.value = null

  const baseBody = {
    company: form.company,
    code: form.code || '',
    term: form.term,
    premium: form.premium,
  }

  try {
    // 并行: 简单结果 (/preview) + 完整明细 (/lookup)
    const [previewRes, lookupRes] = await Promise.all([
      fetch('/api/rates/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        // 2026-08-16: /preview 也传 investor, 让 admin 看 PI 时简单结果跟完整明细一致
        body: JSON.stringify({ ...baseBody, investor: form.investor }),
      }),
      fetch('/api/rates/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ ...baseBody, level: form.level, investor: form.investor }),
      }),
    ])

    // /preview (代理视图)
    if (previewRes.ok) {
      preview.value = await previewRes.json()
    } else {
      const err = await previewRes.json().catch(() => ({}))
      throw new Error(`/preview: ${err.message || `HTTP ${previewRes.status}`}`)
    }

    // /lookup (admin 视图) - 容错: 失败不阻塞 preview
    if (lookupRes.ok) {
      fullResult.value = await lookupRes.json()
    } else {
      const err = await lookupRes.json().catch(() => ({}))
      // 403 表示不是 admin, 静默不报错 (preview 已经够看)
      if (lookupRes.status !== 403) {
        ElMessage.warning(`/lookup 失败: ${err.message || `HTTP ${lookupRes.status}`}`)
      }
    }
  } catch (e: any) {
    errorMsg.value = e?.message || '查询失败'
    ElMessage.error(errorMsg.value)
  } finally {
    loading.value = false
  }
}

function resetForm() {
  form.company = ''
  form.code = ''
  form.term = 5
  form.premium = 100000
  form.level = 'L2'
  form.investor = 'npi'
  preview.value = null
  fullResult.value = null
  errorMsg.value = ''
}

onMounted(() => {
  loadProducts()
})
</script>

<style scoped>
.rates-container {
  max-width: 1200px;
  margin: 0 auto;
}

.query-card {
  margin-bottom: 20px;
}

.result-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.unit-hint {
  margin-left: 8px;
  color: #94a3b8;
  font-size: 12px;
}

.form-hint {
  margin-left: 12px;
  color: #94a3b8;
  font-size: 12px;
}

.big-number {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.big-number.highlight {
  color: #2563eb;
}

.muted {
  color: #94a3b8;
}

.warnings {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.warning-item {
  margin-bottom: 0;
}

/* 2026-08-16: breakdown 小计/总计行视觉区分 — 小计浅蓝, 总计加粗深蓝 */
.subtotal-label {
  color: #475569;
  font-weight: 500;
  background-color: #f1f5f9;
  padding: 2px 6px;
  border-radius: 3px;
}

.total-label {
  color: #1e40af;
  font-weight: 700;
  background-color: #dbeafe;
  padding: 2px 6px;
  border-radius: 3px;
}

.total-amount {
  color: #1e40af;
  font-weight: 700;
  font-size: 16px;
}
</style>