<template>
  <view class="materials-tab">

    <!-- 加载状态 -->
    <view v-if="loading" class="loading-state">
      <uni-load-more status="loading" />
    </view>

    <!-- 空状态 -->
    <view v-else-if="materials.length === 0" class="empty-state">
      <uni-icons type="folder-open" size="48" color="#ccc" />
      <text class="empty-state__text">暂无课件</text>
    </view>

    <!-- 课件列表 -->
    <view v-else class="materials-list">
      <view
        v-for="material in materials"
        :key="material.id"
        class="material-item"
        :class="{ 'material-item--loading': loadingId === material.id }"
        @tap="onTapMaterial(material)"
      >
        <!-- 左：文件类型图标 -->
        <view class="material-item__icon">
          <uni-icons
            :type="getFileIcon(material.file_type)"
            size="28"
            :color="getFileIconColor(material.file_type)"
          />
        </view>

        <!-- 中：名称 + 大小 -->
        <view class="material-item__info">
          <text class="material-item__title" number-of-lines="1">{{ material.title }}</text>
          <text class="material-item__meta">
            {{ material.file_type }} ·
            {{ formatFileSize(material.file_size) }}
          </text>
        </view>

        <!-- 右：下载/预览图标 -->
        <view class="material-item__action">
          <uni-icons
            :type="loadingId === material.id ? 'spinner-cycle' : 'cloud-download'"
            :size="22"
            :color="loadingId === material.id ? '#999' : '#667eea'"
          />
        </view>
      </view>
    </view>

    <!-- 操作菜单（点击后弹出） -->
    <uni-popup ref="actionPopup" type="bottom">
      <view class="action-sheet" v-if="selectedMaterial">
        <view class="action-sheet__header">{{ selectedMaterial.title }}</view>
        <view class="action-sheet__item" @tap="onConfirmOpen(selectedMaterial)">
          <uni-icons type="paperclip" size="20" color="#667eea" />
          <text>预览文件</text>
        </view>
        <view class="action-sheet__item" @tap="onConfirmShare(selectedMaterial)">
          <uni-icons type="redo" size="20" color="#667eea" />
          <text>分享给好友</text>
        </view>
        <view class="action-sheet__item action-sheet__item--cancel" @tap="actionPopup.close()">
          <text>取消</text>
        </view>
      </view>
    </uni-popup>

  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useMaterials, formatFileSize } from './useMaterials'
import type { Material } from './useMaterials'

// ============================================================
// Props
// ============================================================
interface Props {
  materials: Material[]
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  materials: () => [],
  loading: false,
})

// ============================================================
// 课件处理逻辑
// ============================================================
const { openMaterial, shareMaterial, loadingId } = useMaterials()

const actionPopup = ref<any>(null)
const selectedMaterial = ref<Material | null>(null)

/**
 * 点击课件 → 弹出操作菜单
 */
function onTapMaterial(material: Material) {
  selectedMaterial.value = material
  actionPopup.value?.open()
}

/**
 * 确认预览
 */
function onConfirmOpen(material: Material) {
  actionPopup.value?.close()
  openMaterial(material)
}

/**
 * 确认分享
 */
function onConfirmShare(material: Material) {
  actionPopup.value?.close()
  shareMaterial(material)
}

// ============================================================
// 文件类型图标映射
// ============================================================

function getFileIcon(fileType: string): string {
  const map: Record<string, string> = {
    PDF: 'file',
    PPT: 'file-filled',
    PPTX: 'file-filled',
    DOC: 'document',
    DOCX: 'document',
  }
  return map[fileType.toUpperCase()] ?? 'file'
}

function getFileIconColor(fileType: string): string {
  const map: Record<string, string> = {
    PDF: '#e74c3c',
    PPT: '#f39c12',
    PPTX: '#f39c12',
    DOC: '#3498db',
    DOCX: '#3498db',
  }
  return map[fileType.toUpperCase()] ?? '#999'
}
</script>

<style scoped>
/* 列表 */
.materials-list {
  padding: 0 32rpx;
}

.material-item {
  display: flex;
  align-items: center;
  padding: 28rpx 24rpx;
  background: #fff;
  border-radius: 16rpx;
  margin-bottom: 16rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.06);
  transition: opacity 0.2s;
}

.material-item--loading {
  opacity: 0.7;
}

.material-item__icon {
  width: 64rpx;
  height: 64rpx;
  border-radius: 12rpx;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.material-item__info {
  flex: 1;
  margin: 0 16rpx;
  overflow: hidden;
}

.material-item__title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 6rpx;
}

.material-item__meta {
  font-size: 22rpx;
  color: #999;
}

.material-item__action {
  flex-shrink: 0;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 120rpx 0;
}
.empty-state__text {
  font-size: 28rpx;
  color: #999;
  margin-top: 16rpx;
}

/* 加载状态 */
.loading-state {
  display: flex;
  justify-content: center;
  padding: 80rpx 0;
}

/* 操作菜单 */
.action-sheet {
  background: #fff;
  border-radius: 24rpx 24rpx 0 0;
  overflow: hidden;
}

.action-sheet__header {
  padding: 32rpx;
  text-align: center;
  font-size: 28rpx;
  color: #666;
  border-bottom: 1rpx solid #f0f0f0;
}

.action-sheet__item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 36rpx 48rpx;
  font-size: 30rpx;
  color: #1a1a1a;
  border-bottom: 1rpx solid #f9f9f9;
}

.action-sheet__item--cancel {
  color: #999;
  justify-content: center;
  margin-top: 8rpx;
  border-bottom: none;
}
</style>
