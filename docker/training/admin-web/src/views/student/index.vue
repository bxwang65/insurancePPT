<template>
  <div class="student-container">
    <!-- 工具栏 -->
    <div class="toolbar">
      <el-input
        v-model="searchName"
        placeholder="搜索姓名"
        style="width: 200px;"
        clearable
        @clear="fetchStudents"
        @keyup.enter="fetchStudents"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="filterActive" placeholder="账号状态" clearable style="width: 130px;" @change="fetchStudents">
        <el-option label="已启用" :value="true" />
        <el-option label="已禁用" :value="false" />
      </el-select>
      <el-button type="primary" @click="fetchStudents">
        <el-icon><Search /></el-icon> 查询
      </el-button>
      <div class="toolbar-right">
        <el-button type="primary" @click="openCreateDialog">
          <el-icon><Plus /></el-icon> 新增员工
        </el-button>
        <el-button type="success" @click="openBatchDialog">
          <el-icon><Upload /></el-icon> 批量开通
        </el-button>
        <!-- 2026-08-14: 同步 Firebase 用户到培训 DB (Firebase 后台手动加的账号之前看不到) -->
        <el-button type="warning" @click="syncFirebaseUsers" :loading="syncing">
          <el-icon><Refresh /></el-icon> 同步 Firebase
        </el-button>
      </div>
    </div>

    <!-- 学员列表 -->
    <el-table :data="students" border stripe v-loading="loading">
      <el-table-column label="员工" min-width="180">
        <template #default="{ row }">
          <div class="student-cell">
            <el-avatar :size="40" :src="row.avatar_url" class="student-avatar">
              {{ row.name.slice(0, 1) }}
            </el-avatar>
            <div class="student-info">
              <div class="student-name">{{ row.name }}</div>
              <div class="student-phone">{{ row.phone }}</div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="role" label="角色" width="140" />
      <!-- 2026-08-12: 基本法 L/M 等级列 (移到第3列, 替换原"等级"列) -->
      <el-table-column label="L/M 等级" width="160">
        <template #default="{ row }">
          <div class="level-cell">
            <el-tag size="small" type="primary">L{{ row.current_level ?? 1 }}</el-tag>
            <el-tag size="small" type="warning" style="margin-left:4px;">M{{ row.current_management_level ?? 1 }}</el-tag>
            <!-- 2026-08-16: Phase 7 — pending 指示 + 维护期标记 -->
            <el-tooltip v-if="row.pending_level !== null && row.pending_level !== undefined && row.pending_level !== row.current_level"
                        :content="`预计 ${new Date(row.pending_effective_at).toLocaleDateString('zh-CN')} ${row.pending_level > row.current_level ? '升' : '降'} L${row.pending_level}`"
                        placement="top">
              <el-tag size="small" :type="row.pending_level > row.current_level ? 'success' : 'danger'" effect="plain" style="margin-left:4px;">
                ⏰
              </el-tag>
            </el-tooltip>
            <el-tooltip v-if="row.in_maintenance_until" :content="`维护期至 ${new Date(row.in_maintenance_until).toLocaleDateString('zh-CN')}`" placement="top">
              <el-tag size="small" type="warning" effect="plain" style="margin-left:4px;">
                🛡️
              </el-tag>
            </el-tooltip>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="total_learning_minutes" label="累计学时" width="100">
        <template #default="{ row }">
          {{ Math.round(row.total_learning_minutes / 60 * 10) / 10 }}h
        </template>
      </el-table-column>
      <!-- 2026-08-12: 业绩列 (HKD 销售额 + 综合得分 0-100) -->
      <el-table-column label="业绩" width="160" sortable :sort-by="(r:any) => r.sales_amount">
        <template #default="{ row }">
          <div class="performance-cell">
            <div class="sales">¥{{ (row.sales_amount ?? 0).toLocaleString() }}</div>
            <div class="score">
              <el-tag size="small" :type="getScoreType(row.performance_score)">
                {{ row.performance_score ?? 0 }} 分
              </el-tag>
            </div>
          </div>
        </template>
      </el-table-column>
      <!-- 2026-08-12: 招募人/主管列 (招管分离) -->
      <el-table-column label="招募人" min-width="110">
        <template #default="{ row }">
          <span v-if="row.recruiter_name" class="rel-name">{{ row.recruiter_name }}</span>
          <span v-else class="rel-empty">—</span>
        </template>
      </el-table-column>
      <el-table-column label="主管" min-width="110">
        <template #default="{ row }">
          <span v-if="row.manager_name" class="rel-name">{{ row.manager_name }}</span>
          <span v-else-if="row.recruiter_name" class="rel-auto">≈{{ row.recruiter_name }}</span>
          <span v-else class="rel-empty">—</span>
        </template>
      </el-table-column>
      <!-- 2026-08-12: 近 6 月业绩 (HK标保 / SG TP / ART件数) -->
      <el-table-column label="近6月 HK" width="100" sortable :sort-by="(r:any) => r.recent_6m_std_premium_HK">
        <template #default="{ row }">
          <span class="num-cell">${{ formatNum(row.recent_6m_std_premium_HK) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="近6月 SG" width="100" sortable :sort-by="(r:any) => r.recent_6m_std_premium_SG">
        <template #default="{ row }">
          <span class="num-cell">TP{{ formatNum(row.recent_6m_std_premium_SG) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="近6月 ART" width="100" sortable :sort-by="(r:any) => r.recent_6m_art_count">
        <template #default="{ row }">
          <span class="num-cell">{{ row.recent_6m_art_count ?? 0 }} 件</span>
        </template>
      </el-table-column>
      <el-table-column label="账号状态" width="100">
        <template #default="{ row }">
          <el-switch
            v-model="row.is_active"
            :loading="switchingId === row.id"
            @change="handleStatusChange(row)"
            active-text="启用"
            inactive-text="禁用"
            inline-prompt
            style="--el-switch-on-color: #67c23a; --el-switch-off-color: #f56c6c"
          />
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="入职日期" width="110">
        <template #default="{ row }">
          {{ formatDate(row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="380" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openPerformanceDialog(row)">业绩</el-button>
          <el-button link type="primary" size="small" @click="openManagerDialog(row)">改主管</el-button>
          <el-button link type="primary" size="small" @click="viewTree(row)">推管树</el-button>
          <el-button link type="primary" size="small" @click="viewDetail(row)">档案</el-button>
          <!-- 2026-08-14: 列表直接重置密码 — 比 drawer 里更显眼 -->
          <el-button link type="warning" size="small" @click="quickResetPassword(row)">改密码</el-button>
          <!-- 2026-08-14: 列表直接删 — 比 drawer 里更显眼, 二次确认 -->
          <el-button link type="danger" size="small" @click="quickDeleteStudent(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div class="pagination-wrap">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="limit"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @size-change="fetchStudents"
        @current-change="fetchStudents"
      />
    </div>

    <!-- 2026-08-13: 新版 "新增员工" — 邮箱+姓名, 创建 Firebase Auth + 培训 User
         替代旧版 phone+password (本地密码模式, 用户无法登录 hksgtools.cn) -->
    <el-dialog v-model="createDialogVisible" title="新增员工 (Firebase 账号)" width="520px" @close="resetCreateForm">
      <el-alert type="info" :closable="false" style="margin-bottom: 16px;">
        创建后员工可使用 <b>邮箱 + 123456</b> 登录 hksgtools.cn, 首次登录需改密.
      </el-alert>
      <el-form :model="createForm" :rules="createRules" ref="createFormRef" label-width="90px">
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="createForm.email" placeholder="员工邮箱 (登录账号)" />
        </el-form-item>
        <el-form-item label="姓名" prop="name">
          <el-input v-model="createForm.name" placeholder="员工姓名" />
        </el-form-item>
        <!-- 2026-08-23: 联系手机号 (可选, UI 不显示"选填"字样) -->
        <el-form-item label="手机号" prop="mobile">
          <el-input v-model="createForm.mobile" placeholder="如 13800138001" maxlength="20" />
        </el-form-item>
        <!-- 2026-08-14: 账户类型 — 普通用户 / 管理员 (最多 3 个管理员) -->
        <el-form-item label="账户类型" prop="is_admin">
          <el-radio-group v-model="createForm.is_admin">
            <el-radio :value="false">普通用户</el-radio>
            <el-radio :value="true">
              管理员
              <el-tag v-if="adminCount >= 3" type="danger" size="small" style="margin-left:6px;">已达上限 3</el-tag>
              <el-tag v-else-if="adminCount + (createForm.is_admin ? 1 : 0) > 3" type="warning" size="small" style="margin-left:6px;">
                已 {{ adminCount }} / 3
              </el-tag>
              <span v-else class="form-tip-inline">当前 {{ adminCount }} / 3</span>
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="头衔">
          <el-select v-model="createForm.title" placeholder="L1 / L2 / L3" clearable style="width: 100%">
            <el-option label="L1 (业务初级)" value="L1" />
            <el-option label="L2 (业务中级)" value="L2" />
            <el-option label="L3 (业务高级)" value="L3" />
          </el-select>
        </el-form-item>
        <el-form-item label="招募人">
          <el-select v-model="createForm.recruiter_id" placeholder="可选, 招管分离第1棵树" clearable filterable style="width: 100%">
            <el-option v-for="u in allUsers" :key="u.id" :label="u.name" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="主管">
          <el-select v-model="createForm.manager_id" placeholder="默认 = 招募人, 可覆盖" clearable filterable style="width: 100%">
            <el-option v-for="u in allUsers" :key="u.id" :label="u.name" :value="u.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreate">开通账号</el-button>
      </template>
    </el-dialog>

    <!-- 2026-08-13: 批量开通弹窗 (Excel 上传, 复用 4in1 AdminUsers.vue 的解析逻辑)
         默认密码 123456, 创建后员工立即可登录 hksgtools.cn -->
    <el-dialog v-model="batchDialogVisible" title="批量开通员工 (Excel)" width="780px" @close="resetBatchForm">
      <el-alert type="info" :closable="false" style="margin-bottom: 12px;">
        文件需包含 <b>邮箱</b> 和 <b>姓名</b> 两列 (顺序不限), 可选列: 手机号 / 头衔(L1/L2/L3) / 账户类型 / 招募人 / 主管.
        默认密码: <b>123456</b>, 创建后可立即登录 hksgtools.cn.
      </el-alert>
      <div class="row-buttons" style="margin-bottom: 16px;">
        <el-button @click="downloadBatchTemplate">📥 下载模板</el-button>
        <el-upload
          :auto-upload="false"
          :show-file-list="false"
          accept=".xlsx,.xls,.csv"
          :on-change="handleBatchFile"
        >
          <el-button type="primary">📤 选择 Excel / CSV</el-button>
        </el-upload>
      </div>

      <div v-if="batchParsed.length > 0" class="section">
        <div class="section-title">预览 ({{ batchParsed.length }} 条)</div>
        <el-table :data="batchParsed.slice(0, 50)" border stripe max-height="300">
          <el-table-column prop="email" label="邮箱" min-width="180" />
          <el-table-column prop="name" label="姓名" width="100" />
          <!-- 2026-08-23: 预览表加手机号列 -->
          <el-table-column prop="mobile" label="手机号" width="120" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag v-if="row.valid" type="success" size="small">✓ 有效</el-tag>
              <el-tag v-else type="danger" size="small">✗ {{ row.error }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="batchParsed.length > 50" class="more-hint">
          还有 {{ batchParsed.length - 50 }} 条未显示...
        </div>
      </div>

      <div v-if="batchResult" class="section result-section">
        <div class="section-title">执行结果</div>
        <div class="result-grid">
          <div class="result-card ok">
            <div class="result-num">{{ batchResult.data?.summary?.firebase_created ?? 0 }}</div>
            <div class="result-label">✅ Firebase 创建</div>
          </div>
          <div class="result-card warn">
            <div class="result-num">{{ batchResult.data?.summary?.firebase_skipped ?? 0 }}</div>
            <div class="result-label">⏭ 已存在</div>
          </div>
          <div class="result-card bad">
            <div class="result-num">{{ batchResult.data?.summary?.firebase_failed ?? 0 }}</div>
            <div class="result-label">❌ 失败</div>
          </div>
          <div class="result-card ok">
            <div class="result-num">{{ batchResult.data?.summary?.enriched_ok ?? 0 }}</div>
            <div class="result-label">📝 业务字段已补</div>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="batchDialogVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="batchValidCount === 0" :loading="batchLoading" @click="submitBatch">
          开通 {{ batchValidCount }} 个账号
        </el-button>
      </template>
    </el-dialog>

    <!-- 2026-08-12: 业绩编辑弹窗 (含头衔/等级/角色 一并维护) -->
    <el-dialog v-model="perfDialogVisible" :title="`业绩管理 - ${perfForm.name}`" width="520px">
      <el-form label-width="100px">
        <el-form-item label="业务业绩">
          <el-input-number
            v-model="perfForm.sales_amount"
            :min="0"
            :step="10000"
            style="width: 70%"
          />
          <span class="form-tip-inline">HKD</span>
        </el-form-item>
        <el-form-item label="综合得分">
          <el-slider
            v-model="perfForm.performance_score"
            :min="0"
            :max="100"
            :step="5"
            show-input
            show-stops
          />
        </el-form-item>
        <el-form-item label="头衔">
          <el-select v-model="perfForm.title" placeholder="L1 / L2 / L3" clearable style="width: 100%">
            <el-option label="L1 (业务初级)" value="L1" />
            <el-option label="L2 (业务中级)" value="L2" />
            <el-option label="L3 (业务高级)" value="L3" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色">
          <el-input v-model="perfForm.role" placeholder="如: 新人学员 / 进阶学员" />
        </el-form-item>
        <el-form-item label="等级">
          <el-select v-model="perfForm.level" style="width: 100%">
            <el-option label="新人训（1级）" :value="1" />
            <el-option label="衔接训（2级）" :value="2" />
            <el-option label="进阶训（3级）" :value="3" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="perfDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingPerf" @click="savePerformance">保存</el-button>
      </template>
    </el-dialog>

    <!-- 2026-08-12: 改主管 dialog (招管分离 override) -->
    <el-dialog v-model="mgrDialogVisible" :title="`改主管 - ${mgrForm.name}`" width="480px">
      <el-form label-width="100px">
        <el-form-item label="当前招募人">
          <span class="rel-display">{{ mgrForm.recruiter_name || '—' }}</span>
          <span class="rel-tip">（默认=招募人）</span>
        </el-form-item>
        <el-form-item label="当前主管">
          <span class="rel-display">{{ mgrForm.manager_name || '—' }}</span>
        </el-form-item>
        <el-form-item label="新主管" required>
          <el-select
            v-model="mgrForm.new_manager_id"
            filterable
            placeholder="选择新主管 (留空=移除主管)"
            style="width: 100%"
            :loading="loadingUsers"
          >
            <el-option label="— 移除主管 —" :value="null" />
            <el-option
              v-for="u in allUsers"
              :key="u.id"
              :label="`${u.name} (${u.phone})`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="改主管原因">
          <el-input v-model="mgrForm.reason" type="textarea" :rows="2" placeholder="如：B能力差, 需A配谈辅导培训" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="mgrDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingMgr" @click="saveManager">保存 (会写审计日志)</el-button>
      </template>
    </el-dialog>

    <!-- 档案详情抽屉 -->
    <el-drawer v-model="drawerVisible" size="780px" direction="rtl">
      <template #header>
        <div class="drawer-header">
          <span class="drawer-title">{{ detail?.name || '' }}</span>
        </div>
      </template>
      <div v-if="detail" class="drawer-content">
        <!-- 2026-08-16: tab 切换 (员工档案 / 费率速查) -->
        <div class="drawer-tabs">
          <div class="tab-headers">
            <div :class="['tab-header', drawerTab === 'profile' ? 'tab-active' : '']" @click="drawerTab = 'profile'">员工档案</div>
            <div :class="['tab-header', drawerTab === 'rates' ? 'tab-active' : '']" @click="drawerTab = 'rates'">费率速查</div>
          </div>
        </div>

        <!-- 员工档案 tab (包 profile-card + 所有 section-card) -->
        <div v-show="drawerTab === 'profile'">
        <div class="profile-card">
          <div class="profile-header">
            <el-avatar :size="64" :src="detail.avatar_url" class="profile-avatar">
              {{ detail.name.slice(0, 1) }}
            </el-avatar>
            <div class="profile-info">
              <div class="profile-name">{{ detail.name }}</div>
              <!-- 2026-08-17: 显示学员邮箱 (登录账号) -->
              <div class="profile-email">{{ detail.email || '—' }}</div>
              <div class="profile-role">{{ detail.role }} · {{ detail.title }}</div>
              <div class="profile-meta">
                <el-tag size="small" :type="detail.is_active ? 'success' : 'danger'">
                  {{ detail.is_active ? '已启用' : '已禁用' }}
                </el-tag>
                <el-tag size="small" type="success">{{ detail.level_name }}</el-tag>
              </div>
            </div>
          </div>
          <div class="profile-stats">
            <div class="profile-stat">
              <div class="pstat-value">{{ Math.round(detail.total_learning_minutes / 60 * 10) / 10 }}h</div>
              <div class="pstat-label">累计学时</div>
            </div>
            <div class="profile-stat">
              <div class="pstat-value">{{ detail.completed_courses }}</div>
              <div class="pstat-label">已完成</div>
            </div>
            <div class="profile-stat">
              <div class="pstat-value">{{ detail.in_progress_courses }}</div>
              <div class="pstat-label">进行中</div>
            </div>
          </div>
        </div>

        <div class="section-card">
          <div class="section-title">能力分布分析</div>
          <div ref="radarChartRef" class="radar-container"></div>
        </div>

        <div class="section-card">
          <div class="section-title">学习清单</div>
          <!-- 2026-08-17: 表格外层套横向滚动容器, 防止列多时溢出 drawer -->
          <div class="table-scroll">
            <el-table :data="detail.course_detail" border size="small">
              <el-table-column prop="course_title" label="课程名称" min-width="160" />
              <el-table-column prop="progress_percentage" label="进度" width="120">
                <template #default="{ row }">
                  <el-progress
                    :percentage="row.progress_percentage"
                    :status="row.completed ? 'success' : ''"
                    :stroke-width="8"
                  />
                </template>
              </el-table-column>
              <el-table-column label="状态" width="80">
                <template #default="{ row }">
                  <el-tag v-if="row.completed" size="small" type="success">已完成</el-tag>
                  <el-tag v-else-if="row.progress_percentage > 0" size="small" type="warning">进行中</el-tag>
                  <el-tag v-else size="small">未开始</el-tag>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>

        <!-- 2026-08-14: 个人业务画像 (基本法视角) -->
        <div class="section-card">
          <div class="section-title">
            业务画像
            <span v-if="business?.range" class="form-tip-inline">{{ business.range === 'month' ? '本月' : business.range === 'quarter' ? '本季' : '本年' }}</span>
          </div>
          <div v-if="!business" class="form-tip">加载中...</div>
          <template v-else>
            <!-- L + M 进度条 双卡 -->
            <div class="biz-progress-grid">
              <div class="biz-progress-card">
                <div class="biz-progress-head">
                  <span class="biz-progress-name">L 业务等级</span>
                  <el-tag size="small" :type="business.l_progress.reached ? 'success' : 'warning'">
                    {{ business.l_progress.current }}{{ business.l_progress.next ? ` → ${business.l_progress.next}` : ' (已达顶)' }}
                  </el-tag>
                </div>
                <div class="biz-progress-bar">
                  <el-progress
                    :percentage="business.l_progress.progress_pct"
                    :stroke-width="10"
                    :color="business.l_progress.progress_pct >= 95 ? '#f56c6c' : business.l_progress.progress_pct >= 80 ? '#e6a23c' : '#409eff'"
                  />
                </div>
                <div class="biz-progress-meta">
                  6m 标保 ¥{{ business.l_progress.current_sales?.toLocaleString() || 0 }}
                  <span v-if="business.l_progress.threshold"> / 阈值 ¥{{ business.l_progress.threshold.toLocaleString() }}</span>
                </div>
              </div>
              <div class="biz-progress-card">
                <div class="biz-progress-head">
                  <span class="biz-progress-name">M 管理等级</span>
                  <el-tag size="small" :type="business.m_progress.reached ? 'success' : 'primary'">
                    {{ business.m_progress.current }}{{ business.m_progress.next ? ` → ${business.m_progress.next}` : ' (已达顶)' }}
                  </el-tag>
                </div>
                <div class="biz-progress-bar">
                  <el-progress
                    :percentage="business.m_progress.progress_pct"
                    :stroke-width="10"
                    :color="business.m_progress.progress_pct >= 95 ? '#f56c6c' : business.m_progress.progress_pct >= 80 ? '#e6a23c' : '#67c23a'"
                  />
                </div>
                <div class="biz-progress-meta">
                  招 {{ business.m_progress.direct_recruits }} 人
                  <span v-if="business.m_progress.tree_6m_total !== undefined"> · 树 6m ¥{{ business.m_progress.tree_6m_total.toLocaleString() }}</span>
                </div>
              </div>
            </div>

            <!-- 月度 trend sparkline -->
            <div class="biz-trend-row" v-if="business.monthly_trend?.length">
              <div class="form-tip">近 6 月标保趋势</div>
              <div ref="bizSparkChartRef" class="biz-spark-container"></div>
              <div class="biz-trend-legend">
                <span class="legend-dot legend-hk"></span>HK
                <span class="legend-dot legend-sg" style="margin-left: 16px;"></span>SG
              </div>
            </div>

            <!-- 招管两棵树 -->
            <div class="biz-tree-grid">
              <div class="biz-tree-col">
                <div class="form-tip">
                  招我的人链 ({{ business.recruiter_chain?.length || 0 }})
                </div>
                <div v-if="!business.recruiter_chain?.length" class="form-tip-inline">(我是根节点)</div>
                <div v-else class="biz-chain">
                  <template v-for="(p, i) in business.recruiter_chain" :key="p.id">
                    <el-avatar :size="28" :src="p.avatar_url">{{ p.name.slice(0, 1) }}</el-avatar>
                    <span class="biz-chain-name">{{ p.name }}</span>
                    <span v-if="i < business.recruiter_chain.length - 1" class="biz-chain-arrow">→</span>
                  </template>
                </div>
              </div>
              <div class="biz-tree-col">
                <div class="form-tip">
                  管我的主管链 ({{ business.manager_chain?.length || 0 }})
                </div>
                <div v-if="!business.manager_chain?.length" class="form-tip-inline">(无上级主管)</div>
                <div v-else class="biz-chain">
                  <template v-for="(p, i) in business.manager_chain" :key="p.id">
                    <el-avatar :size="28" :src="p.avatar_url">{{ p.name.slice(0, 1) }}</el-avatar>
                    <span class="biz-chain-name">{{ p.name }}</span>
                    <span v-if="i < business.manager_chain.length - 1" class="biz-chain-arrow">→</span>
                  </template>
                </div>
              </div>
              <div class="biz-tree-col">
                <div class="form-tip">
                  我招的人 ({{ business.recruited?.length || 0 }})
                </div>
                <div v-if="!business.recruited?.length" class="form-tip-inline">(暂未招到人)</div>
                <div v-else class="biz-recruited">
                  <div v-for="r in business.recruited" :key="r.id" class="biz-recruited-item">
                    <el-avatar :size="24" :src="r.avatar_url">{{ r.name.slice(0, 1) }}</el-avatar>
                    <span class="biz-recruited-name">{{ r.name }}</span>
                    <el-tag size="small">L{{ r.current_level }}</el-tag>
                    <span class="biz-recruited-sales">¥{{ r.sales_amount.toLocaleString() }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- 2026-08-14: 档案内可编辑 招募人/主管, 创建时选错可即时改
             注意: 改 manager_id 同样会写 ManagerChangeLog 审计 (后端 users.service.update 已实现) -->
        <div class="section-card">
          <div class="section-title">组织关系 (可编辑)</div>
          <el-form label-width="90px" size="default">
            <el-form-item label="招募人">
              <el-select
                v-model="relForm.recruiter_id"
                filterable
                clearable
                placeholder="选择招募人 (招管分离第1棵树根)"
                style="width: 100%"
                :loading="loadingUsers"
                @visible-change="loadAllUsers"
              >
                <el-option v-for="u in allUsers" :key="u.id" :label="u.name" :value="u.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="主管">
              <el-select
                v-model="relForm.manager_id"
                filterable
                clearable
                placeholder="默认 = 招募人, 可覆盖"
                style="width: 100%"
                :loading="loadingUsers"
              >
                <el-option v-for="u in allUsers" :key="u.id" :label="u.name" :value="u.id" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingRel" @click="saveRel">保存组织关系</el-button>
              <span class="form-tip-inline">改主管会写审计日志</span>
            </el-form-item>
          </el-form>
        </div>

        <!-- 2026-08-14: 删除学员 — 级联删 progress/transaction/level_history, 不可恢复 -->
        <div class="section-card danger-zone">
          <div class="section-title">危险操作</div>
          <el-button type="warning" :loading="resettingPwd" @click="resetStudentPassword">重置密码为 123456</el-button>
          <el-button type="danger" :loading="deleting" @click="deleteStudent">删除该员工</el-button>
          <span class="form-tip-inline">重置后用户下次登录自动弹改密模态；删除会一并清除学习进度/业绩/等级变更记录</span>
        </div>
        </div>

        <!-- 费率速查 -->
        <div v-show="drawerTab === 'rates'" class="rates-lookup">
              <div class="rates-hint">
                💡 选 HK 产品 + 输入保费,可同时查 PI/NPI 在 L1/L2/L3 的佣金
                <span class="pending">(数据来自 insurance-ppt /api/rates/lookup)</span>
              </div>

              <el-form :model="rlForm" label-width="92px" label-position="left" size="small">
                <el-form-item label="HK 公司">
                  <el-select
                    v-model="rlForm.company"
                    placeholder="选择公司"
                    filterable
                    clearable
                    :loading="rlLoadingProducts"
                    @focus="rlLoadProducts"
                    @change="rlOnCompanyChange"
                    style="width: 100%"
                  >
                    <el-option v-for="c in rlCompanies" :key="c" :label="c" :value="c" />
                  </el-select>
                </el-form-item>
                <el-form-item label="HK 产品代码">
                  <el-select
                    v-model="rlForm.code"
                    placeholder="选择产品"
                    filterable
                    clearable
                    :disabled="!rlForm.company"
                    @change="rlOnCodeChange"
                    style="width: 100%"
                  >
                    <el-option
                      v-for="p in rlCodeOptions"
                      :key="`${p.code}|${p.plan}|${p.term}`"
                      :value="p.code"
                    >
                      <div style="display: flex; align-items: center; gap: 6px;">
                        <el-tag v-if="p.is_activity" type="success" size="small" style="flex-shrink: 0;">{{ p.term === 1 ? '活动·仅趸交' : '活动' }}</el-tag>
                        <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                          [{{ p.code || '空' }}] ({{ p.term }}年) — {{ p.plan }}
                        </span>
                      </div>
                    </el-option>
                  </el-select>
                </el-form-item>
                <el-form-item label="年期">
                  <el-select
                    v-model.number="rlForm.term"
                    placeholder="选择年期"
                    :disabled="rlAvailableTerms.length === 0"
                    style="width: 100%"
                  >
                    <el-option v-for="t in rlAvailableTerms" :key="t" :label="`${t}年`" :value="t" />
                  </el-select>
                </el-form-item>
                <el-form-item label="年缴保费">
                  <el-input-number
                    v-model="rlForm.premium"
                    :min="1000"
                    :step="10000"
                    :max="10000000"
                    :precision="0"
                    style="width: 100%"
                  />
                  <span class="form-tip-inline">USD / 年</span>
                </el-form-item>
                <el-form-item label="投资者">
                  <el-radio-group v-model="rlForm.investor">
                    <el-radio-button label="pi">PI</el-radio-button>
                    <el-radio-button label="npi">NPI</el-radio-button>
                  </el-radio-group>
                </el-form-item>
                <el-form-item>
                  <el-button type="primary" :loading="rlLoading" @click="rlLookup">
                    <el-icon><Search /></el-icon>
                    查 L1/L2/L3 佣金
                  </el-button>
                  <el-button @click="rlReset">
                    <el-icon><RefreshLeft /></el-icon>
                    重置
                  </el-button>
                </el-form-item>
              </el-form>

              <el-alert v-if="rlError" :title="rlError" type="error" :closable="false" show-icon class="result-card" />

              <div v-if="rlResults.length > 0" class="rates-grid">
                <div
                  v-for="r in rlResults"
                  :key="r.level"
                  class="rates-cell"
                  :class="{ 'rates-cell-active': r.level === 'L2' }"
                >
                  <div class="rates-cell-head">
                    <span class="rates-level">{{ r.level }}</span>
                    <el-tag v-if="r.is_activity" type="success" size="small">活动</el-tag>
                    <el-tag v-else type="info" size="small">非活动</el-tag>
                  </div>
                  <div v-if="r.loading" class="pending">计算中...</div>
                  <template v-else-if="r.data">
                    <div class="rates-line">
                      总佣金 <span class="big-num">${{ formatNum(r.data.total_usd) }}</span>
                    </div>
                    <div class="rates-line">
                      积分 <span class="big-num">${{ formatNum(r.data.points / 100) }}</span>
                      <span class="pending">({{ formatNum(r.data.points) }} 分)</span>
                    </div>
                    <div v-if="(r.data.issue_deadline || r.data.activity_deadline)" class="rates-deadline">
                      ⏰ 截止{{ r.data.issue_deadline ? '保单签发日' : '' }}{{ r.data.issue_deadline || r.data.activity_deadline }}
                    </div>
                  </template>
                  <div v-else-if="r.error" class="pending">{{ r.error }}</div>
                  <div v-else class="pending">—</div>
                </div>
              </div>
              <div v-else-if="rlResults.length === 0 && rlLastLookupAt" class="pending">查询完成,但该产品/年期无可用费率</div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, nextTick, computed } from 'vue'
import { Search, Plus, Upload, Refresh } from '@element-plus/icons-vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import request from '@/utils/request'
import * as echarts from 'echarts'

// ============ Types ============
interface StudentItem {
  id: string
  name: string
  phone: string
  email?: string
  avatar_url?: string
  role: string
  title?: string
  level: number
  level_name: string
  total_learning_minutes: number
  is_active: boolean
  // 2026-08-14: 是否管理员 (用于 quickDeleteStudent 守门: admin 不能删)
  is_admin?: boolean
  sales_amount?: number
  performance_score?: number
  performance_updated_at?: string | null
  created_at: string
  course_count: number
  // 2026-08-12: 基本法字段
  current_level?: number
  current_management_level?: number
  recruiter_id?: string | null
  recruiter_name?: string | null
  manager_id?: string | null
  manager_name?: string | null
  // 2026-08-14: main_product 字段已删除 (产品维度不再由 user 决定)
  joined_at?: string
  status?: string
  recent_6m_std_premium_HK?: number
  recent_6m_std_premium_SG?: number
  recent_6m_art_sales_RMB?: number
  recent_6m_art_count?: number
}

interface CourseDetail {
  course_id: string
  course_title: string
  progress_percentage: number
  completed: boolean
}

interface StudentDetail {
  id: string
  name: string
  email?: string
  avatar_url?: string
  role: string
  title?: string
  level: number
  level_name: string
  total_learning_minutes: number
  completed_courses: number
  in_progress_courses: number
  current_stage: string
  current_stage_name: string
  last_watched_at?: string
  is_active: boolean
  course_detail: CourseDetail[]
  radar_stats: { dimension: string; score: number }[]
  // 2026-08-14: 招管分离字段 (来自 /api/admin/stats/students/:id/detail)
  recruiter_id?: string | null
  recruiter_name?: string | null
  manager_id?: string | null
  manager_name?: string | null
}

// ============ State ============
const API_USERS = '/admin/users'
const API_STATS = '/admin/stats'

const students = ref<StudentItem[]>([])
const loading = ref(false)
const searchName = ref('')
const filterActive = ref<boolean | ''>('')
const page = ref(1)
const limit = ref(20)
const total = ref(0)

const switchingId = ref<string | null>(null)
const createDialogVisible = ref(false)
const creating = ref(false)
const createFormRef = ref<FormInstance>()
// 2026-08-13: 改 email-based, 后端调 insurance-ppt batch-create 创建 Firebase Auth 用户
// 2026-08-14: 加 is_admin (账户类型选择), 删 main_product (字段下线)
// 2026-08-23: 加 mobile 联系手机号 (可选, 不显示"选填"字样)
const createForm = reactive({
  email: '',
  name: '',
  mobile: '',
  title: '',
  is_admin: false,
  recruiter_id: '',
  manager_id: '',
})

// 2026-08-16: 档案 drawer tabs (员工档案 / 费率速查)
const drawerTab = ref<'profile' | 'rates'>('profile')

// 2026-08-16: 费率速查 state (复用 rates/index.vue 的 products + form 模式, 查 3 个 level)
interface RlProduct { company: string; code: string; plan: string; term: number; is_activity: number; activity_deadline: string | null }
interface RlResult { level: 'L1' | 'L2' | 'L3'; data: any | null; loading: boolean; error: string; is_activity: number }

const rlProductsPi = ref<RlProduct[]>([])
const rlProductsNpi = ref<RlProduct[]>([])
const rlLoadingProducts = ref(false)
const rlForm = reactive({
  company: '' as string,
  code: '' as string,
  term: 0 as number,
  premium: 100000,
  investor: 'pi' as 'pi' | 'npi',
})
const rlLoading = ref(false)
const rlError = ref('')
const rlResults = ref<RlResult[]>([])
const rlLastLookupAt = ref<Date | null>(null)
// 2026-08-16: PI + NPI 合并, 不再 is_activity 过滤 (历史产品也能查)
const rlProductsMerged = computed(() => {
  const seen = new Set<string>()
  const out: RlProduct[] = []
  for (const p of [...rlProductsPi.value, ...rlProductsNpi.value]) {
    const k = `${p.company}|${p.code}|${p.term}`
    if (!seen.has(k)) { seen.add(k); out.push(p) }
  }
  return out.sort((a, b) => (a.code || '').localeCompare(b.code || '') || a.term - b.term)
})
const rlCompanies = computed(() => Array.from(new Set(rlProductsMerged.value.map((p) => p.company))).sort())
const rlCodeOptions = computed(() => rlProductsMerged.value.filter((p) => p.company === rlForm.company))
const rlAvailableTerms = computed(() => {
  const terms = rlCodeOptions.value.filter((p) => p.code === rlForm.code).map((p) => p.term)
  return Array.from(new Set(terms)).sort((a, b) => a - b)
})

function rlGetAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function rlLoadProducts() {
  // 2026-08-16: 任何一张已加载就跳过 (避免反复拉)
  if (rlProductsPi.value.length > 0 || rlProductsNpi.value.length > 0) return
  rlLoadingProducts.value = true
  try {
    // 2026-08-16: 并行拉 PI 和 NPI, dropdown 合并展示 (PI+NPI 全产品可见, 含历史已停)
    const [piRes, npiRes] = await Promise.all([
      fetch('/api/rates/products?level=L2&investor=pi', { headers: rlGetAuthHeaders() }),
      fetch('/api/rates/products?level=L2&investor=npi', { headers: rlGetAuthHeaders() }),
    ])
    if (piRes.ok) {
      const piData = await piRes.json()
      rlProductsPi.value = piData.items || []
    }
    if (npiRes.ok) {
      const npiData = await npiRes.json()
      rlProductsNpi.value = npiData.items || []
    }
    if (!piRes.ok && !npiRes.ok) {
      throw new Error(`HTTP ${piRes.status}`)
    }
  } catch (e: any) {
    rlError.value = '产品列表加载失败: ' + (e?.message || e)
  } finally {
    rlLoadingProducts.value = false
  }
}

function rlOnCompanyChange() {
  rlForm.code = ''
  rlForm.term = 0
  rlResults.value = []
  rlLastLookupAt.value = null
}
function rlOnCodeChange() {
  const terms = rlAvailableTerms.value
  rlForm.term = terms.length > 0 ? terms[0] : 0
  rlResults.value = []
  rlLastLookupAt.value = null
}

async function rlLookup() {
  if (!rlForm.company || !rlForm.code || !rlForm.term || !rlForm.premium) {
    ElMessage.warning('请选齐公司/产品/年期, 并输入保费')
    return
  }
  rlError.value = ''
  // 初始化 3 个 level 槽位 (并发请求)
  rlResults.value = (['L1', 'L2', 'L3'] as const).map((lv) => ({
    level: lv,
    data: null,
    loading: true,
    error: '',
    is_activity: 0,
  }))
  rlLoading.value = true
  rlLastLookupAt.value = new Date()
  try {
    const promises = (['L1', 'L2', 'L3'] as const).map(async (lv) => {
      try {
        const res = await fetch('/api/rates/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...rlGetAuthHeaders() },
          body: JSON.stringify({
            company: rlForm.company,
            code: rlForm.code,
            term: rlForm.term,
            premium: rlForm.premium,
            level: lv,
            investor: rlForm.investor,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.message || `HTTP ${res.status}`)
        }
        const data = await res.json()
        return { level: lv, data, error: '', is_activity: data.is_activity || 0 }
      } catch (e: any) {
        return { level: lv, data: null, error: e?.message || String(e), is_activity: 0 }
      }
    })
    const settled = await Promise.all(promises)
    rlResults.value = rlResults.value.map((slot) => {
      const s = settled.find((x) => x.level === slot.level)!
      return { ...slot, data: s.data, loading: false, error: s.error, is_activity: s.is_activity }
    })
  } finally {
    rlLoading.value = false
  }
}

function rlReset() {
  rlForm.company = ''
  rlForm.code = ''
  rlForm.term = 0
  rlForm.premium = 100000
  rlForm.investor = 'pi'
  rlResults.value = []
  rlError.value = ''
  rlLastLookupAt.value = null
}

// 2026-08-14: 已存在的 admin 数量 (创建对话框 / 改权限时校验 ≤3)
const adminCount = ref(0)
async function loadAdminCount() {
  try {
    const res: any = await request.get(API_USERS, { params: { limit: 1000 } })
    const users = res?.data?.users ?? res?.users ?? []
    adminCount.value = users.filter((u: any) => u.is_admin).length
  } catch {
    adminCount.value = 0
  }
}
const createRules: FormRules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  // 2026-08-23: mobile 可选, 但若填写最长 20 字符 (后端 DTO Length(0, 20))
  mobile: [
    { max: 20, message: '手机号长度不能超过 20 位', trigger: 'blur' },
  ],
}

// ============ 2026-08-13: 批量开通 (Excel 上传) ============
const batchDialogVisible = ref(false)
// 2026-08-14: 批量行类型 — 加 is_admin (账户类型), 删 main_product
// 2026-08-23: 加 mobile 联系手机号 (可选)
const batchParsed = ref<Array<{ email: string; name: string; mobile?: string; title?: string; is_admin?: boolean; recruiter_id?: string; manager_id?: string; valid: boolean; error?: string }>>([])
const batchLoading = ref(false)
const batchResult = ref<any>(null)
const batchValidCount = computed(() => batchParsed.value.filter((u) => u.valid).length)

const openBatchDialog = () => {
  batchDialogVisible.value = true
  batchParsed.value = []
  batchResult.value = null
  loadAdminCount()
}
const resetBatchForm = () => {
  batchParsed.value = []
  batchResult.value = null
}

function isValidEmail(v: string) {
  return /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(v)
}

function parseBatchWorkbook(arrayBuffer: ArrayBuffer) {
  // 2026-08-13: 复用 4in1 AdminUsers.vue 的 xlsx 解析逻辑
  // 2026-08-14: 头衔 L1/L2/L3 校验, 账户类型 (普通用户/管理员) → is_admin bool
  import('xlsx').then((XLSX) => {
    try {
      const data = new Uint8Array(arrayBuffer)
      const wb = XLSX.read(data, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
      batchParsed.value = rows.map((r: any) => {
        const email = String(r['邮箱'] ?? r['email'] ?? r['Email'] ?? r['EMAIL'] ?? '').trim()
        const name = String(r['姓名'] ?? r['名字'] ?? r['name'] ?? r['Name'] ?? r['NAME'] ?? '').trim()
        // 2026-08-23: 手机号列 (Excel 表头用"手机号", 也接受 "mobile"/"联系手机" 别名)
        const mobileRaw = String(r['手机号'] ?? r['mobile'] ?? r['联系手机'] ?? '').trim()
        const titleRaw = String(r['头衔'] ?? r['title'] ?? '').trim()
        const accountTypeRaw = String(r['账户类型'] ?? r['account_type'] ?? '').trim()
        const recruiter_id = String(r['招募人ID'] ?? r['recruiter_id'] ?? '').trim()
        const manager_id = String(r['主管ID'] ?? r['manager_id'] ?? '').trim()
        let valid = true
        let error = ''
        if (!email) { valid = false; error = '缺少邮箱' }
        else if (!isValidEmail(email)) { valid = false; error = '邮箱格式错误' }
        else if (!name) { valid = false; error = '缺少姓名' }
        // 2026-08-23: 手机号长度校验 (与后端 DTO Length(0, 20) 对齐)
        if (mobileRaw && mobileRaw.length > 20) {
          valid = false
          error = '手机号长度不能超过 20 位'
        }
        // 头衔校验 L1/L2/L3 (空值允许)
        const title = (titleRaw || undefined)
        if (titleRaw && !['L1', 'L2', 'L3'].includes(titleRaw)) {
          valid = false
          error = `头衔必须是 L1/L2/L3, 当前 "${titleRaw}"`
        }
        // 账户类型 (普通/管理员/普通用户/管理员用户) → is_admin
        const is_admin = /^(管理员|admin|ADMIN|1|true|yes)$/i.test(accountTypeRaw)
        return {
          email,
          name,
          mobile: mobileRaw || undefined,
          title,
          is_admin: accountTypeRaw ? is_admin : false,
          recruiter_id: recruiter_id || undefined,
          manager_id: manager_id || undefined,
          valid,
          error,
        }
      })
    } catch (err: any) {
      ElMessage.error('文件解析失败: ' + (err?.message || err))
    }
  })
}

const handleBatchFile = (file: any) => {
  batchResult.value = null
  const reader = new FileReader()
  reader.onload = (ev: any) => parseBatchWorkbook(ev.target.result)
  reader.readAsArrayBuffer(file.raw)
}

const downloadBatchTemplate = async () => {
  const XLSX = await import('xlsx')
  // 2026-08-14: 头衔 L1/L2/L3, 删主推产品, 加账户类型 (普通用户/管理员)
  // 2026-08-23: 加手机号列 (可选, 表头不写"选填"字样)
  const ws = XLSX.utils.aoa_to_sheet([
    ['邮箱', '姓名', '手机号', '头衔', '账户类型', '招募人ID', '主管ID'],
    ['alice@example.com', '张三', '13800138001', 'L1', '普通用户', '', ''],
    ['bob@example.com', '李四', '', 'L2', '管理员', '', ''],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '批量开通员工')
  XLSX.writeFile(wb, '员工批量开通模板.xlsx')
}

const submitBatch = async () => {
  const valid = batchParsed.value.filter((u) => u.valid)
  if (valid.length === 0) return
  batchLoading.value = true
  try {
    const res: any = await request.post(`${API_USERS}/batch`, {
      users: valid.map((u) => ({
        email: u.email,
        name: u.name,
        // 2026-08-23: 透传手机号 (可选)
        mobile: u.mobile || undefined,
        title: u.title || undefined,
        is_admin: u.is_admin === true,
        recruiter_id: u.recruiter_id || undefined,
        manager_id: u.manager_id || undefined,
      })),
    })
    batchResult.value = res
    const s = res?.data?.summary
    ElMessage.success(`开通完成: Firebase ${s?.firebase_created ?? 0} 创建 / ${s?.firebase_skipped ?? 0} 已存在 / ${s?.firebase_failed ?? 0} 失败`)
    fetchStudents()
    loadAdminCount()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '批量开通失败')
  } finally {
    batchLoading.value = false
  }
}

const drawerVisible = ref(false)
const detail = ref<StudentDetail | null>(null)
const radarChartRef = ref<HTMLDivElement>()
let radarChart: echarts.ECharts | null = null

// 2026-08-14: 档案内编辑 招募人/主管 用
const relForm = reactive({
  id: '',
  recruiter_id: '' as string | null,
  manager_id: '' as string | null,
})
const savingRel = ref(false)

// 2026-08-14: 个人业务画像 (业务进度 + 招管树 + sparkline)
const business = ref<any>(null)
const bizSparkChartRef = ref<HTMLDivElement>()
let bizSparkChart: echarts.ECharts | null = null

const fetchBusiness = async (userId: string) => {
  try {
    const res = await request.get(`${API_STATS}/students/${userId}/business`)
    const d = res.data || res
    if (d && d.l_progress) {
      business.value = d
      nextTick(() => initBizSpark())
    }
  } catch (e: any) {
    console.error('获取业务画像失败', e)
  }
}

const initBizSpark = () => {
  if (!bizSparkChartRef.value || !business.value) return
  const trend = business.value.monthly_trend || []
  if (!trend.length) return
  const months = trend.map((t: any) => t.month.slice(5))  // MM
  const hkData = trend.map((t: any) => t.HK)
  const sgData = trend.map((t: any) => t.SG)
  if (bizSparkChart) { bizSparkChart.dispose(); bizSparkChart = null }
  bizSparkChart = echarts.init(bizSparkChartRef.value)
  bizSparkChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { show: false },
    grid: { left: 36, right: 12, top: 10, bottom: 28 },
    xAxis: { type: 'category', data: months, axisLabel: { color: '#666', fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { color: '#999', fontSize: 10 } },
    series: [
      {
        name: 'HK', type: 'bar', stack: 'total', data: hkData,
        itemStyle: { color: '#409eff', borderRadius: [3, 3, 0, 0] },
        barWidth: '40%',
      },
      {
        name: 'SG', type: 'bar', stack: 'total', data: sgData,
        itemStyle: { color: '#67c23a', borderRadius: [3, 3, 0, 0] },
      },
    ],
  }, true)
}

// ============ Methods ============
const formatDate = (isoStr: string) => {
  if (!isoStr) return ''
  return isoStr.split('T')[0]
}

// 2026-08-16: 学生档案页面引入了 getLevelType 但模板里没用 (Phase 4 build 阻塞), 删掉以让 vue-tsc 通过
const getLevelType = (level: number) => {
  if (level >= 3) return 'danger'
  if (level >= 2) return 'warning'
  return 'success'
}
void getLevelType  // 显式标记使用, 避免 TS6133

const getScoreType = (score: number) => {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'info'
}

// 2026-08-12: 格式化数字 (千分位)
const formatNum = (n: number) => (n ?? 0).toLocaleString()

// ============ 2026-08-12: 业绩编辑弹窗 ============
const perfDialogVisible = ref(false)
const savingPerf = ref(false)
const perfForm = reactive({
  id: '',
  name: '',
  sales_amount: 0,
  performance_score: 0,
  title: '',
  role: '',
  level: 1,
})

const openPerformanceDialog = (row: StudentItem) => {
  Object.assign(perfForm, {
    id: row.id,
    name: row.name,
    sales_amount: row.sales_amount ?? 0,
    performance_score: row.performance_score ?? 0,
    title: row.title || '',
    role: row.role || '',
    level: row.level,
  })
  perfDialogVisible.value = true
}

const savePerformance = async () => {
  savingPerf.value = true
  try {
    await request.patch(`${API_USERS}/${perfForm.id}`, {
      sales_amount: perfForm.sales_amount,
      performance_score: perfForm.performance_score,
      title: perfForm.title || undefined,
      role: perfForm.role || undefined,
      level: perfForm.level,
    })
    ElMessage.success('业绩已保存')
    perfDialogVisible.value = false
    fetchStudents()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '保存失败')
  } finally {
    savingPerf.value = false
  }
}

// 2026-08-14: 同步 Firebase 用户 → 培训 DB (走 4in1 /api/admin/firebase/sync-to-training)
//   - request baseURL 指向培训 backend, 但这个端点在 4in1 server.ts
//   - 所以用 raw fetch + 同源 localStorage.token
const syncing = ref(false)
const syncFirebaseUsers = async () => {
  if (!confirm('将遍历 Firebase Authentication 所有账号并写入培训数据库。\n\n仅首次迁移或新增 Firebase 账号时使用。\n确定继续？')) return
  syncing.value = true
  try {
    const token = localStorage.getItem('token') || ''
    const r = await fetch('/api/admin/firebase/sync-to-training', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    const data = await r.json().catch(() => null)
    if (!r.ok) {
      ElMessage.error(data?.message || `同步失败 HTTP ${r.status}`)
      return
    }
    const msg = `Firebase 总数 ${data.total} → 培训同步成功 ${data.synced}` +
      (data.skippedNoEmail ? `, 跳过无邮箱 ${data.skippedNoEmail}` : '') +
      (data.errors?.length ? `, 失败 ${data.errors.length}` : '')
    if (data.errors?.length) {
      ElMessage.warning(msg + `\n失败明细: ${data.errors.slice(0, 3).map((e: any) => e.error).join('; ')}`)
    } else {
      ElMessage.success(msg)
    }
    fetchStudents()
  } catch (e: any) {
    ElMessage.error(e?.message || '同步失败')
  } finally {
    syncing.value = false
  }
}

const fetchStudents = async () => {
  loading.value = true
  try {
    const params: any = { page: page.value, limit: limit.value }
    if (searchName.value) params.name = searchName.value
    if (filterActive.value !== '') params.is_active = filterActive.value

    const res = await request.get(API_USERS, { params })
    const resData = res.data || res

    if (resData && resData.users) {
      students.value = resData.users
      total.value = resData.total || 0
    } else if (Array.isArray(resData)) {
      students.value = resData
      total.value = resData.length
    }
  } catch (e: any) {
    ElMessage.error('获取员工列表失败: ' + (e.message || ''))
  } finally {
    loading.value = false
  }
}

const openCreateDialog = () => {
  resetCreateForm()
  createDialogVisible.value = true
  loadAllUsers()
  loadAdminCount()
}

// 2026-08-14: 提取全员列表加载, 创建对话框 / 改主管对话框共享
async function loadAllUsers() {
  if (allUsers.value.length > 0) return
  loadingUsers.value = true
  try {
    const res: any = await request.get(API_USERS, { params: { limit: 1000 } })
    const users = res?.data?.users ?? res?.users ?? []
    allUsers.value = users.map((u: any) => ({ id: u.id, name: u.name, phone: u.phone }))
  } catch {
    ElMessage.warning('员工列表加载失败')
  } finally {
    loadingUsers.value = false
  }
}

const resetCreateForm = () => {
  // 2026-08-14: 重置时 is_admin=false, 移除 main_product
  // 2026-08-23: 重置 mobile=''
  Object.assign(createForm, { email: '', name: '', mobile: '', title: '', is_admin: false, recruiter_id: '', manager_id: '' })
  createFormRef.value?.resetFields()
}

const handleCreate = async () => {
  if (!createFormRef.value) return
  await createFormRef.value.validate(async (valid) => {
    if (!valid) return
    creating.value = true
    try {
      // 2026-08-13: 改用 batch 接口 (单条), 后端会创建 Firebase Auth + 培训 User + 补充业务字段
      // 2026-08-14: 加 is_admin, 移除 main_product
      // 2026-08-23: 透传 mobile (可选)
      const res: any = await request.post(`${API_USERS}/batch`, {
        users: [{
          email: createForm.email,
          name: createForm.name,
          mobile: createForm.mobile || undefined,
          title: createForm.title || undefined,
          is_admin: createForm.is_admin === true,
          recruiter_id: createForm.recruiter_id || undefined,
          manager_id: createForm.manager_id || undefined,
        }],
      })
      const s = res?.data?.summary
      if (s?.firebase_failed > 0) {
        ElMessage.warning(`Firebase 创建失败: ${s.firebase_failed}, 详情请查看批量开通面板`)
      } else {
        ElMessage.success(`账号已开通, 可用 ${createForm.email} + 123456 登录 hksgtools.cn`)
      }
      createDialogVisible.value = false
      resetCreateForm()
      fetchStudents()
      loadAdminCount()
    } catch (e: any) {
      ElMessage.error(e?.response?.data?.message || '创建失败')
    } finally {
      creating.value = false
    }
  })
}

const handleStatusChange = async (row: StudentItem) => {
  const action = row.is_active ? '启用' : '禁用'
  switchingId.value = row.id
  try {
    await request.patch(`${API_USERS}/${row.id}/status`, { is_active: row.is_active })
    ElMessage.success(`${action}成功`)
  } catch (e: any) {
    // 回滚 switch
    row.is_active = !row.is_active
    ElMessage.error(`${action}失败`)
  } finally {
    switchingId.value = null
  }
}

const viewDetail = async (row: StudentItem) => {
  try {
    const res = await request.get(`${API_STATS}/students/${row.id}/detail`)
    const resData = res.data || res
    if (resData && resData.course_detail) {
      detail.value = resData
      // 2026-08-14: 初始化招募人/主管 编辑表单
      relForm.id = resData.id
      relForm.recruiter_id = resData.recruiter_id ?? null
      relForm.manager_id = resData.manager_id ?? null
      drawerVisible.value = true
      nextTick(() => initRadar())
      loadAllUsers()
      // 2026-08-14: 同时加载业务画像 (L/M 进度 + 招管树 + sparkline)
      fetchBusiness(row.id)
    }
  } catch (e: any) {
    ElMessage.error('获取详情失败: ' + (e.message || ''))
  }
}

// 2026-08-14: 档案 drawer 内保存 招募人/主管
const saveRel = async () => {
  if (!relForm.id) return
  savingRel.value = true
  try {
    await request.patch(`${API_USERS}/${relForm.id}`, {
      recruiter_id: relForm.recruiter_id || null,
      manager_id: relForm.manager_id || null,
    })
    ElMessage.success('组织关系已更新')
    fetchStudents()
    if (detail.value) {
      detail.value.recruiter_id = relForm.recruiter_id
      detail.value.manager_id = relForm.manager_id
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '保存失败')
  } finally {
    savingRel.value = false
  }
}

// 2026-08-14: 删除学员 — 二次确认, 后端 cascade 删 progress/transaction/level_history
const deleting = ref(false)
const deleteStudent = async () => {
  if (!detail.value) return
  const id = detail.value.id
  const name = detail.value.name
  if (!confirm(`确定删除员工「${name}」？\n此操作不可恢复, 会一并清除学习进度/业绩/等级历史。`)) return
  if (!confirm(`再次确认: 删除「${name}」的账号 + 全部业务数据？`)) return
  deleting.value = true
  try {
    await request.delete(`${API_USERS}/${id}`)
    ElMessage.success('员工已删除')
    drawerVisible.value = false
    detail.value = null
    fetchStudents()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

// 2026-08-14: 重置员工密码为 123456 (admin 操作, 用户下次登录会弹改密模态)
const resettingPwd = ref(false)
const resetStudentPassword = async () => {
  if (!detail.value) return
  const id = detail.value.id
  const name = detail.value.name
  const email = detail.value.email
  if (!confirm(`将「${name}」(${email}) 的密码重置为默认 123456。\n用户下次登录会强制弹窗改密。\n\n确定继续？`)) return
  resettingPwd.value = true
  try {
    await request.post(`${API_USERS}/${id}/reset-password`)
    ElMessage.success(`已重置「${name}」密码为 123456`)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message?.message || e?.response?.data?.message || '重置失败')
  } finally {
    resettingPwd.value = false
  }
}

// 2026-08-14: 列表行直接删除 (无需进 drawer), 二次确认, 后端 cascade
async function quickDeleteStudent(row: StudentItem) {
  if (row.is_admin) {
    ElMessage.error('不能删除 admin 账号, 请先降权')
    return
  }
  if (!confirm(`确定从列表删除「${row.name}」？\n此操作不可恢复, 会一并清除学习进度/业绩/等级历史。`)) return
  if (!confirm(`再次确认: 删除「${row.name}」的账号 + 全部业务数据？`)) return
  try {
    await request.delete(`${API_USERS}/${row.id}`)
    ElMessage.success(`员工「${row.name}」已删除`)
    fetchStudents()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '删除失败')
  }
}

// 2026-08-14: 行级重置密码 (跟 quickDeleteStudent 同位, 单次确认即可)
async function quickResetPassword(row: StudentItem) {
  if (row.is_admin) {
    ElMessage.error('不能重置 admin 密码, 请走 forgot-password 自助流程')
    return
  }
  if (!confirm(`将「${row.name}」(${row.email || '无 email'}) 的密码重置为 123456？\n用户下次登录会自动弹窗改密。`)) return
  try {
    await request.post(`${API_USERS}/${row.id}/reset-password`)
    ElMessage.success(`「${row.name}」密码已重置为 123456`)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message?.message || e?.response?.data?.message || '重置失败')
  }
}

// ============ 2026-08-12: 改主管 dialog (招管分离 override) ============
const mgrDialogVisible = ref(false)
const savingMgr = ref(false)
const loadingUsers = ref(false)
const allUsers = ref<{ id: string; name: string; phone: string }[]>([])
const mgrForm = reactive({
  id: '',
  name: '',
  recruiter_name: '',
  manager_name: '',
  new_manager_id: null as string | null,
  reason: '',
})

const openManagerDialog = async (row: StudentItem) => {
  Object.assign(mgrForm, {
    id: row.id,
    name: row.name,
    recruiter_name: row.recruiter_name || '',
    manager_name: row.manager_name || '',
    new_manager_id: row.manager_id ?? null,
    reason: '',
  })
  mgrDialogVisible.value = true
  loadAllUsers()
}

const saveManager = async () => {
  savingMgr.value = true
  try {
    await request.patch(`${API_USERS}/${mgrForm.id}`, {
      manager_id: mgrForm.new_manager_id,
      manager_change_reason: mgrForm.reason || undefined,
    })
    ElMessage.success('主管已更新 (已写审计日志)')
    mgrDialogVisible.value = false
    fetchStudents()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '保存失败')
  } finally {
    savingMgr.value = false
  }
}

// 推管树跳转: 把 user id 写到 sessionStorage, /admin/tree 页面读
const viewTree = (row: StudentItem) => {
  sessionStorage.setItem('tree_focus_user_id', row.id)
  sessionStorage.setItem('tree_focus_user_name', row.name)
  window.location.hash = '#/tree'
}

const initRadar = () => {
  if (!radarChartRef.value || !detail.value) return
  if (radarChart) { radarChart.dispose(); radarChart = null }
  radarChart = echarts.init(radarChartRef.value)

  const indicator = detail.value.radar_stats.map((s) => ({ name: s.dimension, max: 100 }))
  radarChart.setOption({
    tooltip: {},
    radar: {
      indicator,
      radius: '65%',
      axisName: { color: '#666', fontSize: 13 },
    },
    series: [{
      type: 'radar',
      data: [{
        value: detail.value!.radar_stats.map((s) => s.score),
        name: '能力分布',
        areaStyle: { color: 'rgba(64,158,255,0.2)' },
        lineStyle: { color: '#409eff' },
        itemStyle: { color: '#409eff' },
      }],
    }],
  })
}

onMounted(() => {
  fetchStudents()
})
</script>

<style scoped>
.student-container {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
}

.toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  align-items: center;
}

.toolbar-right {
  margin-left: auto;
}

.student-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.performance-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  line-height: 1.2;
}
.performance-cell .sales {
  font-weight: 600;
  color: #303133;
  font-size: 13px;
}
.performance-cell .score {
  font-size: 12px;
}
.form-tip-inline {
  margin-left: 8px;
  color: #909399;
  font-size: 13px;
}

.student-avatar {
  background: #409eff;
  color: #fff;
  flex-shrink: 0;
}

.student-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.student-name {
  font-weight: 600;
  color: #303133;
  font-size: 14px;
}

.student-phone {
  font-size: 12px;
  color: #909399;
}

.pagination-wrap {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
}

/* 抽屉 */
.drawer-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* 2026-08-17: 档案内容超长时强制纵向滚动, 防止被裁切
     el-drawer 自带 overflow, 但保险起见再加 max-height 兜底 */
  overflow-y: auto;
  max-height: calc(100vh - 80px);
  padding-right: 4px;
}

/* 2026-08-17: 表格横向滚动容器 — drawer 780px 宽, 列多时水平溢出 */
.table-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  width: 100%;
}

.profile-card {
  background: linear-gradient(135deg, #409eff, #79bbff);
  border-radius: 12px;
  padding: 20px;
  color: #fff;
}

.profile-header {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 16px;
}

.profile-avatar {
  background: rgba(255, 255, 255, 0.3);
  color: #fff;
  font-size: 24px;
  flex-shrink: 0;
}

.profile-name {
  font-size: 20px;
  font-weight: 700;
  color: #fff;
}

/* 2026-08-17: 学员邮箱 (登录账号) — 半透明白色字 */
.profile-email {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  margin-top: 2px;
  font-family: monospace;
  word-break: break-all;
}

.profile-role {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  margin: 4px 0;
}

.profile-meta {
  display: flex;
  gap: 6px;
}

.profile-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.profile-stat {
  text-align: center;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 10px 8px;
}

.pstat-value {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
}

.pstat-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.75);
  margin-top: 2px;
}

.section-card {
  background: #fafafa;
  border-radius: 8px;
  padding: 16px;
  border: 1px solid #f0f0f0;
}

.danger-zone {
  border-color: #fbc4c4;
  background: #fef0f0;
}
.danger-zone .section-title {
  color: #c45656;
}

/* ===== 2026-08-14: 个人业务画像 ===== */
.biz-progress-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
}

