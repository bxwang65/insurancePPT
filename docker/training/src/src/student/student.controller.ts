import { Controller, Get, Post, Body, Query, Req, NotFoundException } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { StudentService } from './student.service'
import { SyncProgressDto } from './dto/sync-progress.dto'
import { PrismaService } from '../prisma/prisma.service'
import { BusinessProfileService } from '../stats/business-profile.service'
import { UsersService } from '../users/users.service'

@ApiTags('学员端接口')
@Controller()
export class StudentController {
  constructor(
    private readonly studentService: StudentService,
    private readonly prisma: PrismaService,
    private readonly businessProfileService: BusinessProfileService,
    // 2026-08-14: 注入 UsersService (替代手动 new UsersService(this.prisma), 后者因 statsService 依赖而报错)
    private readonly usersService: UsersService,
  ) {}

  @Get('user/progress')
  @ApiOperation({ summary: '获取学习进度（含课程列表）' })
  async getProgress(@Req() req: any) {
    const userId = req.user?.userId || 'anonymous'
    const data = await this.studentService.getProgress(userId)
    return { success: true, data }
  }

  @Post('user/sync-progress')
  @ApiOperation({ summary: '同步学习进度（currentPosition 优先，兼容百分比）' })
  async syncProgress(@Req() req: any, @Body() dto: SyncProgressDto) {
    const userId = req.user?.userId || 'anonymous'
    const result = await this.studentService.syncProgress(userId, dto)
    return result
  }

  @Get('user/bill')
  @ApiOperation({ summary: '获取学习账单' })
  async getBill(@Req() req: any) {
    const userId = req.user?.userId || 'anonymous'
    const data = await this.studentService.getBill(userId)
    return { success: true, data }
  }

  @Get('user/medals')
  @ApiOperation({ summary: '获取荣誉勋章' })
  async getMedals(@Req() req: any) {
    const userId = req.user?.userId || 'anonymous'
    const data = await this.studentService.getMedals(userId)
    return { success: true, data }
  }

  @Get('materials')
  @ApiOperation({ summary: '获取全部课程资料列表' })
  async getMaterials(@Req() req: any) {
    const userId = req.user?.userId || 'anonymous'
    const data = await this.studentService.getMaterials(userId)
    return data
  }

  @Post('user/update-password')
  @ApiOperation({ summary: '修改密码' })
  async updatePassword(
    @Req() req: any,
    @Body() body: { oldPassword: string; newPassword: string },
  ) {
    const userId = req.user?.userId || 'anonymous'
    const result = await this.studentService.updatePassword(userId, body.oldPassword, body.newPassword)
    return result
  }

  // ============================================================
  // 2026-08-12: 基本法 - 学员自助查询 (只看自己)
  // ============================================================

