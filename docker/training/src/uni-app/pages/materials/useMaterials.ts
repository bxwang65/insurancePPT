/**
 * ============================================================
 * 课件材料处理工具（Uni-app Vue3 + TS）
 * ============================================================
 * 职责：下载 → 预览（PDF/PPT）→ 保存/转发
 * 加载状态反馈完整，无单点隐患
 */

interface Material {
  id: string
  title: string
  file_url: string
  file_type: 'PDF' | 'PPT' | 'DOC'
  file_size?: number
  created_at: string
}

type FileType = 'pdf' | 'ppt' | 'doc'

// ============================================================
// 工具函数：文件大小格式化
// ============================================================

export function formatFileSize(bytes: number | undefined): string {
  if (bytes == null) return '未知大小'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ============================================================
// 工具函数：file_type 枚举 → Uni-app fileType
// ============================================================

function toUniFileType(fileType: string): FileType {
  const map: Record<string, FileType> = {
    PDF: 'pdf',
    PPT: 'ppt',
    PPTX: 'ppt',
    DOC: 'doc',
    DOCX: 'doc',
  }
  return map[fileType.toUpperCase()] ?? 'pdf'
}

// ============================================================
// 核心：课件预览/下载逻辑
// ============================================================

export function useMaterials() {
  // 正在加载的 Material ID（支持多文件并发，但单个文件不可重复触发）
  const loadingId = ref<string | null>(null)

  /**
   * 打开/下载课件
   * - 先 showLoading
   * - 再 downloadFile
   * - 最后 openDocument
   * - 各环节均有 fail 处理，hideLoading 保证清理
   */
  function openMaterial(material: Material) {
    // 防止重复点击
    if (loadingId.value != null) {
      uni.showToast({ title: '请等待当前文件完成', icon: 'none' })
      return
    }

    loadingId.value = material.id
    uni.showLoading({ title: '课件加载中...', mask: true })

    uni.downloadFile({
      url: material.file_url,
      success: (downloadResult) => {
        if (downloadResult.statusCode !== 200) {
          handleError('文件下载失败，请检查网络')
          return
        }

        const tempFilePath = downloadResult.tempFilePath

        uni.openDocument({
          filePath: tempFilePath,
          fileType: toUniFileType(material.file_type),
          showMenu: true, // 关键：允许保存、转发、打印
          success: () => {
            // 预览成功，保持 loading 清除
            uni.hideLoading()
          },
          fail: (openErr) => {
            // 文件已下载但预览失败（可能是手机没装对应软件）
            handleError(`无法预览：该文件格式需要安装 ${material.file_type} 软件`)
            console.error('[openDocument] fail', openErr)
          },
        })
      },
      fail: (downloadErr) => {
        handleError('下载失败，请检查网络连接')
        console.error('[downloadFile] fail', downloadErr)
      },
      complete: () => {
        // 确保无论成功失败都清除 loading 状态
        loadingId.value = null
      },
    })
  }

  /**
   * 统一错误处理：隐藏 loading + toast 提示
   */
  function handleError(message: string) {
    uni.hideLoading()
    uni.showToast({ title: message, icon: 'none', duration: 3000 })
  }

  /**
   * 分享课件（微信分享/保存到本地）
   */
  function shareMaterial(material: Material) {
    uni.showLoading({ title: '准备分享...', mask: true })

    uni.downloadFile({
      url: material.file_url,
      success: (result) => {
        if (result.statusCode === 200) {
          uni.hideLoading()
          // 微信小程序 / App 可直接分享文件
          uni.share({
            type: 'file',
            filePath: result.tempFilePath,
            title: material.title,
            success: () => {},
            fail: () => {
              // 降级：提示用户手动保存
              uni.showToast({ title: '请长按文件选择分享', icon: 'none' })
            },
          })
        }
      },
      fail: () => {
        uni.hideLoading()
        uni.showToast({ title: '分享失败', icon: 'none' })
      },
    })
  }

  return {
    loadingId,
    openMaterial,
    shareMaterial,
    formatFileSize,
  }
}

// ============================================================
// 类型（供外部 import 使用）
// ============================================================
export type { Material }