.biz-progress-card {
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  padding: 12px;
}

.biz-progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.biz-progress-name {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.biz-progress-bar {
  margin-bottom: 6px;
}

.biz-progress-meta {
  font-size: 12px;
  color: #909399;
}

.biz-trend-row {
  margin-bottom: 16px;
  padding: 12px;
  background: #fff;
  border-radius: 6px;
  border: 1px solid #f0f0f0;
}

.biz-spark-container {
  width: 100%;
  height: 140px;
  margin-top: 4px;
}

.biz-trend-legend {
  font-size: 12px;
  color: #606266;
  margin-top: 4px;
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 4px;
  vertical-align: middle;
}

.legend-hk { background: #409eff; }
.legend-sg { background: #67c23a; }

.biz-tree-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}

.biz-tree-col {
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  padding: 10px;
  min-height: 80px;
}

.biz-chain {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.biz-chain-name {
  font-size: 12px;
  color: #303133;
  margin: 0 2px;
}

.biz-chain-arrow {
  color: #c0c4cc;
  font-size: 12px;
  margin: 0 2px;
}

.biz-recruited {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}

.biz-recruited-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.biz-recruited-name {
  flex: 1;
  color: #303133;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.biz-recruited-sales {
  font-size: 11px;
  color: #e6a23c;
  font-weight: 600;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 12px;
}

.radar-container {
  width: 100%;
  height: 280px;
}

/* 2026-08-12: 基本法新增样式 */
.level-cell {
  display: flex;
  align-items: center;
}
.rel-name {
  color: #303133;
  font-size: 13px;
}
.rel-empty {
  color: #c0c4cc;
  font-size: 13px;
}
.rel-auto {
  color: #909399;
  font-size: 12px;
  font-style: italic;
}
.rel-display {
  color: #303133;
  font-size: 14px;
  font-weight: 500;
}
.rel-tip {
  margin-left: 8px;
  color: #909399;
  font-size: 12px;
}
.num-cell {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  color: #606266;
  font-weight: 500;
}

/* 2026-08-16: drawer tabs + 费率速查样式 */
.drawer-header { display: flex; align-items: center; }
.drawer-title { font-weight: 600; font-size: 16px; }
.drawer-tabs { margin-bottom: 0; }
.drawer-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.rates-lookup { padding: 4px 8px 16px; }
.rates-hint {
  background: #f0f7ff; border-left: 3px solid #409eff;
  padding: 8px 12px; font-size: 12px; color: #606266;
  border-radius: 4px; margin-bottom: 12px;
}
.rates-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 14px;
}
.rates-cell {
  background: #fafafa; border: 1px solid #ebeef5;
  border-radius: 6px; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 6px;
}
.rates-cell.rates-cell-active {
  background: #fff7e6; border-color: #faad14;
}
.rates-cell-head { display: flex; align-items: center; gap: 6px; }
.rates-level { font-weight: 700; font-size: 14px; color: #303133; }
.rates-line { font-size: 12px; color: #606266; }
.big-num { font-weight: 700; font-size: 16px; color: #d46b08; font-family: 'SF Mono', Menlo, Consolas, monospace; }
.rates-deadline { font-size: 11px; color: #909399; }
.form-tip-inline { margin-left: 8px; color: #909399; font-size: 13px; }
.result-card { margin-top: 12px; }
</style>
