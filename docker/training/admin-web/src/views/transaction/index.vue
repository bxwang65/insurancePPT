<template>
  <div class="transaction-container">
    <div class="toolbar">
      <el-select v-model="filterProduct" placeholder="产品类型" clearable style="width: 160px;" @change="fetchList">
        <el-option label="HK 港险" value="HK" />
        <el-option label="SG 新加坡" value="SG" />
        <el-option label="ART 近现代" value="ART_MODERN" />
        <el-option label="ART 当代" value="ART_CONTEMP" />
      </el-select>
      <el-select
        v-model="filterUserId"
        placeholder="员工"
        filterable
        clearable
        style="width: 200px;"
        @change="fetchList"
      >
        <el-option
          v-for="u in allUsers"
          :key="u.id"
          :label="u.name"
          :value="u.id"
        />
      </el-select>
      <el-button type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon> 录入业绩
      </el-button>
      <div class="toolbar-right">
        <span class="total-tip">共 {{ total }} 条</span>
      </div>
    </div>

    <!-- 2026-08-16: 业绩 / 佣金汇总卡 (按当前过滤范围聚合) -->
    <div v-if="summary" class="summary-bar" data-testid="tx-summary">
      <div class="summary-head">
        <span class="summary-title">📊 业绩汇总</span>
        <span class="summary-hint">
          总件数 {{ summary.totals.count }}
          · 标保 ¥{{ formatNum(summary.totals.std_premium) }}
          · <span v-if="hasFilter" class="num-cell">已应用筛选</span>
          <span v-else class="num-cell">全部记录</span>
        </span>
      </div>
      <div class="summary-grid">
        <div
          v-for="row in summary.by_product_type"
          :key="row.product_type"
          class="summary-cell"
          :class="`cell-${row.product_type}`"
        >
          <el-tag size="small" :type="getProductTag(row.product_type)">
            {{ getProductLabel(row.product_type) }}
          </el-tag>
          <div class="cell-count">{{ row.count }} 件</div>
          <div v-if="row.annual_premium" class="cell-line">
            年缴 <span class="num-cell">¥{{ formatNum(row.annual_premium) }}</span>
          </div>
          <div v-if="row.std_premium" class="cell-line">
            标保 <span class="num-cell">${{ formatNum(row.std_premium) }}</span>
          </div>
          <div v-if="row.sale_price" class="cell-line">
            成交 <span class="num-cell">¥{{ formatNum(row.sale_price) }}</span>
          </div>
          <div class="cell-commission">
            <div v-if="row.commission_amount" class="cell-line strong">
              佣金 <span class="num-cell">${{ formatNum(row.commission_amount) }}</span>
            </div>
            <div v-else class="cell-line pending-line">
              佣金 待费用表
            </div>
          </div>
        </div>
        <!-- 合计行 (跨产品类型) -->
        <div class="summary-cell cell-total">
          <el-tag size="small" type="info">合计</el-tag>
          <div class="cell-count">{{ summary.totals.count }} 件</div>
          <div v-if="summary.totals.annual_premium" class="cell-line">
            年缴 <span class="num-cell">¥{{ formatNum(summary.totals.annual_premium) }}</span>
          </div>
          <div v-if="summary.totals.std_premium" class="cell-line">
            标保 <span class="num-cell">${{ formatNum(summary.totals.std_premium) }}</span>
          </div>
          <div v-if="summary.totals.sale_price" class="cell-line">
            成交 <span class="num-cell">¥{{ formatNum(summary.totals.sale_price) }}</span>
          </div>
          <div class="cell-commission">
            <div v-if="summary.totals.commission_amount" class="cell-line strong">
              佣金 <span class="num-cell">${{ formatNum(summary.totals.commission_amount) }}</span>
            </div>
            <div v-else class="cell-line pending-line">佣金 待费用表</div>
          </div>
        </div>
      </div>
    </div>

    <el-table :data="items" border stripe v-loading="loading">
      <el-table-column label="产品" width="110">
        <template #default="{ row }">
          <el-tag size="small" :type="getProductTag(row.product_type)">
            {{ getProductLabel(row.product_type) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="user_name" label="员工" min-width="100" />
      <!-- HK/SG 视图 -->
      <template v-if="isPolicyView">
        <el-table-column label="HK 产品" min-width="160">
          <template #default="{ row }">
            <span v-if="row.hk_code" class="num-cell">[{{ row.hk_code }}] ({{ row.hk_term }}年) — {{ row.hk_plan }}</span>
            <span v-else class="pending">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="annual_premium" label="年缴保费" width="120">
          <template #default="{ row }">¥{{ formatNum(row.annual_premium) }}</template>
        </el-table-column>
        <el-table-column prop="payment_years" label="缴费年数" width="100" />
        <el-table-column prop="std_premium" label="标保" width="120" sortable>
          <template #default="{ row }">
            <span class="num-cell">${{ formatNum(row.std_premium) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="policy_no" label="保单号" min-width="160" />
      </template>
      <!-- ART 视图 -->
      <template v-else>
        <el-table-column prop="artist" label="艺术家" min-width="100" />
        <el-table-column prop="work_title" label="作品名" min-width="140" />
        <el-table-column prop="sale_price" label="成交价" width="120">
          <template #default="{ row }">
            <span class="num-cell">{{ row.currency }} {{ formatNum(row.sale_price) }}</span>
          </template>
        </el-table-column>
      </template>
      <el-table-column prop="sold_at" label="日期" width="120">
        <template #default="{ row }">{{ formatDate(row.sold_at) }}</template>
      </el-table-column>
      <!-- 2026-08-16: 佣金明细 — 显示 NPI/PI + 首期/加点/续期/伯乐 分项 -->
      <el-table-column label="佣金明细" width="180">
        <template #default="{ row }">
          <el-popover
            v-if="row.commission_amount != null && row.commission_breakdown"
            placement="left"
            :width="280"
            trigger="hover"
            popper-class="tx-commission-popover"
          >
            <template #reference>
              <div class="commission-cell">
                <span class="num-cell big">{{ formatNum(row.commission_amount) }}</span>
                <el-tag v-if="getBdInvestor(row)" size="small" :type="getBdInvestor(row) === 'PI' ? 'primary' : 'success'" class="inv-tag">
                  {{ getBdInvestor(row) }}
                </el-tag>
                <span class="more-icon">▾</span>
              </div>
            </template>
            <div class="bd-pop">
              <div class="bd-head">
                <span class="bd-title">佣金明细</span>
                <el-tag v-if="getBdInvestor(row)" size="small" :type="getBdInvestor(row) === 'PI' ? 'primary' : 'success'">
                  {{ getBdInvestor(row) }} · {{ getBdLevel(row) }}
                </el-tag>
              </div>
              <div v-if="getBdInvestor(row)" class="bd-row">
                <span>客户类型</span>
                <span class="bd-val">{{ getBdInvestor(row) === 'PI' ? 'PI (合格投资人)' : 'NPI (非合格投资人)' }}</span>
              </div>
              <!-- 2026-08-16: 按年展示 (1-5年), 与 MyProfile 费率速查 tab 一致 -->
              <template v-if="getBdInvestor(row) === 'NPI'">
                <div v-if="getYearUsd(row, 1)" class="bd-row">
                  <span>第1年</span>
                  <span class="bd-val">${{ formatNum(getYearUsd(row, 1)) }}</span>
                </div>
                <div v-if="getYearUsd(row, 2)" class="bd-row">
                  <span>第2年</span>
                  <span class="bd-val">${{ formatNum(getYearUsd(row, 2)) }}</span>
                </div>
                <div v-if="getYearUsd(row, 3)" class="bd-row">
                  <span>第3年</span>
                  <span class="bd-val">${{ formatNum(getYearUsd(row, 3)) }}</span>
                </div>
                <div v-if="getYearUsd(row, 4)" class="bd-row">
                  <span>第4年</span>
                  <span class="bd-val">${{ formatNum(getYearUsd(row, 4)) }}</span>
                </div>
                <div v-if="getYearUsd(row, 5)" class="bd-row">
                  <span>第5年</span>
                  <span class="bd-val">${{ formatNum(getYearUsd(row, 5)) }}</span>
                </div>
              </template>
              <!-- PI: 单年缴, total_pct 即是首年合计, 拆 "基础" + "加点" -->
              <template v-else>
                <div v-if="getPiBaseUsd(row)" class="bd-row">
                  <span>基础 (L1)</span>
                  <span class="bd-val">${{ formatNum(getPiBaseUsd(row)) }}</span>
                </div>
                <div v-if="getAddUsd(row)" class="bd-row">
                  <span>加点 ({{ getBdLevel(row) }})</span>
                  <span class="bd-val">${{ formatNum(getAddUsd(row)) }}</span>
                </div>
              </template>
              <div v-if="getRenewUsd(row)" class="bd-row">
                <span>续期</span>
                <span class="bd-val">${{ formatNum(getRenewUsd(row)) }}</span>
              </div>
              <div v-if="getBerlueTotal(row)" class="bd-row">
                <span>伯乐 (直接+间接)</span>
                <span class="bd-val">${{ formatNum(getBerlueTotal(row)) }}</span>
              </div>
              <div class="bd-row bd-total">
                <span>总佣金</span>
                <span class="bd-val">${{ formatNum(row.commission_amount) }}</span>
              </div>
              <div v-if="(row.commission_breakdown?.issue_deadline || row.commission_breakdown?.activity_deadline)" class="bd-deadline">
                ⏰ 活动截止{{ row.commission_breakdown.issue_deadline ? '保单签发日' : '' }}{{ row.commission_breakdown.issue_deadline || row.commission_breakdown.activity_deadline }}
              </div>
            </div>
          </el-popover>
          <span v-else-if="row.commission_amount != null" class="num-cell">{{ formatNum(row.commission_amount) }}</span>
          <span v-else class="pending">待费用表</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-wrap">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="limit"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @size-change="fetchList"
        @current-change="fetchList"
      />
    </div>

    <!-- 录入/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑业绩' : '录入业绩'" width="540px" draggable :close-on-click-modal="false">
      <div class="tx-form-scroll">
        <el-form :model="form" :rules="rules" ref="formRef" label-width="110px">
        <el-form-item label="员工" prop="user_id">
          <el-select v-model="form.user_id" filterable placeholder="选择员工" style="width: 100%" :disabled="editing">
            <el-option v-for="u in allUsers" :key="u.id" :label="u.name" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="产品类型" prop="product_type">
          <el-radio-group v-model="form.product_type" :disabled="editing">
            <el-radio-button label="HK">HK 港险</el-radio-button>
            <el-radio-button label="SG">SG 新加坡</el-radio-button>
            <el-radio-button label="ART_MODERN">ART 近现代</el-radio-button>
            <el-radio-button label="ART_CONTEMP">ART 当代</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="日期" prop="sold_at">
          <el-date-picker v-model="form.sold_at" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>

        <!-- HK/SG 字段 -->
        <template v-if="isPolicy">
          <!-- 2026-08-16: HK 产品级联选择器 (公司 → 代码 → 年期) -->
          <template v-if="form.product_type === 'HK'">
            <el-form-item label="HK 公司" prop="hk_company">
              <el-select
                v-model="form.hk_company"
                placeholder="选择公司"
                filterable
                clearable
                :disabled="editing"
                :loading="loadingProducts"
                style="width: 100%"
                @change="onHKCompanyChange"
              >
                <el-option v-for="c in hkCompanies" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
            <el-form-item label="HK 产品代码" prop="hk_code">
              <el-select
                v-model="form.hk_code"
                placeholder="选择产品代码"
                filterable
                clearable
                :disabled="!form.hk_company || editing"
                style="width: 100%"
                @change="onHKCodeChange"
              >
                <el-option
                  v-for="p in hkCodeOptions"
                  :key="`${p.code}|${p.plan}|${p.term}`"
                  :value="p.code"
                >
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <el-tag v-if="p.is_activity" type="success" size="small" style="flex-shrink: 0;">活动</el-tag>
                    <el-tag v-else type="info" size="small" style="flex-shrink: 0;">已停</el-tag>
                    <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                      [{{ p.code || '空' }}] ({{ p.term }}年) — {{ p.plan }}
                    </span>
                  </div>
                </el-option>
              </el-select>
            </el-form-item>
            <el-form-item label="HK 计划名" prop="hk_plan">
              <el-input
                v-model="form.hk_plan"
                placeholder="自动填充"
                :disabled="editing"
              />
            </el-form-item>
            <el-form-item label="HK 年期" prop="hk_term">
              <el-select
                v-model.number="form.hk_term"
                placeholder="选择年期"
                :disabled="!form.hk_code || editing || hkAvailableTerms.length === 0"
                style="width: 100%"
                @change="onHKTermChange"
              >
                <el-option v-for="t in hkAvailableTerms" :key="t" :label="`${t}年`" :value="t" />
              </el-select>
            </el-form-item>
          </template>
          <el-form-item label="年缴保费" prop="annual_premium">
            <el-input-number v-model="form.annual_premium" :min="0" :step="10000" style="width: 70%" />
            <span class="form-tip-inline">{{ form.product_type === 'HK' ? 'USD' : 'TP' }}</span>
          </el-form-item>
          <!-- 2026-08-16: 客户合格投资人状态 (PI/NPI), 控制费率表路由 -->
          <el-form-item v-if="form.product_type === 'HK'" label="客户类型">
            <el-radio-group v-model="form.investor" :disabled="editing">
              <el-radio-button label="pi">PI (合格投资人)</el-radio-button>
              <el-radio-button label="npi">NPI (非合格投资人)</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <!-- 2026-08-16: 实时佣金预览 (HK only, 按年明细) -->
          <el-form-item v-if="form.product_type === 'HK'" label="佣金预览">
            <span v-if="loadingPreview" class="pending">计算中...</span>
            <el-popover
              v-else-if="preview"
              placement="left"
              :width="320"
              trigger="hover"
              popper-class="tx-preview-popover"
            >
              <template #reference>
                <span class="num-cell big-preview">
                  ${{ formatNum(preview.total_usd) }}
                  <span class="form-tip-inline">(积分 {{ formatNum(preview.points) }})</span>
                  <span class="more-icon">▾</span>
                </span>
              </template>
              <div class="pv-pop">
                <div class="pv-head">
                  <span class="pv-title">佣金明细 (按年)</span>
                  <el-tag size="small" :type="form.investor === 'pi' ? 'primary' : 'success'">
                    {{ form.investor === 'pi' ? 'PI' : 'NPI' }} · {{ previewLevelLabel }}
                  </el-tag>
                </div>
                <!-- NPI: 5年 + 续期 + 加点 -->
                <template v-if="form.investor === 'npi'">
                  <div v-if="preview.y1_usd" class="pv-row">
                    <span>第1年</span>
                    <span class="pv-val">${{ formatNum(preview.y1_usd) }}</span>
                  </div>
                  <div v-if="preview.y2_usd" class="pv-row">
                    <span>第2年</span>
                    <span class="pv-val">${{ formatNum(preview.y2_usd) }}</span>
                  </div>
                  <div v-if="preview.y3_usd" class="pv-row">
                    <span>第3年</span>
                    <span class="pv-val">${{ formatNum(preview.y3_usd) }}</span>
                  </div>
                  <div v-if="preview.y4_usd" class="pv-row">
                    <span>第4年</span>
                    <span class="pv-val">${{ formatNum(preview.y4_usd) }}</span>
                  </div>
                  <div v-if="preview.y5_usd" class="pv-row">
                    <span>第5年</span>
                    <span class="pv-val">${{ formatNum(preview.y5_usd) }}</span>
                  </div>
                  <div v-if="preview.renew_usd" class="pv-row">
                    <span>续期</span>
                    <span class="pv-val">${{ formatNum(preview.renew_usd) }}</span>
                  </div>
                  <div v-if="preview.add_usd" class="pv-row">
                    <span>加点 ({{ previewLevelLabel }})</span>
                    <span class="pv-val">${{ formatNum(preview.add_usd) }}</span>
                  </div>
                </template>
                <!-- PI: 基础 (L1) + 加点 + 续期 -->
                <template v-else>
                  <div v-if="previewPiBase !== null" class="pv-row">
                    <span>基础 (L1)</span>
                    <span class="pv-val">${{ formatNum(previewPiBase) }}</span>
                  </div>
                  <div v-if="preview.add_usd" class="pv-row">
                    <span>加点 ({{ previewLevelLabel }})</span>
                    <span class="pv-val">${{ formatNum(preview.add_usd) }}</span>
                  </div>
                  <div v-if="preview.renew_usd" class="pv-row">
                    <span>续期</span>
                    <span class="pv-val">${{ formatNum(preview.renew_usd) }}</span>
                  </div>
                </template>
                <div v-if="(preview.direct_usd + preview.indirect_usd) > 0" class="pv-row">
                  <span>伯乐 (直接+间接)</span>
                  <span class="pv-val">${{ formatNum(preview.direct_usd + preview.indirect_usd) }}</span>
                </div>
                <div class="pv-row pv-total">
                  <span>总佣金</span>
                  <span class="pv-val">${{ formatNum(preview.total_usd) }}</span>
                </div>
                <div v-if="preview.activity_deadline" class="pv-deadline">
                  ⏰ 活动截止 {{ preview.activity_deadline }}
                </div>
                <div v-if="preview.issue_deadline" class="pv-deadline">
                  📋 保单签发截止 {{ preview.issue_deadline }}
                </div>
              </div>
            </el-popover>
            <span v-else-if="previewError" class="pending">{{ previewError }}</span>
            <span v-else class="pending">— (选齐产品 + 输入保费后显示)</span>
          </el-form-item>
          <el-form-item label="缴费年数" prop="payment_years">
            <el-input-number v-model="form.payment_years" :min="1" :max="50" style="width: 70%" />
            <span v-if="form.product_type === 'HK'" class="form-tip-inline">缴费年数 (可与 HK 年期不同)</span>
          </el-form-item>
          <el-form-item label="标保(自动)">
            <span class="num-cell">${{ formatNum(computedStdPremium) }}</span>
            <span class="form-tip-inline">= 年缴 × 年数 / 5</span>
          </el-form-item>
          <el-form-item label="保单号">
            <el-input v-model="form.policy_no" placeholder="可选" />
          </el-form-item>
        </template>

        <!-- ART 字段 -->
        <template v-else>
          <el-form-item label="艺术家" prop="artist">
            <el-input v-model="form.artist" placeholder="如：赵无极 / 草间弥生" />
          </el-form-item>
          <el-form-item label="作品名" prop="work_title">
            <el-input v-model="form.work_title" placeholder="如：1985年作 抽象画" />
          </el-form-item>
          <el-form-item label="成交价" prop="sale_price">
            <el-input-number v-model="form.sale_price" :min="0" :step="10000" style="width: 70%" />
          </el-form-item>
          <el-form-item label="币种">
            <el-select v-model="form.currency" style="width: 100%">
              <el-option label="RMB" value="RMB" />
              <el-option label="USD" value="USD" />
              <el-option label="HKD" value="HKD" />
            </el-select>
          </el-form-item>
        </template>
      </el-form>
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import request from '@/utils/request'

const API_TX = '/admin/transactions'
const API_USERS = '/admin/users'

// 2026-08-16: HK 产品类型 (跟 docker/hx-rates/app.py:200 ProductItem 对齐)
interface HkProduct {
  company: string
  code: string
  plan: string
  term: number
  is_activity: number
  activity_deadline: string | null
}

const items = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const limit = ref(20)
const loading = ref(false)
const saving = ref(false)
const filterProduct = ref<string>('')
const filterUserId = ref<string>('')
// 2026-08-16: 汇总 (来自后端 groupBy)
const summary = ref<{
  totals: { count: number; std_premium: number; annual_premium: number; commission_amount: number; sale_price: number }
  by_product_type: Array<{
    product_type: string
    count: number
    std_premium: number
    annual_premium: number
    commission_amount: number
    sale_price: number
  }>
} | null>(null)

const hasFilter = computed(() => !!filterProduct.value || !!filterUserId.value)

const allUsers = ref<{ id: string; name: string; phone?: string }[]>([])

const dialogVisible = ref(false)
const editing = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({
  id: '',
  user_id: '',
  product_type: 'HK' as 'HK' | 'SG' | 'ART_MODERN' | 'ART_CONTEMP',
  sold_at: '',
  annual_premium: 0,
  payment_years: 1,
  policy_no: '',
  artist: '',
  work_title: '',
  sale_price: 0,
  currency: 'RMB',
  // 2026-08-16: HK 产品识别 (只 HK 用)
  hk_company: '',
  hk_code: '',
  hk_plan: '',
  hk_term: 0 as number,
  // 2026-08-16: 客户合格投资人状态 (HK only), 默认 pi (合格)
  investor: 'pi' as 'pi' | 'npi',
})

// 2026-08-16: HK 产品 + 实时佣金预览 state (lookup 接口返回完整按年明细)
const loadingProducts = ref(false)
const preview = ref<{
  total_usd: number
  points: number
  plan: string
  is_activity: number
  activity_deadline: string | null
  issue_deadline: string | null
  level: string
  investor: string
  y1_usd: number
  y2_usd: number
  y3_usd: number
  y4_usd: number
  y5_usd: number
  renew_usd: number
  add_usd: number
  direct_usd: number
  indirect_usd: number
  total_pct: number
  warnings: string[]
} | null>(null)
const loadingPreview = ref(false)
const previewError = ref('')
let previewTimer: ReturnType<typeof setTimeout> | null = null
let previewAbort: AbortController | null = null
const previewLevelLabel = computed(() => preview.value?.level ?? 'L2')
// PI 基础 = total - add - renew - 伯乐 (直接+间接)
const previewPiBase = computed(() => {
  if (!preview.value || form.investor !== 'pi') return null
  const total = preview.value.total_usd || 0
  const add = preview.value.add_usd || 0
  const renew = preview.value.renew_usd || 0
  const berlue = (preview.value.direct_usd || 0) + (preview.value.indirect_usd || 0)
  return Math.max(0, total - add - renew - berlue)
})

const isPolicy = computed(() => form.product_type === 'HK' || form.product_type === 'SG')
const isPolicyView = computed(() => filterProduct.value === '' || filterProduct.value === 'HK' || filterProduct.value === 'SG')

// 2026-08-16: PI + NPI 各自加载一份, 当前 investor 切换时 hkCodeOptions 自动跟随
const hkProductsPi = ref<HkProduct[]>([])
const hkProductsNpi = ref<HkProduct[]>([])
const hkProducts = computed(() =>
  form.investor === 'npi' ? hkProductsNpi.value : hkProductsPi.value,
)

// 2026-08-16: 列出所有公司 (含非活动产品), 用户录入时可能查历史产品
//   非活动产品 dropdown 加 "已停" tag, 默认按 is_activity 排序
const hkCompanies = computed(() => {
  const set = new Set(hkProducts.value.map((p) => p.company))
  return Array.from(set).sort()
})
const hkCodeOptions = computed(() =>
  hkProducts.value.filter((p) => p.company === form.hk_company),
)
const hkAvailableTerms = computed(() => {
  const terms = hkCodeOptions.value
    .filter((p) => p.code === form.hk_code)
    .map((p) => p.term)
  return Array.from(new Set(terms)).sort((a, b) => a - b)
})

const computedStdPremium = computed(() => {
  if (!isPolicy.value) return 0
  return Math.round(((form.annual_premium ?? 0) * (form.payment_years ?? 0) / 5) * 100) / 100
})

const rules: FormRules = {
  user_id: [{ required: true, message: '请选择员工', trigger: 'change' }],
  product_type: [{ required: true, message: '请选择产品', trigger: 'change' }],
  sold_at: [{ required: true, message: '请选择日期', trigger: 'change' }],
  annual_premium: [{ required: true, message: '年缴保费必填', trigger: 'blur' }],
  payment_years: [{ required: true, message: '缴费年数必填', trigger: 'blur' }],
  artist: [{ required: true, message: '艺术家必填', trigger: 'blur' }],
  work_title: [{ required: true, message: '作品名必填', trigger: 'blur' }],
  sale_price: [{ required: true, message: '成交价必填', trigger: 'blur' }],
  hk_company: [{ required: true, message: '请选择 HK 公司', trigger: 'change' }],
  hk_code: [{ required: true, message: '请选择产品代码', trigger: 'change' }],
  hk_plan: [{ required: true, message: '请填写计划名', trigger: 'blur' }],
  hk_term: [{ required: true, message: '请选择年期', trigger: 'change' }],
}

const formatNum = (n: number) => (n ?? 0).toLocaleString()
const formatDate = (iso: string) => iso ? iso.split('T')[0] : ''

const getProductLabel = (t: string) => {
  return { HK: 'HK 港险', SG: 'SG 新加坡', ART_MODERN: 'ART 近现代', ART_CONTEMP: 'ART 当代' }[t] ?? t
}
const getProductTag = (t: string) => {
  return { HK: 'primary', SG: 'success', ART_MODERN: 'warning', ART_CONTEMP: 'danger' }[t] ?? ''
}

// 2026-08-16: 佣金明细解析 (commission_breakdown 是 JSON 字符串)
//   - 安全解析: try/catch, 老数据 (null / 非 JSON / 旧 preview 格式) 走 fallback
const safeBd = (row: any): any => {
  if (!row?.commission_breakdown) return null
  if (typeof row.commission_breakdown === 'object') return row.commission_breakdown
  try { return JSON.parse(row.commission_breakdown) } catch { return null }
}
const getBdInvestor = (row: any) => {
  const bd = safeBd(row)
  if (!bd) return null
  const inv = String(bd.investor || '').toLowerCase()
  if (inv === 'pi') return 'PI'
  if (inv === 'npi') return 'NPI'
  return null
}
const getBdLevel = (row: any) => {
  const bd = safeBd(row)
  return bd?.level ?? 'L2'
}
const getAddUsd = (row: any) => Number(safeBd(row)?.add_usd) || 0
const getRenewUsd = (row: any) => Number(safeBd(row)?.renew_usd) || 0
const getBerlueTotal = (row: any) =>
  (Number(safeBd(row)?.direct_usd) || 0) + (Number(safeBd(row)?.indirect_usd) || 0)

// 2026-08-16: 按年展示 (NPI 第1-5年) — 与 MyProfile 费率速查 tab 一致
const getYearUsd = (row: any, year: 1 | 2 | 3 | 4 | 5) => {
  const bd = safeBd(row)
  if (!bd) return 0
  return Number(bd[`y${year}_usd`]) || 0
}
// 2026-08-16: PI 基础 (L1 baseline) = total - add - berlue - renew (与首期合计不同)
const getPiBaseUsd = (row: any) => {
  const bd = safeBd(row)
  if (!bd) return 0
  const total = Number(row.commission_amount) || 0
  return Math.max(0, total - getAddUsd(row) - getBerlueTotal(row) - getRenewUsd(row))
}

// 2026-08-16: 鉴权头 (跟 rates/index.vue:397-400 一致)
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const fetchList = async () => {
  loading.value = true
  try {
    const params: any = { page: page.value, limit: limit.value }
    if (filterProduct.value) params.product_type = filterProduct.value
    if (filterUserId.value) params.user_id = filterUserId.value
    const res: any = await request.get(API_TX, { params })
    const data = res?.data ?? res
    items.value = data.items ?? []
    total.value = data.total ?? 0
    summary.value = data.summary ?? null
  } catch (e: any) {
    ElMessage.error('获取列表失败: ' + (e.message || ''))
  } finally {
    loading.value = false
  }
}

const fetchUsers = async () => {
  try {
    const res: any = await request.get(API_USERS, { params: { limit: 1000 } })
    allUsers.value = (res?.data?.users ?? res?.users ?? []).map((u: any) => ({
      id: u.id, name: u.name, phone: u.phone,
    }))
  } catch {
    /* noop */
  }
}

// 2026-08-16: 加载 HK 产品列表 (PI + NPI 各一份, 跟随 form.investor 切换)
async function loadHkProducts() {
  if (hkProductsPi.value.length > 0 && hkProductsNpi.value.length > 0) return  // 都已加载
  loadingProducts.value = true
  try {
    const [piRes, npiRes] = await Promise.all([
      fetch('/api/rates/products?level=L2&investor=pi', { headers: getAuthHeaders() }),
      fetch('/api/rates/products?level=L2&investor=npi', { headers: getAuthHeaders() }),
    ])
    if (!piRes.ok) {
      const err = await piRes.json().catch(() => ({}))
      throw new Error(err.message || `HTTP ${piRes.status}`)
    }
    if (!npiRes.ok) {
      const err = await npiRes.json().catch(() => ({}))
      throw new Error(err.message || `HTTP ${npiRes.status}`)
    }
    const [piData, npiData] = await Promise.all([piRes.json(), npiRes.json()])
    hkProductsPi.value = piData.items || []
    hkProductsNpi.value = npiData.items || []
  } catch (e: any) {
    ElMessage.warning('HK 产品列表加载失败: ' + (e?.message || e))
  } finally {
    loadingProducts.value = false
  }
}

// 2026-08-16: HK 选择器级联
function onHKCompanyChange() {
  form.hk_code = ''
  form.hk_plan = ''
  form.hk_term = 0
  clearPreview()
}
function onHKCodeChange() {
  // 自动填充首个匹配产品的 plan 名 (用户可改, 但默认就第一个)
  const match = hkCodeOptions.value.find((p) => p.code === form.hk_code)
  form.hk_plan = match?.plan || ''
  // 自动选最小年期
  const terms = hkAvailableTerms.value
  form.hk_term = terms.length > 0 ? terms[0] : 0
  clearPreview()
}
function onHKTermChange() {
  clearPreview()
}
function clearPreview() {
  preview.value = null
  previewError.value = ''
  if (previewTimer) {
    clearTimeout(previewTimer)
    previewTimer = null
  }
}

// 2026-08-16: 实时佣金预览 (400ms 防抖 + AbortController 取消旧请求)
watch(
  () => [form.product_type, form.hk_company, form.hk_code, form.hk_term, form.annual_premium, form.investor] as const,
  () => {
    if (previewTimer) clearTimeout(previewTimer)
    if (previewAbort) previewAbort.abort()
    preview.value = null
    previewError.value = ''

    if (
      form.product_type !== 'HK'
      || !form.hk_company || !form.hk_code || !form.hk_term
      || !form.annual_premium || form.annual_premium <= 0
    ) return

    previewTimer = setTimeout(async () => {
      previewAbort = new AbortController()
      loadingPreview.value = true
      try {
        // 2026-08-16: 改用 /lookup 而非 /preview, 拿到 y1_usd~y5_usd + add_usd + renew_usd 等按年明细
        // admin 录入需要看到完整 breakdown (drop down year-by-year)
        const res = await fetch('/api/rates/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            company: form.hk_company,
            code: form.hk_code,
            term: form.hk_term,
            premium: form.annual_premium,
            investor: form.investor,
            level: 'L2',  // admin 默认按 L2 预览 (与代理人视图一致)
          }),
          signal: previewAbort.signal,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.message || `HTTP ${res.status}`)
        }
        const data = await res.json()
        preview.value = {
          total_usd: data.total_usd || 0,
          points: data.points || 0,
          plan: data.plan || '',
          is_activity: data.is_activity ? 1 : 0,
          activity_deadline: data.activity_deadline || null,
          issue_deadline: data.issue_deadline || null,
          level: data.level || 'L2',
          investor: data.investor || form.investor,
          y1_usd: data.y1_usd || 0,
          y2_usd: data.y2_usd || 0,
          y3_usd: data.y3_usd || 0,
          y4_usd: data.y4_usd || 0,
          y5_usd: data.y5_usd || 0,
          renew_usd: data.renew_usd || 0,
          add_usd: data.add_usd || 0,
          direct_usd: data.direct_usd || 0,
          indirect_usd: data.indirect_usd || 0,
          total_pct: data.total_pct || 0,
          warnings: data.warnings || [],
        }
        if (preview.value.warnings.length > 0) {
          previewError.value = preview.value.warnings.join('; ')
        } else {
          previewError.value = ''
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        previewError.value = '预览失败: ' + (e?.message || e)
      } finally {
        loadingPreview.value = false
      }
    }, 400)
  },
)

const openCreate = () => {
  editing.value = false
  Object.assign(form, {
    id: '', user_id: '', product_type: 'HK', sold_at: new Date().toISOString().slice(0, 10),
    annual_premium: 0, payment_years: 1, policy_no: '',
    artist: '', work_title: '', sale_price: 0, currency: 'RMB',
    hk_company: '', hk_code: '', hk_plan: '', hk_term: 0,
    investor: 'pi',
  })
  clearPreview()
  dialogVisible.value = true
  loadHkProducts()  // 后台加载, 不阻塞 dialog
}

const openEdit = (row: any) => {
  editing.value = true
  // 2026-08-16: 从 commission_breakdown JSON 读 investor (老数据兼容, 默认 pi)
  const bdInvestor = (() => {
    try {
      const bd = typeof row.commission_breakdown === 'string'
        ? JSON.parse(row.commission_breakdown)
        : row.commission_breakdown
      return bd?.investor ?? 'pi'
    } catch { return 'pi' }
  })()
  Object.assign(form, {
    id: row.id,
    user_id: row.user_id,
    product_type: row.product_type,
    sold_at: row.sold_at ? row.sold_at.slice(0, 10) : '',
    annual_premium: row.annual_premium ?? 0,
    payment_years: row.payment_years ?? 1,
    policy_no: row.policy_no ?? '',
    artist: row.artist ?? '',
    work_title: row.work_title ?? '',
    sale_price: row.sale_price ?? 0,
    currency: row.currency ?? 'RMB',
    hk_company: row.hk_company ?? '',
    hk_code: row.hk_code ?? '',
    hk_plan: row.hk_plan ?? '',
    hk_term: row.hk_term ?? 0,
    investor: bdInvestor,
  })
  clearPreview()
  dialogVisible.value = true
  loadHkProducts()
}

const handleSave = async () => {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    saving.value = true
    try {
      const payload: any = {
        user_id: form.user_id,
        product_type: form.product_type,
        sold_at: form.sold_at,
      }
      if (isPolicy.value) {
        payload.annual_premium = form.annual_premium
        payload.payment_years = form.payment_years
        payload.policy_no = form.policy_no || undefined
        if (form.product_type === 'HK') {
          payload.hk_company = form.hk_company
          payload.hk_code = form.hk_code
          payload.hk_plan = form.hk_plan
          payload.hk_term = form.hk_term
          // 2026-08-16: 投资者类型 (默认 pi)
          payload.investor = form.investor
        }
      } else {
        payload.artist = form.artist
        payload.work_title = form.work_title
        payload.sale_price = form.sale_price
        payload.currency = form.currency
      }
      if (editing.value) {
        await request.patch(`${API_TX}/${form.id}`, payload)
        ElMessage.success('已更新')
      } else {
        await request.post(API_TX, payload)
        ElMessage.success('已录入')
      }
      dialogVisible.value = false
      fetchList()
    } catch (e: any) {
      ElMessage.error(e?.response?.data?.message || '保存失败')
    } finally {
      saving.value = false
    }
  })
}

