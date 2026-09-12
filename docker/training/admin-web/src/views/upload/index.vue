<template>
  <div class="upload-container">
    <el-tabs v-model="activeTab" class="upload-tabs">
      <!-- Tab 1: 上传新内容 (一步到位创建课程) -->
      <el-tab-pane label="上传新内容" name="new">
        <el-card class="form-card" shadow="never">
          <el-form
            :model="newForm"
            :rules="newRules"
            ref="newFormRef"
            label-width="100px"
            label-position="right"
          >
            <el-form-item label="课程标题" prop="title">
              <el-input v-model="newForm.title" placeholder="如: 第三讲《香港分红险详解》" />
            </el-form-item>

            <el-form-item label="所属阶段" prop="stage">
              <el-select v-model="newForm.stage" placeholder="请选择阶段" style="width: 100%">
                <el-option label="新人训" value="ONBOARDING" />
                <el-option label="产品训" value="PRODUCT" />
                <el-option label="衔接训" value="TRANSFER" />
                <el-option label="进阶训" value="ADVANCEMENT" />
              </el-select>
            </el-form-item>

            <el-form-item label="课程简介">
              <el-input
                v-model="newForm.description"
                type="textarea"
                :rows="2"
                placeholder="简要介绍本课内容 (选填)"
              />
            </el-form-item>

            <el-form-item label="课程时长">
              <el-input-number v-model="newForm.duration_minutes" :min="1" :max="600" style="width: 200px">
                <template #append>分钟</template>
              </el-input-number>
            </el-form-item>

            <el-form-item label="课程封面">
              <el-upload
                class="cover-uploader"
                :show-file-list="false"
                :before-upload="beforeCoverUpload"
                :http-request="handleCoverUpload"
                accept="image/*"
              >
                <img v-if="newForm.cover_image" :src="newForm.cover_image" class="cover-preview" />
                <div v-else class="cover-placeholder">
                  <el-icon><Plus /></el-icon>
                  <span>点击上传封面</span>
                  <span class="tip">JPG/PNG, 280x160, ≤5MB</span>
                </div>
              </el-upload>
            </el-form-item>

            <el-form-item label="课程视频">
              <el-upload
                :show-file-list="false"
                :before-upload="beforeVideoUpload"
                :http-request="handleVideoUpload"
                accept="video/*"
              >
                <el-button type="primary" :loading="videoUploading" :disabled="videoUploading">
                  {{ videoUploading ? `上传中 ${videoProgress}%` : (newForm.video_url ? '重新上传视频' : '选择视频文件') }}
                </el-button>
              </el-upload>
              <el-progress v-if="videoUploading" :percentage="Math.round(videoProgress)" style="margin-top: 8px;" />
              <div v-if="newForm.video_url" class="uploaded-hint">
                <el-icon style="color:#67c23a"><VideoPlay /></el-icon>
                <span>视频已上传: {{ newForm.video_url }}</span>
              </div>
              <div class="form-tip">支持 MP4/AVI/MOV, 无大小限制 (建议 ≤2GB)</div>
            </el-form-item>

            <el-form-item label="PDF课件">
              <el-upload
                multiple
                :file-list="pdfFileList"
                :before-upload="beforePdfUpload"
                :http-request="handlePdfUpload"
                :on-remove="handlePdfRemove"
                accept=".pdf"
              >
                <el-button :loading="loading">选择PDF课件</el-button>
              </el-upload>
              <div class="form-tip">支持 PDF, 可多选</div>
            </el-form-item>

            <el-form-item label="PPT课件">
              <el-upload
                multiple
                :file-list="pptFileList"
                :before-upload="beforePptUpload"
                :http-request="handlePptUpload"
                :on-remove="handlePptRemove"
                accept=".ppt,.pptx"
              >
                <el-button :loading="loading">选择PPT课件</el-button>
              </el-upload>
              <div class="form-tip">支持 PPT/PPTX, 可多选</div>
            </el-form-item>

            <el-form-item>
              <el-button type="primary" size="large" :loading="submitting" @click="submitNew">
                创建课程并保存
              </el-button>
              <el-button size="large" @click="resetNew">重置</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- Tab 2: 补传到现有课程 -->
      <el-tab-pane label="补传到现有课程" name="add">
        <el-card class="form-card" shadow="never">
          <el-form label-width="100px">
            <el-form-item label="选择课程">
              <el-select
                v-model="addForm.courseId"
                placeholder="请选择课程"
                filterable
                style="width: 100%"
                @change="onCourseChange"
              >
                <el-option
                  v-for="c in courseList"
                  :key="c.id"
                  :label="`${c.title} [${c.stage_name}]`"
                  :value="c.id"
                />
              </el-select>
            </el-form-item>

            <el-form-item v-if="addForm.courseId" label="上传视频">
              <el-upload
                :show-file-list="false"
                :before-upload="beforeAddVideoUpload"
                :http-request="handleAddVideoUpload"
                accept="video/*"
              >
                <el-button :loading="addVideoUploading" :disabled="addVideoUploading">
                  {{ addVideoUploading ? `上传中 ${addVideoProgress}%` : '上传/替换视频' }}
                </el-button>
              </el-upload>
              <el-progress v-if="addVideoUploading" :percentage="Math.round(addVideoProgress)" style="margin-top: 8px;" />
              <div v-if="addForm.video_url" class="uploaded-hint">
                <el-icon style="color:#67c23a"><VideoPlay /></el-icon>
                <span>当前视频: {{ addForm.video_url }}</span>
              </div>
            </el-form-item>

            <el-form-item v-if="addForm.courseId" label="追加PDF">
              <el-upload
                multiple
                :file-list="addPdfList"
                :before-upload="beforeAddPdfUpload"
                :http-request="handleAddPdfUpload"
                :on-remove="handleAddPdfRemove"
                accept=".pdf"
              >
                <el-button :loading="addLoading">追加PDF课件</el-button>
              </el-upload>
            </el-form-item>

            <el-form-item v-if="addForm.courseId" label="追加PPT">
              <el-upload
                multiple
                :file-list="addPptList"
                :before-upload="beforeAddPptUpload"
                :http-request="handleAddPptUpload"
                :on-remove="handleAddPptRemove"
                accept=".ppt,.pptx"
              >
                <el-button :loading="addLoading">追加PPT课件</el-button>
              </el-upload>
            </el-form-item>

            <el-form-item v-if="addForm.courseId">
              <el-button type="primary" size="large" @click="reloadCourseMaterials">
                刷新当前课程
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- Tab 3: 上传历史 -->
      <el-tab-pane label="上传历史" name="history">
        <el-card class="form-card" shadow="never">
          <el-table :data="courseList" border stripe v-loading="loading">
            <el-table-column prop="title" label="课程标题" min-width="220" />
            <el-table-column label="阶段" width="100">
              <template #default="{ row }">
                <el-tag size="small">{{ row.stage_name }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="duration_minutes" label="时长(分钟)" width="110" />
            <el-table-column label="视频">
              <template #default="{ row }">
                <el-icon v-if="row.video_url" style="color:#67c23a"><VideoPlay /></el-icon>
                <span v-else style="color:#999">无</span>
              </template>
            </el-table-column>
            <el-table-column label="课件数" width="90">
              <template #default="{ row }">
                {{ row.materials?.length || 0 }}
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="创建时间" width="180">
              <template #default="{ row }">
                {{ new Date(row.created_at).toLocaleString('zh-CN') }}
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { Plus, VideoPlay } from '@element-plus/icons-vue'
import request from '@/utils/request'

interface Material {
  id: string
  title: string
  file_url: string
  file_type: string
  file_size?: number
}
interface Course {
  id: string
  title: string
  stage: string
  stage_name: string
  duration_minutes: number
  description?: string
  cover_image?: string
  video_url?: string
  materials?: Material[]
  created_at: string
}

const API_BASE = ''  // request util baseURL='/api/training' (见 .env.production)

const activeTab = ref('new')
const loading = ref(false)
const submitting = ref(false)

// === 新建课程表单 ===
const newFormRef = ref<FormInstance>()
const newForm = reactive({
  title: '',
  stage: '',
  description: '',
  duration_minutes: 30,
  cover_image: '',
  video_url: '',
})

const newRules: FormRules = {
  title: [{ required: true, message: '请输入课程标题', trigger: 'blur' }],
  stage: [{ required: true, message: '请选择阶段', trigger: 'change' }],
}

const videoUploading = ref(false)
const videoProgress = ref(0)
const pdfFileList = ref<any[]>([])
const pptFileList = ref<any[]>([])

const stageNameMap: Record<string, string> = {
  ONBOARDING: '新人训',
  PRODUCT: '产品训',
  TRANSFER: '衔接训',
  ADVANCEMENT: '进阶训',
}

// === 补传表单 ===
const courseList = ref<Course[]>([])
const addForm = reactive({
  courseId: '',
  video_url: '',
  duration: 0,
  materials: [] as Material[],
})
const addVideoUploading = ref(false)
const addVideoProgress = ref(0)
const addPdfList = ref<any[]>([])
const addPptList = ref<any[]>([])
const addLoading = ref(false)

// === 加载课程列表 ===
const fetchCourses = async () => {
  loading.value = true
  try {
    const res = await request.get(`${API_BASE}/courses`)
    courseList.value = (res as any).data || []
  } catch (e: any) {
    ElMessage.error('获取课程列表失败: ' + (e.message || ''))
  } finally {
    loading.value = false
  }
}

// === 课程切换 ===
const onCourseChange = async (id: string) => {
  if (!id) return
  try {
    const res = await request.get(`${API_BASE}/courses/${id}`)
    const c = (res as any).data
    addForm.video_url = c?.video_url || ''
    addForm.duration = c?.duration_minutes || 0
    addForm.materials = c?.materials || []
  } catch {
    ElMessage.error('加载课程详情失败')
  }
}

const reloadCourseMaterials = async () => {
  if (!addForm.courseId) return
  await onCourseChange(addForm.courseId)
  ElMessage.success('已刷新')
}

// === 通用上传函数 ===
async function uploadFile(
  file: File,
  onProgress?: (e: any) => void,
): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await request.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
    onUploadProgress: onProgress,
  }) as any
  if (res?.success && res.data?.oss_key) return res.data.oss_key
  throw new Error(res?.message || '上传失败')
}

