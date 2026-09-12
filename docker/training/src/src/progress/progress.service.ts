import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { SyncProgressDto, SyncProgressResponseDto } from './dto/progress.dto'

/**
 * 进度同步防作弊阈值配置
 */
const SYNC_INTERVAL_SECONDS = 10 // 预期打点间隔（秒）
const MAX_ALLOWED_JUMP_SECONDS = SYNC_INTERVAL_SECONDS * 1.5 // 允许最大跳转

@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ============================================================
   * 核心：打点同步 POST /api/progress/sync
   *
   * 内核逻辑：
   * 1. 查找或创建该用户的进度记录（upsert）
   * 2. 防作弊校验：差值 > 1.5 倍打点间隔 → 记录异常但不更新（或返回警告）
   * 3. 更新 last_watched_at 为当前服务器时间
   * 4. 重新计算并更新 progress_percentage
   * ============================================================
   */
  async sync(
    userId: string,
    dto: SyncProgressDto,
  ): Promise<SyncProgressResponseDto> {
    const { courseId, currentPosition } = dto

    // --------------------------------------------------------
    // Step 1: 获取课程总时长
    // --------------------------------------------------------
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { duration_minutes: true },
    })

    if (!course) {
      throw new Error(`课程 ${courseId} 不存在`)
    }

    const courseDurationSeconds = course.duration_minutes * 60

    // --------------------------------------------------------
    // Step 2: Upsert - 查找或创建进度记录
    // --------------------------------------------------------
    const existingProgress = await this.prisma.userCourseProgress.findUnique({
      where: {
        user_id_course_id: { user_id: userId, course_id: courseId },
      },
    })

    // --------------------------------------------------------
    // Step 3: 防作弊校验
    //    - 如果已有记录，比较 currentPosition 与 last_position 的差值
    //    - 差值 > MAX_ALLOWED_JUMP_SECONDS → 判定为异常跳过
    // --------------------------------------------------------
    let blocked = false
    let warning: string | undefined

    if (existingProgress) {
      const jump = Math.abs(currentPosition - existingProgress.last_position)

      if (jump > MAX_ALLOWED_JUMP_SECONDS) {
        blocked = true
        warning = `检测到异常跳跃：跳过了 ${jump} 秒（最大允许 ${MAX_ALLOWED_JUMP_SECONDS} 秒），本次打点已被忽略`
        console.warn(`[Anti-Cheat] User ${userId} on course ${courseId}: ${warning}`)

        // 不更新进度，只更新时间
        await this.prisma.userCourseProgress.update({
          where: { id: existingProgress.id },
          data: { last_watched_at: new Date() },
        })

        return {
          success: true,
          progress_percentage: existingProgress.progress_percentage,
          warning,
          blocked: true,
        }
      }
    }

    // --------------------------------------------------------
    // Step 4: 正常更新进度
    // --------------------------------------------------------
    const watchedSeconds = currentPosition
    const progress_percentage = courseDurationSeconds > 0
      ? Math.min(100, Math.round((watchedSeconds / courseDurationSeconds) * 100))
      : 0

    const updated = await this.prisma.userCourseProgress.upsert({
      where: {
        user_id_course_id: { user_id: userId, course_id: courseId },
      },
      create: {
        user_id: userId,
        course_id: courseId,
        progress_percentage,
        last_position: currentPosition,
        last_watched_at: new Date(),
        total_watch_seconds: watchedSeconds,
      },
      update: {
        progress_percentage,
        last_position: currentPosition,
        last_watched_at: new Date(),
        // 累加观看秒数（取增量，而非覆盖）
        total_watch_seconds: {
          increment: Math.max(0, currentPosition - (existingProgress?.last_position ?? 0)),
        },
      },
    })

    // --------------------------------------------------------
    // Step 5: 同步更新 User.total_learning_minutes
    // --------------------------------------------------------
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { total_learning_minutes: true },
    })

    if (user) {
      const allProgress = await this.prisma.userCourseProgress.findMany({
        where: { user_id: userId },
        select: { total_watch_seconds: true },
      })

      const totalSeconds = allProgress.reduce((sum, p) => sum + p.total_watch_seconds, 0)
      const totalMinutes = Math.floor(totalSeconds / 60)

      await this.prisma.user.update({
        where: { id: userId },
        data: { total_learning_minutes: totalMinutes },
      })
    }

    return {
      success: true,
      progress_percentage: updated.progress_percentage,
    }
  }

  /**
   * 批量同步（支持前端定期批量上报）
   */
  async batchSync(userId: string, items: SyncProgressDto[]): Promise<SyncProgressResponseDto[]> {
    const results: SyncProgressResponseDto[] = []

    for (const item of items) {
      try {
        const result = await this.sync(userId, item)
        results.push(result)
      } catch (error) {
        results.push({
          success: false,
          progress_percentage: 0,
          warning: (error as Error).message,
          blocked: true,
        })
      }
    }

    return results
  }

  /**
   * 获取用户学习进度列表（最近在看）
   */
  async getRecentProgress(
    userId: string,
    limit: number = 10,
  ) {
    return this.prisma.userCourseProgress.findMany({
      where: { user_id: userId },
      orderBy: { last_watched_at: 'desc' },
      take: limit,
      include: {
        course: {
          select: {
            id: true,
            title: true,
            cover_image: true,
            stage: true,
            stage_name: true,
            duration_minutes: true,
          },
        },
      },
    })
  }
}