const handleDelete = async (row: any) => {
  try {
    await ElMessageBox.confirm(`确认删除此条业绩?`, '提示', { type: 'warning' })
    await request.delete(`${API_TX}/${row.id}`)
    ElMessage.success('已删除')
    fetchList()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败')
  }
}

onMounted(() => {
  fetchUsers()
  fetchList()
})
</script>

<style scoped>
.transaction-container { background: #fff; border-radius: 8px; padding: 20px; }
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; }
.toolbar-right { margin-left: auto; }
.total-tip { color: #909399; font-size: 13px; }
/* 录入/编辑业绩对话框 - 表单区域滚动条 (2026-09-01: 长表单确认键被遮挡) */
.tx-form-scroll { max-height: 60vh; overflow-y: auto; padding-right: 8px; }
.summary-bar {
  background: #f8f9fc;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 12px 14px;
  margin-bottom: 16px;
}
.summary-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px;
}
.summary-title { font-weight: 600; font-size: 14px; color: #303133; }
.summary-hint { font-size: 12px; color: #909399; }
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}
.summary-cell {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 4px;
}
.summary-cell.cell-total {
  background: #f0f7ff;
  border-color: #b3d8ff;
}
.cell-count { font-size: 13px; color: #606266; font-weight: 500; }
.cell-line { font-size: 12px; color: #606266; }
.cell-line.strong { font-weight: 600; color: #303133; }
.pending-line { color: #c0c4cc; font-style: italic; font-size: 11px; }
.cell-commission { margin-top: 2px; padding-top: 4px; border-top: 1px dashed #ebeef5; }
.pagination-wrap { margin-top: 16px; display: flex; justify-content: flex-end; }
.num-cell {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px; color: #606266; font-weight: 500;
}
.form-tip-inline { margin-left: 8px; color: #909399; font-size: 13px; }
.pending { color: #c0c4cc; font-size: 12px; font-style: italic; }

/* 2026-08-16: 佣金明细 popover */
.commission-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 2px 0;
}
.commission-cell:hover .more-icon { color: #409eff; }
.commission-cell .num-cell.big {
  font-size: 14px;
  font-weight: 700;
  color: #d46b08;
}
.inv-tag { font-family: 'SF Mono', monospace; font-weight: 700; }
.more-icon { color: #c0c4cc; font-size: 10px; transition: color 0.15s; }
.bd-pop { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.bd-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid #ebeef5;
}
.bd-title { font-size: 14px; font-weight: 700; color: #303133; }
.bd-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 12px;
  color: #606266;
}
.bd-row.bd-total {
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px dashed #ebeef5;
  font-weight: 700;
  color: #303133;
}
.bd-row.bd-total .bd-val { color: #d46b08; font-size: 14px; }
.bd-val { font-family: 'SF Mono', Menlo, monospace; font-weight: 600; color: #303133; }
.bd-deadline {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed #ebeef5;
  font-size: 11px;
  color: #909399;
}

/* 2026-08-16: 录入弹窗佣金预览 popover */
.num-cell.big-preview {
  font-size: 16px;
  font-weight: 700;
  color: #d46b08;
  cursor: pointer;
}
.num-cell.big-preview:hover .more-icon { color: #409eff; }
.pv-pop { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.pv-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid #ebeef5;
}
.pv-title { font-size: 14px; font-weight: 700; color: #303133; }
.pv-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 12px;
  color: #606266;
}
.pv-row.pv-total {
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px dashed #ebeef5;
  font-weight: 700;
  color: #303133;
}
.pv-row.pv-total .pv-val { color: #d46b08; font-size: 14px; }
.pv-val { font-family: 'SF Mono', Menlo, monospace; font-weight: 600; color: #303133; }
.pv-deadline {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed #ebeef5;
  font-size: 11px;
  color: #909399;
}
</style>