// === Tab 1: 新建课程的上传函数 ===
const beforeCoverUpload = (file: File) => {
  if (!file.type.startsWith('image/')) { ElMessage.error('只能上传图片'); return false }
  if (file.size / 1024 / 1024 >= 5) { ElMessage.error('图片 ≤5MB'); return false }
  return true
}
const handleCoverUpload = async ({ file }: { file: File }) => {
  try {
    const u = await uploadFile(file)
    newForm.cover_image = u
    ElMessage.success('封面上传成功')
  } catch {
    ElMessage.error('封面上传失败')
  }
}
const beforeVideoUpload = (file: File) => {
  if (!file.type.startsWith('video/')) { ElMessage.error('只能上传视频'); return false }
  return true
}
const handleVideoUpload = async ({ file }: { file: File }) => {
  videoUploading.value = true
  videoProgress.value = 0
  try {
    const u = await uploadFile(file, (e) => {
      if (e.total) videoProgress.value = Math.round((e.loaded / e.total) * 100)
    })
    newForm.video_url = u
    ElMessage.success('视频上传成功')
  } catch {
    ElMessage.error('视频上传失败')
  } finally {
    videoUploading.value = false
    videoProgress.value = 0
  }
}
const beforePdfUpload = (file: File) => {
  if (!file.name.endsWith('.pdf')) { ElMessage.error('只能上传 PDF'); return false }
  return true
}
const handlePdfUpload = async ({ file, onSuccess, onError }: any) => {
  try {
    const u = await uploadFile(file)
    pdfFileList.value.push({ name: file.name, size: file.size, url: u, uid: file.uid })
    onSuccess?.(u)
    ElMessage.success(`${file.name} 上传成功`)
  } catch (e: any) {
    onError?.(e)
    ElMessage.error(`${file.name} 上传失败`)
  }
}
const handlePdfRemove = (file: any) => {
  const idx = pdfFileList.value.findIndex(f => f.uid === file.uid)
  if (idx >= 0) pdfFileList.value.splice(idx, 1)
}
const beforePptUpload = (file: File) => {
  if (!file.name.endsWith('.ppt') && !file.name.endsWith('.pptx')) {
    ElMessage.error('只能上传 PPT/PPTX'); return false
  }
  return true
}
const handlePptUpload = async ({ file, onSuccess, onError }: any) => {
  try {
    const u = await uploadFile(file)
    pptFileList.value.push({ name: file.name, size: file.size, url: u, uid: file.uid })
    onSuccess?.(u)
    ElMessage.success(`${file.name} 上传成功`)
  } catch (e: any) {
    onError?.(e)
    ElMessage.error(`${file.name} 上传失败`)
  }
}
const handlePptRemove = (file: any) => {
  const idx = pptFileList.value.findIndex(f => f.uid === file.uid)
  if (idx >= 0) pptFileList.value.splice(idx, 1)
}

