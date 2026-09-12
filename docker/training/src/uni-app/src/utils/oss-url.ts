/**
 * OSS URL 解析工具
 * 2026-08-31: 培训资料迁移到 OSS 后, video_url / file_url 在 DB 里有 3 种形态:
 *   1. '/uploads/xxx'          → 本地静态文件 (useStaticAssets fallback, 老数据)
 *   2. 'http(s)://...'         → 已是完整签名 URL (老数据, 1 小时内有效)
 *   3. 'training/uploads/xxx'  → OSS key (新数据, 需调 /api/upload/sign 拿新 URL)
 */

import { get, getBaseUrl } from './request'

/**
 * 同步把 rawUrl 解析成浏览器/H5 可直接访问的 URL
 * - 老数据 (/uploads/xxx, http://) 直接返回
 * - OSS key 异步调 sign, 拿到签名 URL
 */
export async function resolveMediaUrl(rawUrl: string): Promise<string> {
  if (!rawUrl) return ''

  // 1. 老数据: 本地相对路径 → 拼接 base URL
  if (rawUrl.startsWith('/uploads/')) {
    return getBaseUrl().replace('/api', '') + rawUrl
  }

  // 2. 老数据: 已经是完整 URL (含签名参数) → 直接用
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    return rawUrl
  }

  // 3. 新数据: OSS key → 调 sign 端点拿 1 小时签名 URL
  if (rawUrl.startsWith('training/')) {
    try {
      const res = await get<{ success: boolean; data: { url: string; expires_in: number } }>(
        '/upload/sign',
        { key: rawUrl, expires: 3600 },
      )
      if (res?.success && res?.data?.url) return res.data.url
    } catch (e) {
      console.error('[OSS sign] 失败:', rawUrl, e)
    }
    return ''
  }

  // 兜底: 当本地路径处理 (避免空白)
  return rawUrl
}