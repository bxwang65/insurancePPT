import { Injectable, Logger } from '@nestjs/common'
// ali-oss 在 types 里没有 default export, 用 require + 类型注解绕过 namespace import 警告
// eslint-disable-next-line @typescript-eslint/no-var-requires
const OSS = require('ali-oss')
type OssClient = InstanceType<typeof OSS>

/**
 * Aliyun OSS 服务 (培训视频/材料上传 + 签名 URL)
 *
 * 2026-08-31: 培训系统 14.6G 数据从 ECS 本地迁到 OSS 后, 新上传走 OSS,
 * 老 /uploads/ 本地链接保留 useStaticAssets fallback (前端直接判断路径用).
 *
 * 配置 (env):
 *   OSS_ACCESS_KEY_ID     — RAM 子账号 AK
 *   OSS_ACCESS_KEY_SECRET — RAM 子账号 SK
 *   OSS_REGION            — 默认 oss-cn-hongkong
 *   OSS_BUCKET            — 默认 insurance-training-2026
 *   OSS_KEY_PREFIX        — 默认 training/uploads/
 */
@Injectable()
export class OssService {
  private readonly logger = new Logger(OssService.name)
  private client: OssClient
  private readonly bucket: string
  private readonly keyPrefix: string
  // 2026-08-31: Phase 5 灰度切换 - 命中 stage 的课程走 OSS, 其他继续 ECS 本地
  // 配置: OSS_GRAY_STAGES=ONBOARDING,PRODUCT (逗号分隔, 空 = 全量本地)
  private readonly grayStages: Set<string>

  constructor() {
    const accessKeyId = process.env.OSS_ACCESS_KEY_ID
    const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET
    if (!accessKeyId || !accessKeySecret) {
      throw new Error('OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET not configured')
    }

    this.bucket = process.env.OSS_BUCKET ?? 'insurance-training-2026'
    this.keyPrefix = process.env.OSS_KEY_PREFIX ?? 'training/uploads/'

    const grayStagesEnv = process.env.OSS_GRAY_STAGES ?? ''
    this.grayStages = new Set(
      grayStagesEnv.split(',').map((s) => s.trim()).filter(Boolean),
    )

    this.client = new OSS({
      region: process.env.OSS_REGION ?? 'oss-cn-hongkong',
      accessKeyId,
      accessKeySecret,
      bucket: this.bucket,
      secure: true,
      // 大文件内部自动分片 (5MB / 片)
      parallel: 4,
      partSize: 5 * 1024 * 1024,
      // 2026-08-31: ECS 上行 5.5Mbps, 500MB 大文件上传需要 ~12 分钟
      // 默认 timeout 60s 必崩, 显式拉到 30 分钟 (单片上传 + signature URL 续签)
      timeout: 30 * 60 * 1000,
    })

    this.logger.log(`OSS client initialized: bucket=${this.bucket} region=${process.env.OSS_REGION ?? 'oss-cn-hongkong'} prefix=${this.keyPrefix} gray_stages=[${Array.from(this.grayStages).join(',') || 'none'}]`)
  }

  /**
   * 上传 buffer 到 OSS, 返回完整 key (含前缀)
   */
  async put(filename: string, buffer: Buffer, mimeType?: string): Promise<string> {
    const key = `${this.keyPrefix}${filename}`
    await this.client.put(key, buffer, {
      mime: mimeType,
      headers: {
        // 私有 bucket, 强制 inline (浏览器直接预览, 不触发下载)
        'Content-Disposition': 'inline',
        // 1 天 CDN edge 缓存 (签名前端拿 URL 后浏览器/H5 会重新 sign)
        'Cache-Control': 'private, max-age=3600',
      },
    })
    return key
  }

  /**
   * 生成签名 URL, 默认 1 小时有效
   * H5 视频 src / 浏览器下载链接都走这个
   */
  async signUrl(key: string, expires = 3600): Promise<string> {
    return this.client.signatureUrl(key, {
      expires,
      response: {
        'content-disposition': 'inline',
      },
    })
  }

  /**
   * 检查 key 是否存在
   */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.head(key)
      return true
    } catch {
      return false
    }
  }

  /**
   * 2026-08-31: Phase 5 灰度 - 判断某 stage 是否在 OSS 灰度名单
   */
  isGrayStage(stage: string | undefined | null): boolean {
    if (!stage) return false
    return this.grayStages.has(stage)
  }

  /**
   * 2026-08-31: Phase 5 灰度 - 把 /uploads/xxx 路径解析成 OSS 签名 URL
   * - 仅在 isGrayStage(stage)==true 时调用
   * - 映射规则: /uploads/videos/01.mp4 → training/videos/01.mp4 (Phase 2 ossutil 批量上传的目录)
   * - 文件不在 OSS (老时间戳等) 时返回 null, 调用方 fallback 回原 URL
   */
  async resolveForGray(rawUrl: string): Promise<string | null> {
    if (!rawUrl || !rawUrl.startsWith('/uploads/')) return null

    const key = `training${rawUrl.replace('/uploads', '')}`

    try {
      const exists = await this.exists(key)
      if (!exists) {
        this.logger.warn(`[OSS gray] key not found, fallback: ${key}`)
        return null
      }
      return await this.signUrl(key, 3600)
    } catch (e: any) {
      this.logger.error(`[OSS gray] resolve failed for ${key}: ${e.message}`)
      return null
    }
  }
}