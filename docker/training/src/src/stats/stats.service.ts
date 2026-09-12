import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  StudentStatsResponseDto,
  DashboardSummaryDto,
  StudentListResponseDto,
  StudentDetailDto,
  StudentQueryDto,
} from './dto/stats.dto'

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 排除访客设备账号（phone 以 'dev:' 开头）的统计过滤条件
   */
  private readonly excludeVisitorFilter = {
    phone: { not: { startsWith: 'dev:' } },
  }

  /**
   * 2026-08-14: 业务看板用户过滤 (排除 dev: 访客, 同时保留 NULL phone 的真实用户)
   *   区别于 excludeVisitorFilter: NULL phone 也算有效用户 (Firebase idP sync 进来的账号)
   */
  private readonly businessUserFilter = {
    status: 'ACTIVE',
    OR: [
      { phone: null },
      { phone: { not: { startsWith: 'dev:' } } },
    ],
  } as any

  /**
   * ============================================================
   * GET /api/admin/stats/student/:id
   *
   * 返回该学员的所有学习数据：
   * - 总时长（分钟换算小时）
   * - 已学完课程数
   * - 各阶段（新人训/产品训/衔接训/进阶训）分布
   * - 等级信息
   * ============================================================
   */
  async getStudentStats(userId: string): Promise<StudentStatsResponseDto> {
    // 1. 获取用户基本信息
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      throw new NotFoundException(`学员 ${userId} 不存在`)
    }

    // 2. 获取所有课程进度
    const allProgress = await this.prisma.userCourseProgress.findMany({
      where: { user_id: userId },
      include: {
        course: {
          select: {
            stage: true,
            stage_name: true,
            duration_minutes: true,
          },
        },
      },
    })

    // 3. 计算统计数据
    const completedCourses = allProgress.filter((p) => p.progress_percentage >= 100)
    const inProgressCourses = allProgress.filter((p) => p.progress_percentage > 0 && p.progress_percentage < 100)

    // 4. 按阶段分组统计
    const stageGroups = {
      ONBOARDING: allProgress.filter((p) => p.course.stage === 'ONBOARDING'),
      PRODUCT: allProgress.filter((p) => p.course.stage === 'PRODUCT'),
      TRANSFER: allProgress.filter((p) => p.course.stage === 'TRANSFER'),
      ADVANCEMENT: allProgress.filter((p) => p.course.stage === 'ADVANCEMENT'),
    }

    const stage_distribution = {
      onboarding: this.calcStageStats(stageGroups.ONBOARDING),
      product: this.calcStageStats(stageGroups.PRODUCT),
      transfer: this.calcStageStats(stageGroups.TRANSFER),
      advancement: this.calcStageStats(stageGroups.ADVANCEMENT),
    }

    // 5. 获取已获荣誉
    const honors = await this.prisma.userHonor.findMany({
      where: { user_id: userId },
      include: { honor: true },
      orderBy: { earned_at: 'desc' },
      take: 5,
    })

    // 6. 计算总课程数和完成率
    const totalCourses = await this.prisma.course.count()
    const overall_completion_rate = totalCourses > 0
      ? Math.round((completedCourses.length / totalCourses) * 100)
      : 0

    return {
      userId: user.id,
      name: user.name,
      total_learning_minutes: user.total_learning_minutes,
      total_learning_hours: Math.round((user.total_learning_minutes / 60) * 10) / 10,
      level: user.level,
      level_name: user.level_name,
      completed_courses: completedCourses.length,
      in_progress_courses: inProgressCourses.length,
      overall_completion_rate,
      stage_distribution,
      recent_honors: honors.map((h) => ({
        id: h.honor.id,
        name: h.honor.name,
        icon_url: h.honor.icon_url,
        earned_at: h.earned_at.toISOString(),
      })),
    }
  }

  private calcStageStats(progressList: { progress_percentage: number }[]) {
    const total = progressList.length
    const completed = progressList.filter((p) => p.progress_percentage >= 100).length
    const in_progress = progressList.filter((p) => p.progress_percentage > 0 && p.progress_percentage < 100).length
    const avg_progress = total > 0
      ? Math.round(progressList.reduce((sum, p) => sum + p.progress_percentage, 0) / total)
      : 0

    return { total, completed, in_progress, avg_progress }
  }

  // ============================================================
  // GET /api/admin/stats/dashboard/summary
  // 看板汇总数据
  // ============================================================
  async getDashboardSummary(): Promise<DashboardSummaryDto> {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    // 总学员数（排除 dev: 访客）
    const totalStudents = await this.prisma.user.count({ where: this.excludeVisitorFilter })

    // 本月活跃学员（有进度的）
    const activeStudentsThisMonth = new Set(
      (
        await this.prisma.userCourseProgress.findMany({
          where: { last_watched_at: { gte: monthStart } },
          select: { user_id: true },
        })
      ).map((p) => p.user_id)
    ).size

    // 所有学员累计学时（排除 dev: 访客）
    const allUsers = await this.prisma.user.findMany({
      where: this.excludeVisitorFilter,
      select: { total_learning_minutes: true },
    })
    const totalMinutes = allUsers.reduce((sum, u) => sum + u.total_learning_minutes, 0)
    const avgLearningHours = totalStudents > 0 ? Math.round(totalMinutes / totalStudents / 60 * 10) / 10 : 0

    // 课程完成率（分子同样排除访客进度，与分母口径一致）
    const totalCourses = await this.prisma.course.count()
    const completedAll = await this.prisma.userCourseProgress.count({
      where: {
        progress_percentage: { gte: 100 },
        user: this.excludeVisitorFilter,
      },
    })
    const courseCompletionRate = totalCourses > 0 && totalStudents > 0
      ? Math.round((completedAll / (totalCourses * totalStudents)) * 100)
      : 0

    // 阶段分布（根据当前用户 level 模拟）
    const stageDistribution = [
      { name: '新人训', count: Math.round(totalStudents * 0.4) },
      { name: '衔接训', count: Math.round(totalStudents * 0.35) },
      { name: '进阶训', count: Math.round(totalStudents * 0.25) },
    ]

    // Top 5 课程：数据库层按进度记录数 groupBy 排序，取真正的热度 Top5
    const topProgressGroups = await this.prisma.userCourseProgress.groupBy({
      by: ['course_id'],
      _count: { course_id: true },
      orderBy: { _count: { course_id: 'desc' } },
      take: 5,
    })
    const topCourseEntities = await this.prisma.course.findMany({
      where: { id: { in: topProgressGroups.map((g) => g.course_id) } },
      include: { _count: { select: { feedback: true } } },
    })
    const topCourseMap = new Map(topCourseEntities.map((c) => [c.id, c]))
    const topCourses = topProgressGroups
      .filter((g) => topCourseMap.has(g.course_id))
      .map((g) => ({
        id: g.course_id,
        title: topCourseMap.get(g.course_id)!.title,
        view_count: g._count.course_id,
        like_count: topCourseMap.get(g.course_id)!._count.feedback,
      }))

    // 最新动态（取最近的进度记录，关联用户和课程）
    const recentProgress = await this.prisma.userCourseProgress.findMany({
      where: { last_watched_at: { not: null } },
      orderBy: { last_watched_at: 'desc' },
      take: 8,
      include: {
        user: { select: { id: true, name: true, avatar_url: true } },
        course: { select: { title: true } },
      },
    })
    const recentActivities = recentProgress.map((p) => ({
      user_id: p.user.id,
      user_name: p.user.name,
      avatar_url: p.user.avatar_url ?? undefined,
      action: p.progress_percentage >= 100 ? '完成了' : '学习了',
      course_title: p.course.title,
      created_at: p.last_watched_at!.toISOString(),
    }))

    return {
      total_students: totalStudents,
      active_students_this_month: activeStudentsThisMonth,
      avg_learning_hours: avgLearningHours,
      course_completion_rate: courseCompletionRate,
      stage_distribution: stageDistribution,
      top_courses: topCourses,
      recent_activities: recentActivities,
    }
  }

  // ============================================================
  // GET /api/admin/stats/students
  // 学员列表（支持分页+搜索+阶段筛选）
  // ============================================================
  async getStudents(query: StudentQueryDto): Promise<StudentListResponseDto> {
    const { name = '', stage, page = 1, limit = 10 } = query
    const skip = (page - 1) * limit

    // 构建用户查询条件（排除 dev: 访客）
    const where: any = { phone: { not: { startsWith: 'dev:' } } }
    if (name) {
      where.name = { contains: name }
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          course_progress: {
            include: {
              course: { select: { stage: true, stage_name: true, title: true } },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ])

    const students = users.map((u) => {
      const completed = u.course_progress.filter((p) => p.progress_percentage >= 100).length
      const inProgress = u.course_progress.filter((p) => p.progress_percentage > 0 && p.progress_percentage < 100).length

      // 取当前最高阶段（根据已有进度）
      const hasProgress = u.course_progress.length > 0
      let currentStage = 'ONBOARDING'
      let currentStageName = '新人训'
      if (hasProgress) {
        const stages: Record<string, number> = { ONBOARDING: 1, TRANSFER: 2, ADVANCEMENT: 3 }
        const maxStage = u.course_progress.reduce((max, p) => {
          return stages[p.course.stage] > stages[max] ? p.course.stage : max
        }, 'ONBOARDING' as string)
        currentStage = maxStage as string
        currentStageName = u.course_progress.find((p) => p.course.stage === maxStage)?.course.stage_name ?? '新人训'
      }

      const lastWatched = u.course_progress
        .filter((p) => p.last_watched_at)
        .sort((a, b) => b.last_watched_at!.getTime() - a.last_watched_at!.getTime())[0]

      return {
        id: u.id,
        name: u.name,
        avatar_url: u.avatar_url ?? undefined,
        level: u.level,
        level_name: u.level_name,
        total_learning_minutes: u.total_learning_minutes,
        last_watched_at: lastWatched?.last_watched_at?.toISOString(),
        completed_courses: completed,
        in_progress_courses: inProgress,
        current_stage: currentStage,
        current_stage_name: currentStageName,
      }
    })

    return { students, total, page, limit }
  }

  // ============================================================
  // GET /api/admin/stats/students/:id/detail
  // 学员档案详情
  // ============================================================
  async getStudentDetail(userId: string): Promise<StudentDetailDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        course_progress: {
          include: {
            course: {
              select: { id: true, title: true, stage: true, stage_name: true, duration_minutes: true },
            },
          },
          orderBy: { last_watched_at: 'desc' },
        },
        // 2026-08-14: 档案内允许编辑招募人/主管, 这里要把 id + name 一并返回
        recruiter: { select: { id: true, name: true } },
        manager: { select: { id: true, name: true } },
      },
    })

    if (!user) throw new NotFoundException(`学员 ${userId} 不存在`)

    const completed = user.course_progress.filter((p) => p.progress_percentage >= 100).length
    const inProgress = user.course_progress.filter((p) => p.progress_percentage > 0 && p.progress_percentage < 100).length

    // 雷达图数据：按课程标题关键词模拟三维能力
    const courseDetail: StudentDetailDto['course_detail'] = user.course_progress.map((p) => ({
      course_id: p.course.id,
      course_title: p.course.title,
      progress_percentage: p.progress_percentage,
      completed: p.progress_percentage >= 100,
    }))

    // 模拟雷达图：法税维度、产品维度、话术维度
    const completedTitles = user.course_progress
      .filter((p) => p.progress_percentage >= 100)
      .map((p) => p.course.title)

    const lawScore = completedTitles.filter((t) => t.includes('法') || t.includes('税') || t.includes('信托')).length * 20
    const productScore = completedTitles.filter((t) => t.includes('产品') || t.includes('重疾') || t.includes('储蓄')).length * 20
    const salesScore = completedTitles.filter((t) => t.includes('话术') || t.includes('破冰') || t.includes('成交')).length * 20

    const radarStats = [
      { dimension: '法税筹划', score: Math.min(lawScore, 100) },
      { dimension: '产品解析', score: Math.min(productScore, 100) },
      { dimension: '销售话术', score: Math.min(salesScore, 100) },
    ]

    // 当前阶段
    let currentStage = 'ONBOARDING'
    let currentStageName = '新人训'
    if (user.course_progress.length > 0) {
      const stages: Record<string, number> = { ONBOARDING: 1, TRANSFER: 2, ADVANCEMENT: 3 }
      const maxStage = user.course_progress.reduce((max, p) =>
        stages[p.course.stage] > stages[max] ? p.course.stage : max
      , 'ONBOARDING' as string)
      currentStage = maxStage as string
      currentStageName = user.course_progress.find((p) => p.course.stage === maxStage)?.course.stage_name ?? '新人训'
    }

    const lastWatched = user.course_progress
      .filter((p) => p.last_watched_at)
      .sort((a, b) => b.last_watched_at!.getTime() - a.last_watched_at!.getTime())[0]

    return {
      id: user.id,
      name: user.name,
      avatar_url: user.avatar_url ?? undefined,
      role: user.role ?? null,
      title: user.title ?? undefined,
      level: user.level,
      level_name: user.level_name,
      total_learning_minutes: user.total_learning_minutes,
      completed_courses: completed,
      in_progress_courses: inProgress,
      current_stage: currentStage,
      current_stage_name: currentStageName,
      last_watched_at: lastWatched?.last_watched_at?.toISOString(),
      is_active: user.is_active,
      course_detail: courseDetail,
      radar_stats: radarStats,
      // 2026-08-14: 招管分离字段, 让 drawer 编辑表单能拿到当前值
      recruiter_id: user.recruiter_id ?? null,
      recruiter_name: user.recruiter?.name ?? null,
      manager_id: user.manager_id ?? null,
      manager_name: user.manager?.name ?? null,
    }
  }

  // ============================================================
  // 2026-08-14: GET /api/admin/stats/business?range=month|quarter|year
  // 业务看板汇总 (admin 全公司视角)
  //   - 4 个核心指标: 团队总标保 / 业绩达标率 / 招管总人数 / 平均 M 等级
  //   - L 等级分布 + 临门一脚预警
  //   - M 等级分布 + 升级机会
  //   - 业绩 Top 10 排行榜
  // ============================================================
  async getBusinessDashboard(range: 'month' | 'quarter' | 'year' = 'month') {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    let from = new Date(year, month, 1)
    if (range === 'quarter') from = new Date(year, Math.floor(month / 3) * 3, 1)
    else if (range === 'year') from = new Date(year, 0, 1)

    // 6m 窗口 (L/M 评估窗口, 与 range 无关)
    const sixMonthsAgo = new Date(now)
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    const userWhere = this.businessUserFilter

    // 1) 时间范围内的总标保 (HK/SG std_premium + ART sale_price)
    const txSum = await this.prisma.transaction.groupBy({
      by: ['product_type'],
      where: {
        sold_at: { gte: from, lte: now },
        product_type: { in: ['HK', 'SG', 'ART_MODERN', 'ART_CONTEMP'] },
      },
      _sum: { std_premium: true, sale_price: true },
    })
    let totalSales = 0
    for (const r of txSum) {
      totalSales += Number(r._sum.std_premium ?? 0) + Number(r._sum.sale_price ?? 0)
    }

    // 2) 全部 active users + 关键字段
    const allUsers = await this.prisma.user.findMany({
      where: userWhere,
      select: {
        id: true,
        name: true,
        avatar_url: true,
        email: true,
        performance_score: true,
        current_level: true,
        current_management_level: true,
        sales_amount: true,
        recruiter_id: true,
      },
    })
    const totalActiveUsers = allUsers.length
    // 2026-08-14: avgScore 改由 computePerformanceScores 自动算, 公式化
    const mgmtSum = allUsers.reduce((s, u) => s + u.current_management_level, 0)
    const avgManagementLevel = totalActiveUsers > 0
      ? Math.round((mgmtSum / totalActiveUsers) * 10) / 10
      : 0

    // 3) 招管总人数 = recruiter/manager 链路关联的 distinct users
    //    (用 active users 中所有非根节点, 即有 recruiter_id 或 manager_id 的人)
    const totalRecruitedUsers = allUsers.filter((u) => {
      // 不是 admin user 即可纳入"被招管体系"
      return true  // active users 全部纳入, 招管树根节点也展示, 与业务范围对齐
    }).length

    // 4) L 等级分布
    const levelDistribution = { L1: 0, L2: 0, L3: 0 }
    for (const u of allUsers) {
      const k = `L${u.current_level}` as 'L1' | 'L2' | 'L3'
      if (k in levelDistribution) levelDistribution[k]++
    }

    // 5) M 等级分布 (M0 表示还没晋升 M 体系)
    const managementDistribution = { M0: 0, M1: 0, M2: 0, M3: 0 }
    for (const u of allUsers) {
      const k = `M${u.current_management_level}` as 'M0' | 'M1' | 'M2' | 'M3'
      if (k in managementDistribution) managementDistribution[k]++
    }

    // 6) 业绩达标率: L≥2 的人数 / 总人数 (基本法: L2 起为达标业务层)
    const reachedCount = allUsers.filter((u) => u.current_level >= 2).length
    const achievementRate = totalActiveUsers > 0
      ? Math.round((reachedCount / totalActiveUsers) * 100)
      : 0

    // 7) 读 Config 阈值 (HK/SG L 升级阈值, M 升级阈值)
    const [lPromoteHKRow, lPromoteSGRow, mPromoteRow] = await Promise.all([
      this.prisma.config.findUnique({ where: { key: 'L_PROMOTE_HK' } }).catch(() => null),
      this.prisma.config.findUnique({ where: { key: 'L_PROMOTE_SG' } }).catch(() => null),
      this.prisma.config.findUnique({ where: { key: 'M_PROMOTE' } }).catch(() => null),
    ])
    const lCfgHK: any = JSON.parse(lPromoteHKRow?.value ?? '{"L2":50000,"L3":100000}')
    const lCfgSG: any = JSON.parse(lPromoteSGRow?.value ?? '{"L2":50000,"L3":100000}')
    const mCfg: any = JSON.parse(mPromoteRow?.value ?? '{"M2":{"directRecruits":2,"total6m":200000},"M3":{"directRecruits":4,"total6m":400000}}')

    // 8) 每个 user 的 6m HK+SG std_premium (用于临门一脚)
    const user6mTx = await this.prisma.transaction.groupBy({
      by: ['user_id', 'product_type'],
      where: {
        user_id: { in: allUsers.map((u) => u.id) },
        sold_at: { gte: sixMonthsAgo, lte: now },
        product_type: { in: ['HK', 'SG'] },
      },
      _sum: { std_premium: true },
    })
    const user6mMap = new Map<string, { HK: number; SG: number }>()
    for (const r of user6mTx) {
      const m = user6mMap.get(r.user_id) ?? { HK: 0, SG: 0 }
      if (r.product_type === 'HK') m.HK = Number(r._sum.std_premium ?? 0)
      if (r.product_type === 'SG') m.SG = Number(r._sum.std_premium ?? 0)
      user6mMap.set(r.user_id, m)
    }

    // 9) L 临门一脚: current_level=1/2, 6m max(HK,SG) >= 80% next threshold
    const nearPromotion: any[] = []
    for (const u of allUsers) {
      if (u.current_level >= 3) continue
      const sum = user6mMap.get(u.id) ?? { HK: 0, SG: 0 }
      const max6m = Math.max(sum.HK, sum.SG)
      let nextThreshold = 0
      let nextLevelName = ''
      if (u.current_level === 1) {
        nextThreshold = Math.max(Number(lCfgHK.L2 ?? 50000), Number(lCfgSG.L2 ?? 50000))
        nextLevelName = 'L2'
      } else {
        nextThreshold = Math.max(Number(lCfgHK.L3 ?? 100000), Number(lCfgSG.L3 ?? 100000))
        nextLevelName = 'L3'
      }
      const progress = nextThreshold > 0 ? Math.round((max6m / nextThreshold) * 100) : 0
      if (progress >= 80 && progress < 100) {
        nearPromotion.push({
          id: u.id,
          name: u.name,
          avatar_url: u.avatar_url,
          current_level: u.current_level,
          current_6m: max6m,
          threshold: nextThreshold,
          next_level: nextLevelName,
          progress_pct: progress,
        })
      }
    }
    nearPromotion.sort((a, b) => b.progress_pct - a.progress_pct)

    // 10) M 升级机会: current_management_level<3, 直接招募人 + 6m 树标保
    //     预扫描所有 recruiter_id 关系构建 map, 避免 N+1
    const recruiterMap = new Map<string, string[]>()
    for (const u of allUsers) {
      // u.recruiter_id 是 u 的招募人 (即谁招了 u)
      // 我们要的是 u 招了谁 → 反向查
    }
    // 反向: u.recruiter_id 是 user.id 的人 = u 招的人
    for (const u of allUsers) {
      // 这里我们直接一次性查所有 recruiter_id, 然后分组
    }
    const allRecruitLinks = await this.prisma.user.findMany({
      where: { ...userWhere, recruiter_id: { not: null } },
      select: { id: true, recruiter_id: true },
    })
    const directMap = new Map<string, string[]>()
    for (const link of allRecruitLinks) {
      const arr = directMap.get(link.recruiter_id!) ?? []
      arr.push(link.id)
      directMap.set(link.recruiter_id!, arr)
    }

    const mOpportunities: any[] = []
    for (const u of allUsers) {
      if (u.current_management_level >= 3) continue
      const directs = directMap.get(u.id) ?? []
      const directCount = directs.length
      // 2 级: directs 招的人
      const grands: string[] = []
      for (const d of directs) {
        const dGrands = directMap.get(d) ?? []
        grands.push(...dGrands)
      }
      const treeIds = [...directs, ...grands]
      let tree6m = 0
      if (treeIds.length) {
        const txs = await this.prisma.transaction.groupBy({
          by: ['product_type'],
          where: {
            user_id: { in: treeIds },
            sold_at: { gte: sixMonthsAgo, lte: now },
            product_type: { in: ['HK', 'SG'] },
          },
          _sum: { std_premium: true },
        })
        for (const r of txs) tree6m += Number(r._sum.std_premium ?? 0)
      }
      let nextThreshold: { directRecruits: number; total6m: number } = { directRecruits: 0, total6m: 0 }
      let nextName = ''
      if (u.current_management_level === 0) {
        nextThreshold = { directRecruits: 2, total6m: 0 }
        nextName = 'M1'
      } else if (u.current_management_level === 1) {
        nextThreshold = mCfg.M2
        nextName = 'M2'
      } else {
        nextThreshold = mCfg.M3
        nextName = 'M3'
      }
      const directsPct = nextThreshold.directRecruits > 0
        ? Math.min(100, Math.round((directCount / nextThreshold.directRecruits) * 100))
        : 100
      const treePct = nextThreshold.total6m > 0
        ? Math.min(100, Math.round((tree6m / nextThreshold.total6m) * 100))
        : 100
      // M1 升级只看 directs, 后续看 directs+tree
      const overallPct = nextName === 'M1'
        ? directsPct
        : Math.round((directsPct + treePct) / 2)
      if (overallPct >= 80 && overallPct < 100) {
        mOpportunities.push({
          id: u.id,
          name: u.name,
          avatar_url: u.avatar_url,
          current_management_level: u.current_management_level,
          next_level: nextName,
          direct_recruits: directCount,
          direct_threshold: nextThreshold.directRecruits,
          tree_6m_total: tree6m,
          tree_threshold: nextThreshold.total6m,
          progress_pct: overallPct,
        })
      }
    }
    mOpportunities.sort((a, b) => b.progress_pct - a.progress_pct)

    // 11) Top 10 业绩 (按 sales_amount desc)
    const topPerformers = [...allUsers]
      .sort((a, b) => Number(b.sales_amount) - Number(a.sales_amount))
      .slice(0, 10)
      .map((u) => ({
        id: u.id,
        name: u.name,
        avatar_url: u.avatar_url,
        current_level: u.current_level,
        sales_amount: Number(u.sales_amount),
        performance_score: u.performance_score,
      }))

    // 12) 2026-08-14: 自动算 performance_score (formula: 业绩×W_sales + 树×W_tree + 学习×W_learning)
    //     权重 Config['PERFORMANCE_FORMULA'] 覆盖, 默认 50/30/20
    const scoreMap = await this.computePerformanceScores(allUsers.map((u) => u.id))
    const computedAvgScore = totalActiveUsers > 0
      ? Math.round(
          allUsers.reduce((s, u) => s + (scoreMap.get(u.id) ?? 0), 0) / totalActiveUsers,
        )
      : 0
    const computedTopPerformers = topPerformers.map((p) => ({
      ...p,
      performance_score: scoreMap.get(p.id) ?? 0,
    }))

    return {
      range,
      from: from.toISOString(),
      to: now.toISOString(),
      total_sales: totalSales,
      achievement_rate: achievementRate,
      reached_count: reachedCount,
      total_active_users: totalActiveUsers,
      avg_management_level: avgManagementLevel,
      avg_score: computedAvgScore,
      total_recruited_users: totalRecruitedUsers,
      level_distribution: levelDistribution,
      near_promotion: nearPromotion,
      management_distribution: managementDistribution,
      m_upgrade_opportunities: mOpportunities,
      top_performers: computedTopPerformers,
      thresholds: {
          L_PROMOTE_HK: lCfgHK,
          L_PROMOTE_SG: lCfgSG,
          M_PROMOTE: mCfg,
        },
    }
  }

  /**
   * 2026-08-14: 自动算每个用户的 performance_score
   *
   * 公式: 业绩达成率×W_sales + 招管树规模×W_tree + 学习完成率×W_learning
   * 权重默认 50 / 30 / 20, 可通过 Config['PERFORMANCE_FORMULA'] 覆盖
   *
   * - 业绩达成率 = sales_amount / next_threshold × 100 (封顶 100)
   *   - L1→L2: l2Threshold, L2→L3: l3Threshold, L3: 已封顶 100
   *   - 阈值读 L_PROMOTE_HK.L2/L3
   * - 招管树规模 = current_management_level / 3 × 100 (封顶 100, M0 起步)
   * - 学习完成率 = completed_courses / total_courses × 100 (封顶 100)
   */
  async computePerformanceScores(userIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>()
    if (userIds.length === 0) return result

    // 1) 读权重 (默认 50/30/20)
    const formulaRow = await this.prisma.config
      .findUnique({ where: { key: 'PERFORMANCE_FORMULA' } })
      .catch(() => null)
    const weights = formulaRow
      ? JSON.parse(formulaRow.value)
      : { sales: 50, tree: 30, learning: 20 }

    // 2) 读 L 阈值 (HK 优先, 缺则用默认)
    const lRow = await this.prisma.config
      .findUnique({ where: { key: 'L_PROMOTE_HK' } })
      .catch(() => null)
    const lCfg: any = lRow ? JSON.parse(lRow.value) : { L2: 50000, L3: 100000 }
    const l2Threshold = Number(lCfg.L2 ?? 50000)
    const l3Threshold = Number(lCfg.L3 ?? 100000)

    // 3) 拉 user 关键字段
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        sales_amount: true,
        current_level: true,
        current_management_level: true,
      },
    })

    // 4) 学习完成数 (progress_percentage >= 100)
    const completedRows = await this.prisma.userCourseProgress.groupBy({
      by: ['user_id'],
      where: {
        user_id: { in: userIds },
        progress_percentage: { gte: 100 },
      },
      _count: { course_id: true },
    })
    const completedMap = new Map<string, number>()
    for (const r of completedRows) {
      completedMap.set(r.user_id, r._count.course_id)
    }

    // 5) 总课程数
    const totalCourses = await this.prisma.course.count().catch(() => 0)

    // 6) 算每 user 分数
    for (const u of users) {
      const sales = Number(u.sales_amount ?? 0)
      // 业绩达成率: 取 user current_level 对应的下一级阈值
      let nextThreshold = 0
      if (u.current_level <= 1) nextThreshold = l2Threshold
      else if (u.current_level === 2) nextThreshold = l3Threshold
      // current_level >= 3 → 已封顶, 100 分
      const salesPct =
        nextThreshold > 0 ? Math.min(100, (sales / nextThreshold) * 100) : 100

      // 招管树规模
      const treePct = Math.min(100, ((u.current_management_level ?? 0) / 3) * 100)

      // 学习完成率
      const completed = completedMap.get(u.id) ?? 0
      const learningPct =
        totalCourses > 0 ? Math.min(100, (completed / totalCourses) * 100) : 0

      const score = Math.round(
        salesPct * ((weights.sales ?? 50) / 100) +
          treePct * ((weights.tree ?? 30) / 100) +
          learningPct * ((weights.learning ?? 20) / 100),
      )
      result.set(u.id, score)
    }

    return result
  }
}
