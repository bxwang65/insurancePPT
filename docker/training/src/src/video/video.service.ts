import { Injectable } from '@nestjs/common'

/**
 * VideoService - 视频 URL 处理服务
 *
 * 目前返回 Mock 的腾讯云 VOD URL 占位符。
 * 后续接入正式视频防盗链签名逻辑时，只需修改此服务。
 */
@Injectable()
export class VideoService {
  // ============================================================
  // 腾讯云 VOD 配置占位（后续从环境变量/ConfigService 读取）
  // ============================================================
  private readonly VOD_APP_ID = process.env.VOD_APP_ID ?? '125xxxxxxx'
  private readonly VOD_SECRET_ID = process.env.VOD_SECRET_ID ?? 'your-secret-id'
  private readonly VOD_SECRET_KEY = process.env.VOD_SECRET_KEY ?? 'your-secret-key'
  private readonly VOD_EXPIRES_SECONDS = 3600 // 签名过期时间

  // ============================================================
  // Mock 视频数据（正式环境应从数据库读取）
  // ============================================================
  readonly mockVideos: Record<string, { url: string; duration: number }> = {
    'course_01': {
      url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
      duration: 2700, // 45 分钟
    },
    'course_02': {
      url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
      duration: 3600, // 60 分钟
    },
    'course_03': {
      url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
      duration: 3600, // 60 分钟
    },
    'course_04': {
      url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
      duration: 5400, // 90 分钟
    },
    'course_05': {
      url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
      duration: 5400, // 90 分钟
    },
    'course_06': {
      url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
      duration: 5400, // 90 分钟
    },
    'course_07': {
      url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
      duration: 10800, // 180 分钟
    },
    'course_08': {
      url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
      duration: 5400, // 90 分钟
    },
    'course_09': {
      url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
      duration: 7200, // 120 分钟
    },
    'course_10': {
      url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
      duration: 5400, // 90 分钟
    },
  }

  /**
   * 获取带签名的视频播放 URL
   *
   * 预留方法 - 后续接入腾讯云 VOD 防盗链签名时实现：
   * 1. 根据 fileId 查询媒资信息
   * 2. 生成带时效的签名 URL（防盗链）
   * 3. 返回签名 URL 替代原始 URL
   *
   * @param courseId 课程 ID（目前用作 videoId 占位）
   * @param expires 签名过期时间（秒），默认 3600
   */
  async getSignedUrl(courseId: string, expires: number = this.VOD_EXPIRES_SECONDS): Promise<string> {
    const video = this.mockVideos[courseId]

    if (!video) {
      // 无匹配视频时返回占位 URL
      return 'https://media.w3.org/2010/05/sintel/trailer.mp4'
    }

    // ============================================================
    // TODO: 后续接入腾讯云 VOD 签名逻辑
    // ============================================================
    // const { VodAPI } = await import('@tencentcloud/vod-node-sdk')
    // const auth = new VodAPI({ secretId: this.VOD_SECRET_ID, secretKey: this.VOD_SECRET_KEY })
    // const sign = await auth.getDownloadSign({ fileId: courseId, expires })
    // return `${video.url}?sign=${sign}`

    // 目前直接返回 mock URL（无防盗链）
    return video.url
  }

  /**
   * 获取视频时长
   */
  getVideoDuration(courseId: string): number {
    return this.mockVideos[courseId]?.duration ?? 0
  }
}
