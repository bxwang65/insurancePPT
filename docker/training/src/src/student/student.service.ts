import { Injectable, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ProgressService } from '../progress/progress.service'
import { SyncProgressDto } from './dto/sync-progress.dto'
import * as bcrypt from 'bcrypt'

/**
 * 学员端接口服务
 * 提供小程序端所需的聚合数据接口
 */
@Injectable()
export class StudentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly progressService: ProgressService,
  ) {}

  /**
   * GET /api/user/progress
   * 返回所有课程及用户当前学习进度
   */
  async getProgress(userId: string) {
    const courses = await this.prisma.course.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        progress: {
          where: { user_id: userId },
          select: { progress_percentage: true },
        },
      },
    })

    const STAGE_ORDER = ['ONBOARDING', 'PRODUCT', 'TRANSFER', 'ADVANCEMENT']
    // 2026-08-13: 产品训插在新人训和衔接训之间; 解锁规则按用户定义 —
    //   ONBOARDING: 始终解锁
    //   PRODUCT:    新人训 ≥ 50% (视频观看 50% 即可看产品训)
    //   TRANSFER:   新人训 ≥ 80% (衔接训仍按原 80% 规则, 不链 PRODUCT)
    //   ADVANCEMENT: 衔接训 ≥ 80%
    const STAGE_UNLOCK: Record<string, { prev: string | null; threshold: number }> = {
      ONBOARDING:  { prev: null,        threshold: 0  },
      PRODUCT:     { prev: 'ONBOARDING', threshold: 50 },
      TRANSFER:    { prev: 'ONBOARDING', threshold: 80 },
      ADVANCEMENT: { prev: 'TRANSFER',    threshold: 80 },
    }
    const stageCompletionMap: Record<string, number> = {}
    let currentStage = 'ONBOARDING'

    // 计算每个阶段的完成百分比 (基于该阶段课程完成度, 空阶段算 0%)
    for (const stage of STAGE_ORDER) {
      const stageCourses = courses.filter((c) => c.stage === stage)
      if (stageCourses.length === 0) {
        stageCompletionMap[stage] = 0
        continue
      }
      const completed = stageCourses.filter(
        (c) => c.progress.find((p) => p.progress_percentage >= 100),
      ).length
      stageCompletionMap[stage] = Math.round((completed / stageCourses.length) * 100)
    }

    // 找出当前解锁阶段 (按 STAGE_ORDER 顺序, 第一个未达标的前置阶段之后的阶段即为 currentStage)
    for (const stage of STAGE_ORDER) {
      const rule = STAGE_UNLOCK[stage]
      if (!rule.prev) {
        currentStage = stage
        continue
      }
      if ((stageCompletionMap[rule.prev] ?? 0) >= rule.threshold) {
        currentStage = stage
      } else {
        break
      }
    }

    const mapped = courses.map((c) => ({
      id: c.id,
      name: c.title,
      title: c.title,
      stage: c.stage,
      stage_name: c.stage_name,
      duration_minutes: c.duration_minutes,
      url: c.video_url || '',
      cover_image: c.cover_image,
      progress: c.progress[0]?.progress_percentage ?? 0,
    }))

    return {
      courses: mapped,
      stage: currentStage,
      stageCompletionMap,
      totalCourses: courses.length,
      completedCourses: courses.filter(
        (c) => c.progress[0]?.progress_percentage >= 100,
      ).length,
    }
  }

  /**
   * POST /api/user/sync-progress
   * 进度同步：
   * - currentPosition 为合法数字时直接作为打点秒数（跳过百分比折算，
   *   避免长课程百分比取整导致的 15s 防跳阈值误杀）
   * - 否则按 percentage → 秒数折算（兼容小程序心跳）
   * - percentage 与 currentPosition 都缺时抛 400
   */
  async syncProgress(userId: string, dto: SyncProgressDto) {
    const { courseId, percentage, currentPosition } = dto

    // 优先：直接使用前端上报的秒数打点
    if (typeof currentPosition === 'number' && Number.isFinite(currentPosition)) {
      return this.progressService.sync(userId, {
        courseId,
        currentPosition,
      })
    }

    // 兼容路径：百分比 → 秒数
    if (typeof percentage !== 'number' || !Number.isFinite(percentage)) {
      throw new BadRequestException('percentage 与 currentPosition 至少传一个')
    }

    // 获取课程总时长
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { duration_minutes: true },
    })

    if (!course) {
      throw new NotFoundException(`课程 ${courseId} 不存在`)
    }

    // 百分比 → 秒数
    const courseDurationSeconds = course.duration_minutes * 60
    const positionInSeconds = Math.round((percentage / 100) * courseDurationSeconds)

    // 委托给 ProgressService 做 upsert + 防作弊
    return this.progressService.sync(userId, {
      courseId,
      currentPosition: positionInSeconds,
    })
  }

  /**
   * GET /api/user/bill
   * 学习账单：总学时 + 完成课程数 + 学习足迹时间轴
   */
  async getBill(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    })
    if (!user) throw new NotFoundException(`用户 ${userId} 不存在`)

    // 获取所有进度记录
    const allProgress = await this.prisma.userCourseProgress.findMany({
      where: { user_id: userId },
      include: {
        course: { select: { title: true } },
      },
      orderBy: { last_watched_at: 'desc' },
    })

    const completedCount = allProgress.filter((p) => p.progress_percentage >= 100).length
    const totalHours = Math.round((user.total_learning_minutes / 60) * 10) / 10

    // 构建学习足迹时间轴
    const history = allProgress
      .filter((p) => p.last_watched_at)
      .slice(0, 50)
      .map((p) => {
        const date = p.last_watched_at!
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
        return {
          date: `${dateStr} ${timeStr}`,
          action: p.progress_percentage >= 100 ? '完成了课程' : '学习了课程',
          courseName: p.course.title,
        }
      })

    return {
      totalHours,
      completedCount,
      history,
    }
  }

  /**
   * GET /api/user/medals
   * 荣誉勋章列表
   */
  async getMedals(userId: string) {
    const userHonors = await this.prisma.userHonor.findMany({
      where: { user_id: userId },
      include: { honor: true },
    })

    const unlockedIds = new Set(userHonors.map((h) => h.honor_id))

    // 获取所有勋章定义
    const allHonors = await this.prisma.honor.findMany()

    return allHonors.map((honor) => ({
      icon: honor.icon_url || '🏅',
      name: honor.name,
      desc: honor.description || '',
      unlocked: unlockedIds.has(honor.id),
      unlockTime: userHonors.find((h) => h.honor_id === honor.id)?.earned_at?.toISOString() || null,
    }))
  }

  /**
   * GET /api/materials
   * 获取所有课程材料列表（扁平结构，用于小程序课程详情页）
   */
  async getMaterials(userId: string) {
    const courses = await this.prisma.course.findMany({
      include: {
        materials: true,
        progress: {
          where: { user_id: userId },
          select: { progress_percentage: true },
        },
      },
    })

    // 返回课程和课件混合的扁平列表
    const result: any[] = []

    for (const course of courses) {
      // 主视频条目
      result.push({
        id: course.id,
        title: course.title,
        url: course.video_url || '',
        type: 'video',
        progress: course.progress[0]?.progress_percentage ?? 0,
        pdf: course.materials.find((m) => m.file_type === 'PDF')?.file_url || '',
        duration_minutes: course.duration_minutes,
        stage: course.stage,
      })

      // 课件条目
      for (const mat of course.materials) {
        result.push({
          id: mat.id,
          title: mat.title,
          url: mat.file_url,
          type: mat.file_type.toLowerCase(),
          courseId: course.id,
          file_size: mat.file_size,
          pdf: '',
        })
      }
    }

    return result
  }

  /**
   * POST /api/user/update-password
   * 学员修改密码
   */
  async updatePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('用户不存在')

    // 2026-08-12: 4in1 IdP 用户没有本地密码 (走 Firebase 管理), 直接拒绝
    if (!user.password) {
      throw new BadRequestException('当前账号使用 4in1 登录, 请在 4in1 修改密码')
    }

    const isValid = await bcrypt.compare(oldPassword, user.password)
    if (!isValid) {
      throw new UnauthorizedException('原密码错误')
    }

    const hashed = await bcrypt.hash(newPassword, 10)
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    })

    return { success: true, message: '密码修改成功' }
  }
}