  @Get('user/me/profile')
  @ApiOperation({ summary: '获取当前学员自己的基本法档案' })
  async getMyProfile(@Req() req: any) {
    const userId = req.user?.userId
    if (!userId) throw new NotFoundException('未登录')
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        recruiter: { select: { id: true, name: true } },
        manager: { select: { id: true, name: true } },
      },
    })
    if (!u) throw new NotFoundException('用户不存在')

    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const txSum = await this.prisma.transaction.groupBy({
      by: ['product_type'],
      where: {
        user_id: userId,
        sold_at: { gte: sixMonthsAgo },
        product_type: { in: ['HK', 'SG'] },
      },
      _sum: { std_premium: true },
    })
    let recent6mHK = 0
    let recent6mSG = 0
    for (const r of txSum) {
      const v = Number(r._sum.std_premium ?? 0)
      if (r.product_type === 'HK') recent6mHK = v
      if (r.product_type === 'SG') recent6mSG = v
    }
    const artCount = await this.prisma.transaction.count({
      where: {
        user_id: userId,
        sold_at: { gte: sixMonthsAgo },
        product_type: { in: ['ART_MODERN', 'ART_CONTEMP'] },
      },
    })

    const now = new Date()
    const maintenanceRemainingMonths = u.in_maintenance_until
      ? Math.max(0, Math.ceil((u.in_maintenance_until.getTime() - now.getTime()) / (30 * 86400 * 1000)))
      : null

    return {
      success: true,
      data: {
        id: u.id,
        name: u.name,
        avatar_url: u.avatar_url,
        title: u.title,
        role: u.role,
        current_level: u.current_level,
        current_management_level: u.current_management_level,
        // 2026-08-16: Phase 7 — pending + 维护期
        pending_level: u.pending_level,
        pending_management_level: u.pending_management_level,
        pending_effective_at: u.pending_effective_at?.toISOString() ?? null,
        last_promoted_at: u.last_promoted_at?.toISOString() ?? null,
        in_maintenance_until: u.in_maintenance_until?.toISOString() ?? null,
        maintenance_remaining_months: maintenanceRemainingMonths,
        // 2026-08-14: main_product 字段已删除
        joined_at: u.joined_at.toISOString(),
        recruiter_name: u.recruiter?.name ?? null,
        manager_name: u.manager?.name ?? null,
        recent_6m_std_premium_HK: recent6mHK,
        recent_6m_std_premium_SG: recent6mSG,
        recent_6m_art_count: artCount,
      },
    }
  }

  @Get('user/me/tree')
  @ApiOperation({ summary: '获取当前学员自己的推管树' })
  async getMyTree(@Req() req: any) {
    const userId = req.user?.userId
    if (!userId) throw new NotFoundException('未登录')
    return this.usersService.getTree(userId)
  }

  @Get('user/me/berlue-received')
  @ApiOperation({ summary: '获取我作为招募人收到的伯乐 (1代 + 2代下线出单触发)' })
  async getMyBerlueReceived(@Req() req: any) {
    const userId = req.user?.userId
    if (!userId) throw new NotFoundException('未登录')
    return this.usersService.getBerlueReceived(userId)
  }

  // 2026-08-16: 管理奖 (招管分离第2棵树, 极差)
  @Get('user/me/management-received')
  @ApiOperation({ summary: '获取我作为主管收到的管理奖 (极差, 走 manager_id 链)' })
  async getMyManagementReceived(@Req() req: any) {
    const userId = req.user?.userId
    if (!userId) throw new NotFoundException('未登录')
    return this.usersService.getManagementReceived(userId)
  }

  @Get('user/me/level-history')
  @ApiOperation({ summary: '获取当前学员自己的等级历史' })
  async getMyLevelHistory(@Req() req: any) {
    const userId = req.user?.userId
    if (!userId) throw new NotFoundException('未登录')
    const history = await this.prisma.levelHistory.findMany({
      where: { user_id: userId },
      orderBy: { eval_at: 'desc' },
    })
    return {
      success: true,
      data: history.map((h) => ({
        id: h.id,
        level: h.level,
        mgmt_level: h.mgmt_level,
        eval_at: h.eval_at.toISOString(),
        effective_at: h.effective_at?.toISOString() ?? null,
        status: h.status,
        window_start: h.window_start.toISOString(),
        window_end: h.window_end.toISOString(),
        reason: h.reason,
        trigger: h.trigger,
      })),
    }
  }

  /**
   * 2026-08-14: 个人业务画像 (学员自助)
   *   - range: month | quarter | year (默认 month, 影响 monthly_trend 的月份数与本月统计)
   *   - 当前 L 等级 + 距升级差多少
   *   - 当前 M 等级 + 招募树规模
   *   - 招管两棵树 (我招的人 + 我的主管链, 头像链)
   *   - 近 6 月标保 trend (mini sparkline 数据)
   *   - 业务逻辑抽到 BusinessProfileService, 与 admin 查看任意学员的 /admin/stats/students/:id/business 共用
   */
  @Get('user/me/business')
  @ApiOperation({ summary: '获取当前学员个人业务画像 (L/M 进度 + 招管树 + 月度 trend)' })
  async getMyBusiness(@Req() req: any, @Query('range') range?: 'month' | 'quarter' | 'year') {
    const userId = req.user?.userId
    if (!userId) throw new NotFoundException('未登录')
    const r: 'month' | 'quarter' | 'year' =
      range === 'quarter' || range === 'year' ? range : 'month'
    const data = await this.businessProfileService.getStudentBusiness(userId, r)
    if (!data) throw new NotFoundException('用户不存在')
    return { success: true, data }
  }
}