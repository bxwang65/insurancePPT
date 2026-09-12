<template>
  <div class="course-container">
    <div class="toolbar">
      <el-button type="primary" @click="handleAdd">
        <el-icon><Plus /></el-icon>
        新增课程
      </el-button>
    </div>

    <el-table :data="courseList" border stripe style="width: 100%" v-loading="loading">
      <el-table-column label="封面" width="120">
        <template #default="{ row }">
          <el-image
            v-if="row.cover_image"
            :src="row.cover_image"
            fit="cover"
            style="width: 80px; height: 60px; border-radius: 4px;"
          />
          <div v-else class="no-cover">暂无封面</div>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="课程标题" min-width="200" />
      <el-table-column prop="stage_name" label="阶段" width="120">
        <template #default="{ row }">
          <el-tag :type="getStageType(row.stage)">
            {{ row.stage_name }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="duration_minutes" label="时长(分钟)" width="120" />
      <el-table-column label="课件数" width="100">
        <template #default="{ row }">
          {{ row.materials?.length || 0 }}
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180">
        <template #default="{ row }">
          {{ formatDate(row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          <el-button link type="success" size="small" @click="handleViewMaterials(row)">课件</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新增/编辑弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑课程' : '新增课程'"
      width="640px"
      @close="resetForm"
    >
      <el-form :model="form" :rules="rules" ref="formRef" label-width="100px">
        <el-form-item label="课程标题" prop="title">
          <el-input v-model="form.title" placeholder="请输入课程标题" />
        </el-form-item>

        <el-form-item label="所属阶段" prop="stage">
          <el-select v-model="form.stage" placeholder="请选择阶段" style="width: 100%">
            <el-option label="新人训" value="ONBOARDING" />
            <el-option label="产品训" value="PRODUCT" />
            <el-option label="衔接训" value="TRANSFER" />
            <el-option label="进阶训" value="ADVANCEMENT" />
          </el-select>
        </el-form-item>

        <el-form-item label="课程简介" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="请输入课程简介"
          />
        </el-form-item>

        <el-form-item label="总时长" prop="duration_minutes">
          <el-input-number v-model="form.duration_minutes" :min="1" :max="600" style="width: 100%">
            <template #append>分钟</template>
          </el-input-number>
        </el-form-item>

        <el-form-item label="课程封面">
          <el-upload
            class="cover-uploader"
            :show-file-list="false"
            :before-upload="beforeCoverUpload"
            :http-request="handleCoverUpload"
          >
            <img v-if="form.cover_image" :src="form.cover_image" class="cover-preview" />
            <el-icon v-else class="cover-uploader-icon"><Plus /></el-icon>
          </el-upload>
          <div class="form-tip">支持 JPG/PNG，建议尺寸 280x160</div>
        </el-form-item>

        <el-form-item label="课程视频">
          <el-upload
            class="video-uploader"
            :show-file-list="false"
            :before-upload="beforeVideoUpload"
            :http-request="handleVideoUpload"
            accept="video/*"
          >
            <el-button type="primary" :loading="uploading" :disabled="uploading">
              {{ uploading ? `上传中 ${uploadProgress}%` : '选择视频' }}
            </el-button>
          </el-upload>
          <el-progress v-if="uploading" :percentage="Math.round(uploadProgress)" style="margin-top: 12px;" />
          <div v-if="form.video_url" class="video-info">
            <el-icon><VideoPlay /></el-icon>
            <span>视频已上传</span>
          </div>
          <div class="form-tip">支持 MP4/AVI/MOV 格式</div>
        </el-form-item>

        <el-form-item label="课程课件">
          <el-upload
            class="materials-uploader"
            drag
            multiple
            :file-list="materialFileList"
            :before-upload="beforeMaterialUpload"
            :http-request="handleMaterialUpload"
            accept=".pdf,.ppt,.pptx"
          >
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">
              将 PDF/PPT 课件拖到此处，或<em>点击上传</em>
            </div>
          </el-upload>
          <div v-if="materialFileList.length" class="materials-list">
            <div v-for="(file, index) in materialFileList" :key="index" class="material-item">
              <el-icon><Document /></el-icon>
              <span class="material-name">{{ file.name }}</span>
              <span class="material-size">{{ formatFileSize(file.size) }}</span>
              <el-icon class="material-remove" @click="removeMaterial(index)"><Close /></el-icon>
            </div>
          </div>
          <div class="form-tip">支持 PDF、PPT、PPTX 格式</div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>

    <!-- 课件管理弹窗 -->
    <el-dialog v-model="materialsVisible" title="课件列表" width="500px">
      <el-empty v-if="!currentCourseMaterials.length" description="暂无课件" />
      <div v-else class="materials-list">
        <div v-for="mat in currentCourseMaterials" :key="mat.id" class="material-item">
          <el-icon><Document /></el-icon>
          <span class="material-name">{{ mat.title }}</span>
          <el-tag size="small">{{ mat.file_type }}</el-tag>
          <span class="material-size">{{ formatFileSize(mat.file_size) }}</span>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Plus, UploadFilled, Document, VideoPlay, Close } from '@element-plus/icons-vue'
import request from '@/utils/request'

interface Material {
  id: string
  title: string
  file_url: string
  file_type: string
  file_size?: number
  created_at: string
}

interface Course {
  id: string
  title: string
  cover_image: string
  stage: string
  stage_name: string
  duration_minutes: number
  description?: string
  video_url?: string
  progress_percentage: number
  materials?: Material[]
  created_at: string
}

const API_BASE = ''

const courseList = ref<Course[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const isEdit = ref(false)
const uploading = ref(false)
const uploadProgress = ref(0)
const formRef = ref<FormInstance>()
const materialsVisible = ref(false)
const currentCourseMaterials = ref<Material[]>([])

const materialFileList = ref<Array<{ name: string; size: number; url?: string }>>([])

const form = reactive({
  id: '',
  title: '',
  stage: '',
  description: '',
  cover_image: '',
  video_url: '',
  duration_minutes: 0,
  stage_name: ''
})

const rules: FormRules = {
  title: [{ required: true, message: '请输入课程标题', trigger: 'blur' }],
  stage: [{ required: true, message: '请选择阶段', trigger: 'change' }]
}

const stageNameMap: Record<string, string> = {
  ONBOARDING: '新人训',
  PRODUCT: '产品训',
  TRANSFER: '衔接训',
  ADVANCEMENT: '进阶训'
}

const getStageType = (stage: string) => {
  const map: Record<string, '' | 'success' | 'warning' | 'info' | 'primary'> = {
    ONBOARDING: 'success',
    PRODUCT: 'primary',
    TRANSFER: 'warning',
    ADVANCEMENT: 'info'
  }
  return map[stage] || ''
}

const formatFileSize = (bytes?: number) => {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString('zh-CN')
}

const fetchCourses = async () => {
  loading.value = true
  try {
    const res = await request.get(`${API_BASE}/courses`)
    courseList.value = res.data || []
  } catch (e: any) {
    ElMessage.error('获取课程列表失败: ' + (e.message || ''))
  } finally {
    loading.value = false
  }
}

const fetchCourseDetail = async (id: string) => {
  try {
    const res = await request.get(`${API_BASE}/courses/${id}`)
    return res.data
  } catch {
    return null
  }
}

const handleAdd = () => {
  isEdit.value = false
  dialogVisible.value = true
}

const handleEdit = async (row: Course) => {
  isEdit.value = true
  const detail = await fetchCourseDetail(row.id)
  if (detail) {
    Object.assign(form, {
      id: detail.id,
      title: detail.title,
      stage: detail.stage,
      description: detail.description || '',
      cover_image: detail.cover_image || '',
      video_url: detail.video_url || '',
      duration_minutes: detail.duration_minutes || 0,
      stage_name: detail.stage_name || ''
    })
    materialFileList.value = (detail.materials || []).map((m: Material) => ({
      name: m.title,
      size: m.file_size || 0,
      url: m.file_url
    }))
  }
  dialogVisible.value = true
}

const handleDelete = async (row: Course) => {
  await ElMessageBox.confirm('确定要删除该课程吗？相关课件也会被删除。', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  })
  try {
    await request.delete(`${API_BASE}/courses/${row.id}`)
    ElMessage.success('删除成功')
    fetchCourses()
  } catch (e: any) {
    ElMessage.error('删除失败: ' + (e.message || ''))
  }
}

const handleViewMaterials = async (row: Course) => {
  const detail = await fetchCourseDetail(row.id)
  currentCourseMaterials.value = detail?.materials || []
  materialsVisible.value = true
}

const beforeCoverUpload = (file: File) => {
  const isImage = file.type.startsWith('image/')
  const isLt5M = file.size / 1024 / 1024 < 5
  if (!isImage) { ElMessage.error('只能上传图片文件'); return false }
  if (!isLt5M) { ElMessage.error('图片大小不能超过 5MB'); return false }
  return true
}

const handleCoverUpload = async (options: { file: File }) => {
  const formData = new FormData()
  formData.append('file', options.file)
  try {
    const res = await request.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0, // 大文件上传不受全局 10s 超时限制
    })
    if (res.success && res.data?.oss_key) {
      form.cover_image = res.data.oss_key
      ElMessage.success('封面上传成功')
    }
  } catch {
    ElMessage.error('封面上传失败')
  }
}

const beforeVideoUpload = (file: File) => {
  const isVideo = file.type.startsWith('video/')
  if (!isVideo) { ElMessage.error('只能上传视频文件'); return false }
  return true
}

const handleVideoUpload = async (options: { file: File }) => {
  uploading.value = true
  uploadProgress.value = 0

  const formData = new FormData()
  formData.append('file', options.file)

  try {
    const res = await request.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0, // 大视频上传不受全局 10s 超时限制
      onUploadProgress: (e) => {
        if (e.total) {
          uploadProgress.value = Math.round((e.loaded / e.total) * 100)
        }
      },
    })
    if (res.success && res.data?.oss_key) {
      form.video_url = res.data.oss_key
      ElMessage.success('视频上传成功')
    }
  } catch {
    ElMessage.error('视频上传失败')
  } finally {
    uploading.value = false
    uploadProgress.value = 0
  }
}