// inferFileType removed (unused)

const submitNew = async () => {
  if (!newFormRef.value) return
  await newFormRef.value.validate(async (valid) => {
    if (!valid) return
    submitting.value = true
    try {
      const materials = [
        ...pdfFileList.value.map(f => ({
          title: f.name,
          file_url: f.url,
          file_type: 'pdf',
          file_size: f.size,
        })),
        ...pptFileList.value.map(f => ({
          title: f.name,
          file_url: f.url,
          file_type: 'ppt',
          file_size: f.size,
        })),
      ]
      const payload = {
        title: newForm.title,
        stage: newForm.stage,
        stage_name: stageNameMap[newForm.stage] || newForm.stage,
        description: newForm.description,
        cover_image: newForm.cover_image,
        video_url: newForm.video_url,
        duration_minutes: newForm.duration_minutes || 1,
        materials,
      }
      await request.post(`${API_BASE}/courses`, payload)
      ElMessage.success('课程创建成功')
      resetNew()
      await fetchCourses()
    } catch (e: any) {
      ElMessage.error('创建失败: ' + (e.message || ''))
    } finally {
      submitting.value = false
    }
  })
}

const resetNew = () => {
  Object.assign(newForm, {
    title: '', stage: '', description: '', duration_minutes: 30,
    cover_image: '', video_url: '',
  })
  pdfFileList.value = []
  pptFileList.value = []
  newFormRef.value?.resetFields()
}

