import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Req, BadRequestException } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger'
import { UsersService } from './users.service'
import { CreateUserDto, UpdateUserStatusDto, UpdateUserDto, UserQueryDto } from './dto/create-user.dto'
import { AdminGuard } from '../auth/guards/admin.guard'
import { PrismaService } from '../prisma/prisma.service'

@ApiTags('管理员 - 员工管理')
@Controller('admin/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '创建新员工账号 (仅本地, 不创建 Firebase Auth, 用户无法登录 hksgtools.cn)' })
  async create(@Body() dto: CreateUserDto, @Req() req: any) {
    return this.usersService.create(dto, req.user?.sub)
  }

  /**
   * 2026-08-13: 批量开通账号 (替代 4in1 AdminUsers.vue 的批量开通)
   *   - 内部调用 insurance-ppt 的 /api/admin/users/batch-create
   *     (那一步会创建 Firebase Auth user, 密码 123456, 同时通过 internal upsert 把 user 推到培训 DB)
   *   - 然后培训这边再 PATCH 给每个用户补充业务字段 (recruiter_id / manager_id / title / is_admin)
   *   - 用户创建后立刻能用 email + 123456 登录 hksgtools.cn
   *
   * Body: {
   *   users: Array<{
   *     email: string
   *     name?: string
   *     password?: string           // 默认 123456
   *     recruiter_id?: string       // 招募人 (招管分离的第 1 棵树根)
   *     manager_id?: string         // 主管 (默认 = recruiter_id, 可覆盖)
   *     title?: string              // 头衔: L1 / L2 / L3
   *     joined_at?: string          // 入职日期 ISO, 默认 now
   *     is_admin?: boolean          // 默认 false, 管理员用户最多 3 个
   *   }>
   * }
   */
  @Post('batch')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '批量开通员工 (创建 Firebase Auth + 培训 User, 可登录 hksgtools.cn)' })
  async batchCreate(
    @Body() body: { users: Array<{
      email: string
      name?: string
      password?: string
      recruiter_id?: string
      manager_id?: string
      title?: string
      // 2026-08-23: 联系手机号 (可选, 区别于旧 phone 登录字段)
      mobile?: string
      joined_at?: string
      is_admin?: boolean
    }> },
    @Req() req: any,
  ) {
    const rows = Array.isArray(body?.users) ? body.users : []
    if (rows.length === 0) throw new BadRequestException('缺少 users 数组')
    if (rows.length > 200) throw new BadRequestException('单次最多 200 个')

    // 2026-08-14: 管理员数量上限校验 (≤3)
    //   - 统计当前已有 is_admin=true 的用户数
    //   - 本次请求中 is_admin=true 的行数
    //   - 已删/已禁用但保留 admin 标记的也算 (避免反复解锁/禁用绕过)
    const newAdminCount = rows.filter((u) => u.is_admin === true).length
    if (newAdminCount > 0) {
      const existingAdminCount = await this.prisma.user.count({ where: { is_admin: true } })
      if (existingAdminCount + newAdminCount > 3) {
        throw new BadRequestException(
          `管理员上限 3 个, 当前已有 ${existingAdminCount} 个, 本次新增 ${newAdminCount} 个, 总数 ${existingAdminCount + newAdminCount} 超过限制`,
        )
      }
    }

    // Step 1: 内部调用 insurance-ppt 创建 Firebase Auth user (它会自动 sync 到培训 DB)
    const insuranceUrl = process.env.INSURANCE_PPT_URL || 'http://insurance-ppt:80'
    let fbResult: { created: any[]; skipped: any[]; failed: any[] } = { created: [], skipped: [], failed: [] }
    try {
      const adminToken = (req.headers?.authorization || '').replace(/^Bearer\s+/i, '')
      const res = await fetch(`${insuranceUrl}/api/admin/users/batch-create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 把 admin 的 JWT 原样转给 insurance-ppt (它的 batch-create 需要 isAdmin)
          'Authorization': `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          users: rows.map((u) => ({
            email: u.email,
            name: u.name || u.email.split('@')[0],
          })),
          defaultPassword: '123456',
        }),
      })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { success: false, message: data?.message || `insurance-ppt HTTP ${res.status}`, data }
      }
      fbResult = data
    } catch (e: any) {
      throw new BadRequestException(`调用 insurance-ppt 失败: ${e?.message || e}`)
    }

    // Step 2: 给同步过来的 User 行补充业务字段 (recruiter/manager/title/is_admin/joined_at)
    //  insurance-ppt 那边创建的 user 已经通过 internal upsert 推到了培训 DB,
    //  这里按 email 找回来再 PATCH
    const enriched: Array<{ email: string; userId?: string; status: 'enriched' | 'skipped' | 'failed'; error?: string }> = []
    const createdAndSkipped = [
      ...fbResult.created.map((x) => ({ ...x, _src: 'created' as const })),
      ...fbResult.skipped.map((x) => ({ ...x, _src: 'skipped' as const })),
    ]
    for (const u of rows) {
      const matched = createdAndSkipped.find((m) => m.email === u.email)
      if (!matched) {
        enriched.push({ email: u.email, status: 'skipped', error: 'Firebase 端创建失败, 跳过 enrichment' })
        continue
      }
      try {
        const local = await this.prisma.user.findFirst({ where: { email: u.email } })
        if (!local) {
          enriched.push({ email: u.email, status: 'failed', error: '培训 DB 找不到同步过来的 user' })
          continue
        }
        // 招管分离: manager_id 默认 = recruiter_id
        const managerId = u.manager_id ?? u.recruiter_id ?? local.manager_id ?? null
        await this.prisma.user.update({
          where: { id: local.id },
          data: {
            title: u.title ?? local.title,
            // 2026-08-23: 联系手机号 (可选)
            mobile: u.mobile ?? local.mobile,
            recruiter_id: u.recruiter_id ?? local.recruiter_id,
            manager_id: managerId,
            joined_at: u.joined_at ? new Date(u.joined_at) : local.joined_at,
            // 2026-08-14: is_admin 透传 (前面已校验总数 ≤3)
            ...(u.is_admin === true ? { is_admin: true } : {}),
          },
        })
        enriched.push({ email: u.email, userId: local.id, status: 'enriched' })
      } catch (e: any) {
        enriched.push({ email: u.email, status: 'failed', error: e?.message || String(e) })
      }
    }

    return {
      success: true,
      data: {
        firebase: fbResult,
        enriched,
        summary: {
          firebase_created: fbResult.created.length,
          firebase_skipped: fbResult.skipped.length,
          firebase_failed: fbResult.failed.length,
          enriched_ok: enriched.filter((e) => e.status === 'enriched').length,
          enriched_failed: enriched.filter((e) => e.status === 'failed').length,
        },
      },
    }
  }

  @Get()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '获取员工列表（分页+搜索, 含L/M等级+招募人/主管+近6月业绩）' })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'phone', required: false })
  @ApiQuery({ name: 'is_active', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(@Query() query: UserQueryDto) {
    return this.usersService.findAll(query)
  }

  @Get(':id/tree')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '推管树可视化 (招募链/管理链 2级穿透)' })
  async getTree(@Param('id') id: string) {
    return this.usersService.getTree(id)
  }

  @Get(':id/level-history')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '等级变更历史' })
  async getLevelHistory(@Param('id') id: string) {
    return this.usersService.getLevelHistory(id)
  }

  @Get(':id/manager-changes')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '主管变更日志 (招管分离 override 审计)' })
  async getManagerChanges(@Param('id') id: string) {
    return this.usersService.getManagerChanges(id)
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '更新员工信息（头衔/角色/等级/业绩/招募人/主管/主推产品）' })
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: any) {
    return this.usersService.update(id, dto, req.user?.sub)
  }

  @Patch(':id/status')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '启用/禁用员工账号' })
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    return this.usersService.updateStatus(id, dto)
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '删除员工 (级联清理进度/业绩/日志, 不可恢复)' })
  async remove(@Param('id') id: string) {
    return this.usersService.remove(id)
  }

  /**
   * 2026-08-14: 管理员重置用户密码为默认 123456
   *   - 委托 insurance-ppt 调 Firebase Admin SDK
   *   - 清掉 pwd_changed claim → 用户下次登录触发 mustChangePassword → 自动弹改密模态
   *   - 用于忘记密码 / 强制重置场景
   */
  @Post(':id/reset-password')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '重置员工密码为默认 123456 (用户下次登录自动弹改密)' })
  async resetPassword(@Param('id') id: string, @Req() req: any) {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) throw new BadRequestException(`找不到员工 id=${id}`)
    if (!user.email) throw new BadRequestException(`该员工没有 email, 无法重置 Firebase 密码`)
    const insuranceUrl = process.env.INSURANCE_PPT_URL || 'http://insurance-ppt:80'
    const adminToken = (req.headers?.authorization || '').replace(/^Bearer\s+/i, '')
    try {
      const res = await fetch(`${insuranceUrl}/api/admin/users/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ email: user.email }),
      })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new BadRequestException(data?.message || `insurance-ppt HTTP ${res.status}`)
      }
      return { success: true, message: data?.message || '密码已重置', data: { email: user.email } }
    } catch (e: any) {
      if (e?.status) throw e
      throw new BadRequestException(`重置失败: ${e?.message || e}`)
    }
  }
}