const beforeMaterialUpload = (file: File) => {
  const allowedTypes = [
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
  const isValid = allowedTypes.includes(file.type) ||
    file.name.endsWith('.pdf') || file.name.endsWith('.ppt') || file.name.endsWith('.pptx')
  if (!isValid) { ElMessage.error('只能上传 PDF、PPT 格式文件'); return false }
  return true
}

const handleMaterialUpload = async (options: { file: File }) => {
  const formData = new FormData()
  formData.append('file', options.file)
  try {
    const res = await request.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0, // 大文件上传不受全局 10s 超时限制
    })
    if (res.success && res.data?.oss_key) {
      materialFileList.value.push({
        name: options.file.name,
        size: options.file.size,
        url: res.data.oss_key,
      })
      ElMessage.success(`${options.file.name} 上传成功`)
    }
  } catch {
    ElMessage.error(`${options.file.name} 上传失败`)
  }
}

const removeMaterial = (index: number) => {
  materialFileList.value.splice(index, 1)
}

const inferFileType = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'ppt' || ext === 'pptx') return 'ppt'
  return 'pdf'
}

const submitForm = async () => {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return

    const payload = {
      title: form.title,
      stage: form.stage,
      stage_name: stageNameMap[form.stage] || form.stage,
      description: form.description,
      cover_image: form.cover_image,
      video_url: form.video_url,
      duration_minutes: form.duration_minutes || 1,
      materials: materialFileList.value.map((f) => ({
        title: f.name,
        file_url: f.url || '',
        file_type: inferFileType(f.name),
        file_size: f.size
      }))
    }

    try {
      if (isEdit.value) {
        await request.patch(`${API_BASE}/courses/${form.id}`, payload)
        ElMessage.success('编辑成功')
      } else {
        await request.post(`${API_BASE}/courses`, payload)
        ElMessage.success('新增成功')
      }
      dialogVisible.value = false
      resetForm()
      fetchCourses()
    } catch (e: any) {
      ElMessage.error((isEdit.value ? '编辑' : '新增') + '失败: ' + (e.message || ''))
    }
  })
}

const resetForm = () => {
  Object.assign(form, {
    id: '', title: '', stage: '', description: '',
    cover_image: '', video_url: '', duration_minutes: 0, stage_name: ''
  })
  materialFileList.value = []
  formRef.value?.resetFields()
}

onMounted(() => {
  fetchCourses()
})
</script>

<style scoped>
.course-container {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
}

.toolbar {
  margin-bottom: 20px;
}

.no-cover {
  width: 80px;
  height: 60px;
  background: #f5f7fa;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 12px;
}

.cover-uploader {
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: border-color 0.2s;
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-uploader:hover { border-color: #409eff; }

.cover-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-uploader-icon {
  font-size: 28px;
  color: #8c939d;
}

.video-info {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #67c23a;
}

.materials-uploader {
  width: 100%;
}

.el-icon--upload {
  font-size: 67px;
  color: #409eff;
  margin-bottom: 16px;
}

.materials-list {
  margin-top: 16px;
}

.material-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  margin-bottom: 8px;
}

.material-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.material-size {
  color: #999;
  font-size: 12px;
}

.material-remove {
  cursor: pointer;
  color: #999;
}

.material-remove:hover { color: #f56c6c; }

.form-tip {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}
</style>