// === Tab 2: 补传函数 ===
const beforeAddVideoUpload = (file: File) => {
  if (!file.type.startsWith('video/')) { ElMessage.error('只能上传视频'); return false }
  return true
}
const handleAddVideoUpload = async ({ file }: { file: File }) => {
  if (!addForm.courseId) { ElMessage.error('请先选择课程'); return }
  addVideoUploading.value = true
  addVideoProgress.value = 0
  try {
    const u = await uploadFile(file, (e) => {
      if (e.total) addVideoProgress.value = Math.round((e.loaded / e.total) * 100)
    })
    // patch course: 更新 video_url
    await request.patch(`${API_BASE}/courses/${addForm.courseId}`, {
      video_url: u,
    })
    addForm.video_url = u
    ElMessage.success('视频已更新')
  } catch {
    ElMessage.error('视频更新失败')
  } finally {
    addVideoUploading.value = false
    addVideoProgress.value = 0
  }
}

const beforeAddPdfUpload = (file: File) => {
  if (!file.name.endsWith('.pdf')) { ElMessage.error('只能上传 PDF'); return false }
  return true
}
const handleAddPdfUpload = async ({ file, onSuccess, onError }: any) => {
  if (!addForm.courseId) { ElMessage.error('请先选择课程'); onError(); return }
  addLoading.value = true
  try {
    const u = await uploadFile(file)
    addPdfList.value.push({ name: file.name, size: file.size, url: u, uid: file.uid })
    onSuccess?.(u)
    // patch 到 course.materials
    const newMaterial = {
      id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: file.name,
      file_url: u,
      file_type: 'pdf',
      file_size: file.size,
    }
    addForm.materials = [...addForm.materials, newMaterial]
    await request.patch(`${API_BASE}/courses/${addForm.courseId}`, {
      materials: addForm.materials,
    })
    ElMessage.success(`${file.name} 已追加`)
  } catch (e: any) {
    onError?.(e)
    ElMessage.error(`${file.name} 追加失败`)
  } finally {
    addLoading.value = false
  }
}
const handleAddPdfRemove = (file: any) => {
  const idx = addPdfList.value.findIndex(f => f.uid === file.uid)
  if (idx >= 0) addPdfList.value.splice(idx, 1)
}

const beforeAddPptUpload = (file: File) => {
  if (!file.name.endsWith('.ppt') && !file.name.endsWith('.pptx')) {
    ElMessage.error('只能上传 PPT/PPTX'); return false
  }
  return true
}
const handleAddPptUpload = async ({ file, onSuccess, onError }: any) => {
  if (!addForm.courseId) { ElMessage.error('请先选择课程'); onError(); return }
  addLoading.value = true
  try {
    const u = await uploadFile(file)
    addPptList.value.push({ name: file.name, size: file.size, url: u, uid: file.uid })
    onSuccess?.(u)
    const newMaterial = {
      id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: file.name,
      file_url: u,
      file_type: 'ppt',
      file_size: file.size,
    }
    addForm.materials = [...addForm.materials, newMaterial]
    await request.patch(`${API_BASE}/courses/${addForm.courseId}`, {
      materials: addForm.materials,
    })
    ElMessage.success(`${file.name} 已追加`)
  } catch (e: any) {
    onError?.(e)
    ElMessage.error(`${file.name} 追加失败`)
  } finally {
    addLoading.value = false
  }
}
const handleAddPptRemove = (file: any) => {
  const idx = addPptList.value.findIndex(f => f.uid === file.uid)
  if (idx >= 0) addPptList.value.splice(idx, 1)
}

onMounted(() => {
  fetchCourses()
})
</script>

<style scoped>
.upload-container {
  max-width: 1100px;
  margin: 0 auto;
}

.upload-tabs {
  background: transparent;
}

.form-card {
  border-radius: 8px;
}

.cover-uploader {
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  width: 200px;
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: border-color 0.2s;
}
.cover-uploader:hover { border-color: #409eff; }

.cover-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: #999;
  font-size: 13px;
}
.cover-placeholder .tip {
  font-size: 11px;
  color: #ccc;
}

.uploaded-hint {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #67c23a;
  font-size: 13px;
  word-break: break-all;
}

.form-tip {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}
</style>