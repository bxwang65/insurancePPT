import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { StatsService } from '../stats/stats.service'
import { CreateUserDto, UpdateUserStatusDto, UpdateUserDto, UserQueryDto } from './dto/create-user.dto'
import * as bcrypt from 'bcrypt'

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    // 2026-08-14: 注入 StatsService 用 computePerformanceScores 自动算分
    private readonly statsService: StatsService,
  ) {}

  /**
   * POST /api/admin/users
   * 管理员创建员工账号
   */
  async create(dto: CreateUserDto, recordedBy?: string) {
    const existing = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    })
    if (existing) {
      throw new ConflictException('该手机号已存在')
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10)

    // 2026-08-12: 招管分离 - 默认 manager_id = recruiter_id
    const managerId = dto.manager_id ?? dto.recruiter_id ?? null

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        // 2026-08-23: 联系手机号 (可选, 区别于旧 phone 登录字段)
        mobile: dto.mobile ?? null,
        password: hashedPassword,
        title: dto.title ?? null,
        role: dto.role ?? '新人学员',
        level: dto.level ?? 1,
        level_name: this.getLevelName(dto.level ?? 1),
        is_active: true,
        // 基本法字段
        recruiter_id: dto.recruiter_id ?? null,
        manager_id: managerId,
        current_level: dto.current_level ?? 1,
        current_management_level: dto.current_management_level ?? 1,
        // 2026-08-14: main_product 字段已删除 (产品维度不再由 user 决定)
        joined_at: dto.joined_at ? new Date(dto.joined_at) : new Date(),
        status: dto.status ?? 'ACTIVE',
      },
    })

    // 写初始 LevelHistory (NEW_HIRE)
    await this.prisma.levelHistory.create({
      data: {
        user_id: user.id,
        level: user.current_level,
        mgmt_level: user.current_management_level,
        eval_at: new Date(),
        window_start: user.joined_at,
        window_end: new Date(),
        reason: 'INITIAL',
        trigger: 'NEW_HIRE',
      },
    })

    return {
      success: true,
      data: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        title: user.title,
        role: user.role,
        level: user.level,
        level_name: user.level_name,
        current_level: user.current_level,
        current_management_level: user.current_management_level,
        recruiter_id: user.recruiter_id,
        manager_id: user.manager_id,
        // 2026-08-14: main_product 字段已删除
        joined_at: user.joined_at.toISOString(),
        status: user.status,
        is_active: user.is_active,
        created_at: user.created_at.toISOString(),
      },
    }
  }

  /**
   * GET /api/admin/users
   * 分页获取员工列表 (含 L/M 等级 + 招募人/主管名字 + 近6月业绩聚合)
   */
  async findAll(query: UserQueryDto) {
    const { name, phone, is_active, page = 1, limit = 10 } = query
    const skip = (page - 1) * limit

    const where: any = {}
    if (name) where.name = { contains: name }
    if (phone) where.phone = { contains: phone }
    if (is_active !== undefined) where.is_active = is_active

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          _count: { select: { course_progress: true } },
          recruiter: { select: { id: true, name: true } },
          manager: { select: { id: true, name: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ])

    // 2026-08-12: 批量计算每人的近 6 月业绩
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const userIds = users.map((u) => u.id)
    const recentTx = userIds.length
      ? await this.prisma.transaction.groupBy({
          by: ['user_id', 'product_type'],
          where: { user_id: { in: userIds }, sold_at: { gte: sixMonthsAgo } },
          _sum: { std_premium: true, sale_price: true },
          _count: { id: true },
        })
      : []

    const txMap = new Map<string, { HK: number; SG: number; ART_MODERN: number; ART_CONTEMP: number; artCount: number }>()
    for (const row of recentTx) {
      const cur = txMap.get(row.user_id) ?? { HK: 0, SG: 0, ART_MODERN: 0, ART_CONTEMP: 0, artCount: 0 }
      if (row.product_type === 'HK') cur.HK += Number(row._sum.std_premium ?? 0)
      else if (row.product_type === 'SG') cur.SG += Number(row._sum.std_premium ?? 0)
      else if (row.product_type === 'ART_MODERN') {
        cur.ART_MODERN = Number(row._sum.sale_price ?? 0)
        cur.artCount += row._count.id
      } else if (row.product_type === 'ART_CONTEMP') {
        cur.ART_CONTEMP = Number(row._sum.sale_price ?? 0)
        cur.artCount += row._count.id
      }
      txMap.set(row.user_id, cur)
    }

    // 2026-08-14: 自动算 performance_score (formula-based, 取代 u.performance_score)
    const scoreMap = await this.statsService.computePerformanceScores(userIds)

    return {
      success: true,
      data: {
        users: users.map((u) => {
          const tx = txMap.get(u.id) ?? { HK: 0, SG: 0, ART_MODERN: 0, ART_CONTEMP: 0, artCount: 0 }
          return {
            id: u.id,
            name: u.name,
            phone: u.phone,
            // 2026-08-23: 联系手机号 (可选, 区别于旧 phone 登录字段)
            mobile: u.mobile,
            email: u.email,
            avatar_url: u.avatar_url,
            role: u.role,
            title: u.title,
            level: u.level,
            level_name: u.level_name,
            is_active: u.is_active,
            // 2026-08-14: 暴露 is_admin 给前端算 adminCount (账户类型选择上限 3 个校验)
            is_admin: u.is_admin,
            total_learning_minutes: u.total_learning_minutes,
            sales_amount: u.sales_amount ? Number(u.sales_amount) : 0,
            performance_score: scoreMap.get(u.id) ?? 0,
            performance_updated_at: u.performance_updated_at?.toISOString() ?? null,
            // 2026-08-12: 基本法字段
            current_level: u.current_level,
            current_management_level: u.current_management_level,
            // 2026-08-16: Phase 7 — pending + 维护期
            pending_level: u.pending_level,
            pending_management_level: u.pending_management_level,
            pending_effective_at: u.pending_effective_at?.toISOString() ?? null,
            in_maintenance_until: u.in_maintenance_until?.toISOString() ?? null,
            last_promoted_at: u.last_promoted_at?.toISOString() ?? null,
            recruiter_id: u.recruiter_id,
            recruiter_name: u.recruiter?.name ?? null,
            manager_id: u.manager_id,
            manager_name: u.manager?.name ?? null,
            // 2026-08-14: main_product 字段已删除, UI 不再显示
            joined_at: u.joined_at.toISOString(),
            status: u.status,
            // 近6月业绩
            recent_6m_std_premium_HK: tx.HK,
            recent_6m_std_premium_SG: tx.SG,
            recent_6m_art_sales_RMB: tx.ART_MODERN + tx.ART_CONTEMP,
            recent_6m_art_count: tx.artCount,
            created_at: u.created_at.toISOString(),
            course_count: u._count.course_progress,
          }
        }),
        total,
        page,
        limit,
      },
    }
  }

  /**
   * PATCH /api/admin/users/:id
   * 通用更新 (头衔/角色/等级/业绩/招募人/主管/主推产品)
   * 改 manager_id 会写 ManagerChangeLog (招管分离的 override 审计)
   */
  async update(id: string, dto: UpdateUserDto, recordedBy?: string) {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) {
      throw new NotFoundException(`员工 ${id} 不存在`)
    }

    const data: any = {}
    if (dto.title !== undefined) data.title = dto.title
    // 2026-08-23: 联系手机号 (可选, 与旧 phone 登录字段不同)
    if (dto.mobile !== undefined) data.mobile = dto.mobile
    if (dto.role !== undefined) data.role = dto.role
    if (dto.level !== undefined) {
      data.level = dto.level
      data.level_name = this.getLevelName(dto.level)
    }
    if (dto.sales_amount !== undefined) data.sales_amount = dto.sales_amount
    if (dto.performance_score !== undefined) data.performance_score = dto.performance_score
    if (dto.current_level !== undefined) data.current_level = dto.current_level
    if (dto.current_management_level !== undefined) data.current_management_level = dto.current_management_level
    if (dto.recruiter_id !== undefined) data.recruiter_id = dto.recruiter_id
    // 2026-08-14: main_product 字段已删除
    if (dto.joined_at !== undefined) data.joined_at = new Date(dto.joined_at)
    if (dto.status !== undefined) data.status = dto.status

    // 2026-08-12: 招管分离 - 改 manager_id 时记录 override 日志
    let managerChanged = false
    if (dto.manager_id !== undefined && dto.manager_id !== user.manager_id) {
      // 验证目标 manager 存在
      if (dto.manager_id !== null) {
        const targetMgr = await this.prisma.user.findUnique({ where: { id: dto.manager_id } })
        if (!targetMgr) throw new BadRequestException(`主管 ${dto.manager_id} 不存在`)
      }
      data.manager_id = dto.manager_id
      managerChanged = true
    }

    // 任意字段变化都刷新 updated_at
    const willUpdate = Object.keys(data).length > 0 || managerChanged
    if (willUpdate) data.performance_updated_at = new Date()

    const updated = await this.prisma.user.update({ where: { id }, data })

    // 写 ManagerChangeLog (override 主管的事件审计)
    if (managerChanged && recordedBy) {
      await this.prisma.managerChangeLog.create({
        data: {
          user_id: id,
          old_manager_id: user.manager_id,
          new_manager_id: dto.manager_id ?? null,
          changed_by: recordedBy,
          reason: dto.manager_change_reason ?? null,
        },
      })
    }

    return {
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        title: updated.title,
        role: updated.role,
        level: updated.level,
        level_name: updated.level_name,
        sales_amount: updated.sales_amount ? Number(updated.sales_amount) : 0,
        performance_score: updated.performance_score ?? 0,
        performance_updated_at: updated.performance_updated_at?.toISOString() ?? null,
        current_level: updated.current_level,
        current_management_level: updated.current_management_level,
        recruiter_id: updated.recruiter_id,
        manager_id: updated.manager_id,
        joined_at: updated.joined_at.toISOString(),
        status: updated.status,
        manager_changed: managerChanged,
      },
    }
  }

  /**
   * PATCH /api/admin/users/:id/status
   * 启用/禁用员工账号
   */
  async updateStatus(id: string, dto: UpdateUserStatusDto) {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) {
      throw new NotFoundException(`员工 ${id} 不存在`)
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { is_active: dto.is_active },
    })
    return {
      success: true,
      data: { id: updated.id, name: updated.name, is_active: updated.is_active },
    }
  }

  /**
   * DELETE /api/admin/users/:id
   * 2026-08-14: 删除员工 (admin only). 级联清理:
   *   - 把指向该 user 的 recruiter_id / manager_id 置空 (其他员工保留)
   *   - 删该 user 的进度/勋章/反馈/业绩/等级历史/主管变更日志
   *   - 4in1 那边 Firebase Auth + users.json 不动 (admin 用 4in1 管理账号, 不耦合培训 DB)
   *     如需一并删, 请走 4in1 batch-create 同款的 reverse (TODO)
   */
  async remove(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) throw new NotFoundException(`员工 ${id} 不存在`)
    if (user.is_admin) throw new BadRequestException('不能删除 admin 账号, 请先降权')

    // 1. 清空指向该 user 的反向引用 (其他员工保留, 仅关系断)
    await this.prisma.user.updateMany({
      where: { OR: [{ recruiter_id: id }, { manager_id: id }] },
      data: { recruiter_id: null, manager_id: null },
    })

    // 2. 删该 user 的子表 (顺序无关, 都是 user_id 外键无循环)
    await Promise.all([
      this.prisma.userCourseProgress.deleteMany({ where: { user_id: id } }),
      this.prisma.userHonor.deleteMany({ where: { user_id: id } }),
      this.prisma.feedback.deleteMany({ where: { user_id: id } }),
      this.prisma.transaction.deleteMany({ where: { user_id: id } }),
      this.prisma.levelHistory.deleteMany({ where: { user_id: id } }),
      // ManagerChangeLog 有双向引用: ChangedUser (被改的人) + ChangedBy (动手的人)
      this.prisma.managerChangeLog.deleteMany({
        where: { OR: [{ user_id: id }, { changed_by: id }] },
      }),
    ])

    // 3. 删 user 自身
    await this.prisma.user.delete({ where: { id } })

    return {
      success: true,
      data: { id, name: user.name, deleted: true },
    }
  }

  /**
   * GET /api/admin/users/:id/tree
   * 推管树可视化 - 返回该 user 的:
   *   - recruiter 招募链 (向上最多2级: 招募人 + 招募人招募人)
   *   - manager 管理链 (向上最多2级: 主管 + 主管的主管)
   *   - recruited 后代 (直接招募人, 1级)
   *   - managed 后代 (直接下级主管, 1级)
   */
  async getTree(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        recruiter: { select: { id: true, name: true, avatar_url: true, current_level: true, current_management_level: true } },
        manager: { select: { id: true, name: true, avatar_url: true, current_level: true, current_management_level: true } },
      },
    })
    if (!user) throw new NotFoundException(`员工 ${userId} 不存在`)

    // 招募链 (向上最多2级)
    const recruiterChain = []
    let cur: { id: string; name: string; avatar_url: string | null; current_level: number; current_management_level: number } | null = user.recruiter
    let depth = 0
    while (cur && depth < 2) {
      recruiterChain.push({
        depth: depth + 1,
        id: cur.id,
        name: cur.name,
        avatar_url: cur.avatar_url,
        current_level: cur.current_level,
        current_management_level: cur.current_management_level,
      })
      const next = await this.prisma.user.findUnique({
        where: { id: cur.id },
        select: { recruiter: { select: { id: true, name: true, avatar_url: true, current_level: true, current_management_level: true } } },
      })
      cur = next?.recruiter ?? null
      depth++
    }

    // 管理链 (向上最多2级)
    const managerChain = []
    cur = user.manager
    depth = 0
    while (cur && depth < 2) {
      managerChain.push({
        depth: depth + 1,
        id: cur.id,
        name: cur.name,
        avatar_url: cur.avatar_url,
        current_level: cur.current_level,
        current_management_level: cur.current_management_level,
      })
      const next = await this.prisma.user.findUnique({
        where: { id: cur.id },
        select: { manager: { select: { id: true, name: true, avatar_url: true, current_level: true, current_management_level: true } } },
      })
      cur = next?.manager ?? null
      depth++
    }

    // 直接招募人 (1级后代)
    const recruited = await this.prisma.user.findMany({
      where: { recruiter_id: userId },
      select: { id: true, name: true, avatar_url: true, current_level: true, current_management_level: true, joined_at: true },
      orderBy: { joined_at: 'asc' },
    })

    // 直接下级主管 (1级后代)
    const manages = await this.prisma.user.findMany({
      where: { manager_id: userId },
      select: { id: true, name: true, avatar_url: true, current_level: true, current_management_level: true, joined_at: true },
      orderBy: { joined_at: 'asc' },
    })

    // 计算本 user 近 6 月招募树穿透 (2级) 业绩
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const allDescendantIds = new Set<string>()
    for (const r of recruited) allDescendantIds.add(r.id)
    for (const r of recruited) {
      const grand = await this.prisma.user.findMany({
        where: { recruiter_id: r.id },
        select: { id: true },
      })
      for (const g of grand) allDescendantIds.add(g.id)
    }

    let tree2LevelTotal = 0
    let tree2LevelHK = 0
    let tree2LevelSG = 0
    if (allDescendantIds.size > 0) {
      const txSum = await this.prisma.transaction.groupBy({
        by: ['product_type'],
        where: {
          user_id: { in: Array.from(allDescendantIds) },
          sold_at: { gte: sixMonthsAgo },
          product_type: { in: ['HK', 'SG'] },
        },
        _sum: { std_premium: true },
      })
      for (const row of txSum) {
        const v = Number(row._sum.std_premium ?? 0)
        if (row.product_type === 'HK') tree2LevelHK += v
        if (row.product_type === 'SG') tree2LevelSG += v
        tree2LevelTotal += v
      }
    }

    return {
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          avatar_url: user.avatar_url,
          current_level: user.current_level,
          current_management_level: user.current_management_level,
          // 2026-08-14: main_product 字段已删除
          joined_at: user.joined_at.toISOString(),
        },
        // 向上
        recruiter_chain: recruiterChain, // 招募链 (向上2级)
        manager_chain: managerChain,     // 管理链 (向上2级)
        // 向下
        recruited: recruited.map((r) => ({
          ...r,
          joined_at: r.joined_at.toISOString(),
        })),
        manages: manages.map((m) => ({
          ...m,
          joined_at: m.joined_at.toISOString(),
        })),
        // 团队业绩 (招募树2级穿透)
        tree_metrics: {
          direct_recruits: recruited.length,
          tree_2level_total_6m: tree2LevelTotal, // HK + SG 合计
          tree_2level_HK_6m: tree2LevelHK,
          tree_2level_SG_6m: tree2LevelSG,
        },
      },
    }
  }

  /**
   * GET /api/admin/users/:id/level-history
   * 等级变更历史
   */
  async getLevelHistory(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException(`员工 ${userId} 不存在`)
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
        // 2026-08-16: Phase 7 — effective_at + status
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
   * 2026-08-16: 我作为招募人收到的伯乐 (1代 + 2代下线出单触发)
   *   - TransactionBerlue 表里有 beneficiary_id = me 的所有行
   *   - join Transaction (HK产品) + User (downline 姓名)
   *   - 返回 list: [downline_name, product_code, product_plan, term, type, amount, sold_at]
   */
  async getBerlueReceived(userId: string) {
    const rows = await this.prisma.transactionBerlue.findMany({
      where: { beneficiary_id: userId },
      include: {
        transaction: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { computed_at: 'desc' },
    })

    const items = rows.map((r) => ({
      id: r.id,
      type: r.type, // 'direct' | 'indirect'
      amount: Number(r.amount),
      direct_pct: r.direct_pct != null ? Number(r.direct_pct) : null,
      indirect_pct: r.indirect_pct != null ? Number(r.indirect_pct) : null,
      investor: r.investor,
      level: r.level,
      computed_at: r.computed_at.toISOString(),
      // 下线信息
      transaction_id: r.transaction_id,
      sold_at: r.transaction.sold_at.toISOString(),
      downline_id: r.transaction.user.id,
      downline_name: r.transaction.user.name,
      // HK 产品
      hk_company: r.transaction.hk_company,
      hk_code: r.transaction.hk_code,
      hk_plan: r.transaction.hk_plan,
      hk_term: r.transaction.hk_term,
      annual_premium: r.transaction.annual_premium != null ? Number(r.transaction.annual_premium) : null,
    }))

    // 汇总 (direct vs indirect 分开 + 总计)
    const totalDirect = items.filter((x) => x.type === 'direct').reduce((s, x) => s + x.amount, 0)
    const totalIndirect = items.filter((x) => x.type === 'indirect').reduce((s, x) => s + x.amount, 0)
    const totalAll = totalDirect + totalIndirect
    const downlineIds = new Set(items.map((x) => x.downline_id))

    return {
      success: true,
      data: {
        items,
        summary: {
          total_usd: Math.round(totalAll * 100) / 100,
          direct_usd: Math.round(totalDirect * 100) / 100,
          indirect_usd: Math.round(totalIndirect * 100) / 100,
          downline_count: downlineIds.size,
          entry_count: items.length,
        },
      },
    }
  }

  /**
   * 2026-08-16: 我作为主管收到的管理奖 (招管分离第2棵树, 极差)
   *   - TransactionManagement 表里 beneficiary_id = me 的所有行
   *   - join Transaction + User (downline 姓名)
   *   - 返回 list + summary (直接/间接分别合计 + 总计)
   */
  async getManagementReceived(userId: string) {
    const rows = await this.prisma.transactionManagement.findMany({
      where: { beneficiary_id: userId },
      include: {
        transaction: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { computed_at: 'desc' },
    })

    const items = rows.map((r) => ({
      id: r.id,
      chain_depth: r.chain_depth, // 1=直接 (L2-L1), 2=间接 (L3-L1)
      amount: Number(r.amount),
      manager_y1_pct: r.manager_y1_pct != null ? Number(r.manager_y1_pct) : null,
      l1_y1_pct: r.l1_y1_pct != null ? Number(r.l1_y1_pct) : null,
      investor: r.investor,
      level: r.level,
      computed_at: r.computed_at.toISOString(),
      // 下线信息
      transaction_id: r.transaction_id,
      sold_at: r.transaction.sold_at.toISOString(),
      downline_id: r.transaction.user.id,
      downline_name: r.transaction.user.name,
      // HK 产品
      hk_company: r.transaction.hk_company,
      hk_code: r.transaction.hk_code,
      hk_plan: r.transaction.hk_plan,
      hk_term: r.transaction.hk_term,
      annual_premium: r.transaction.annual_premium != null ? Number(r.transaction.annual_premium) : null,
    }))

    // 汇总 (直接 vs 间接)
    const direct = items.filter((x) => x.chain_depth === 1).reduce((s, x) => s + x.amount, 0)
    const indirect = items.filter((x) => x.chain_depth === 2).reduce((s, x) => s + x.amount, 0)
    const totalAll = direct + indirect
    const downlineIds = new Set(items.map((x) => x.downline_id))

    return {
      success: true,
      data: {
        items,
        summary: {
          total_usd: Math.round(totalAll * 100) / 100,
          direct_usd: Math.round(direct * 100) / 100,
          indirect_usd: Math.round(indirect * 100) / 100,
          downline_count: downlineIds.size,
          entry_count: items.length,
        },
      },
    }
  }

  /**
   * GET /api/admin/users/:id/manager-changes
   * 主管变更日志
   */
  async getManagerChanges(userId: string) {
    const logs = await this.prisma.managerChangeLog.findMany({
      where: { user_id: userId },
      orderBy: { at: 'desc' },
      include: {
        user: { select: { id: true, name: true } },
        changer: { select: { id: true, name: true } },
      },
    })
    return {
      success: true,
      data: logs.map((l) => ({
        id: l.id,
        user: l.user,
        old_manager_id: l.old_manager_id,
        new_manager_id: l.new_manager_id,
        changer: l.changer,
        reason: l.reason,
        at: l.at.toISOString(),
      })),
    }
  }

  private getLevelName(level: number): string {
    const map: Record<number, string> = {
      1: '初阶阶段',
      2: '进阶阶段',
      3: '高阶阶段',
    }
    return map[level] ?? '初阶阶段'
  }
}