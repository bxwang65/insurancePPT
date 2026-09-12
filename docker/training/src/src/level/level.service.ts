import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { ConfigService } from '../config/config.service'

export interface EvalResult {
  user_id: string
  old_level: number
  new_level: number
  old_mgmt_level: number
  new_mgmt_level: number
  reason: 'PROMOTE' | 'DEMOTE' | 'MAINTAIN' | 'INITIAL'
  trigger: 'CRON' | 'MANUAL' | 'NEW_HIRE' | 'NEW_TX'
  window_start: Date
  window_end: Date
  // 2026-08-16: pending (Phase 7)
  pending_level: number | null
  pending_management_level: number | null
  pending_effective_at: Date | null
  in_maintenance_until: Date | null
  // 调试用上下文
  context: {
    recent_6m_HK: number
    recent_6m_SG: number
    direct_recruits: number
    tree_2level_total_6m: number
    tree_2level_HK_6m: number
    tree_2level_SG_6m: number
  }
}

@Injectable()
export class LevelService {
  private readonly logger = new Logger(LevelService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 月度评估 - 每月 1 号 00:00 跑 (rolling 6-month 自动评估)
   * 2026-08-16: 内部已包含维护期检查 + pending staging
   */
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async monthlyEvalCron() {
    this.logger.log('月度 L/M 评估开始...')
    const asOf = new Date()
    const results = await this.evaluateAll(asOf, 'CRON')
    const promoted = results.filter((r) => r.reason === 'PROMOTE').length
    const demoted = results.filter((r) => r.reason === 'DEMOTE').length
    const pending = results.filter((r) => r.pending_level !== null || r.pending_management_level !== null).length
    this.logger.log(`月度评估完成: ${results.length} 人, 升级 ${promoted}, 降级 ${demoted}, pending ${pending}`)
    // 月度 cron 跑完顺便 commit 一次 (冗余, 防 daily cron 漏跑)
    await this.commitScheduledChanges().catch((e) =>
      this.logger.warn(`[L/M Commit on cron] 失败: ${e?.message ?? e}`),
    )
  }

  /**
   * 2026-08-16: daily commit — 每天 00:05 把 pending_effective_at <= now 的 user 应用到 current
   */
  @Cron('5 0 * * *')
  async dailyCommitCron() {
    try {
      const count = await this.commitScheduledChanges()
      if (count > 0) this.logger.log(`[L/M Commit cron] ${count} 人 pending 已生效`)
    } catch (e: any) {
      this.logger.error(`[L/M Commit cron] 失败: ${e?.message ?? e}`)
    }
  }

  /**
   * 把所有 pending_effective_at <= now 的 user 真正 commit 到 current_*,
   * 升级时设置 in_maintenance_until = now + 6m, 降级时清维护期.
   */
  async commitScheduledChanges(): Promise<number> {
    const now = new Date()
    const dueUsers = await this.prisma.user.findMany({
      where: {
        pending_effective_at: { lte: now },
        OR: [
          { pending_level: { not: null } },
          { pending_management_level: { not: null } },
        ],
      },
    })
    let count = 0
    for (const u of dueUsers) {
      const newLevel = u.pending_level ?? u.current_level
      const newMgmtLevel = u.pending_management_level ?? u.current_management_level
      const wasPromote = newLevel > u.current_level || newMgmtLevel > u.current_management_level
      const wasDemote = newLevel < u.current_level || newMgmtLevel < u.current_management_level

      await this.prisma.user.update({
        where: { id: u.id },
        data: {
          current_level: newLevel,
          current_management_level: newMgmtLevel,
          last_promoted_at: wasPromote ? now : u.last_promoted_at,
          in_maintenance_until: wasPromote
            ? this.addMonths(now, 6)
            : wasDemote
              ? null
              : u.in_maintenance_until,
          pending_level: null,
          pending_management_level: null,
          pending_effective_at: null,
        },
      })

      // 把该 user 最近的一条 STAGED LevelHistory 标记 COMMITTED
      const staged = await this.prisma.levelHistory.findMany({
        where: { user_id: u.id, status: 'STAGED' },
        orderBy: { eval_at: 'desc' },
      })
      for (const h of staged) {
        await this.prisma.levelHistory.update({
          where: { id: h.id },
          data: { status: 'COMMITTED', effective_at: now },
        })
      }

      this.logger.log(
        `[L/M Commit] user=${u.id} (${u.name}) L${u.current_level}→${newLevel} M${u.current_management_level}→${newMgmtLevel} (${wasPromote ? 'PROMOTE' : wasDemote ? 'DEMOTE' : 'NOOP'})`,
      )
      count++
    }
    return count
  }

  /**
   * POST /api/admin/level/evaluate-all
   * 手动触发全量评估
   */
  async evaluateAll(asOf: Date = new Date(), trigger: 'CRON' | 'MANUAL' | 'NEW_TX' = 'MANUAL'): Promise<EvalResult[]> {
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, current_level: true, current_management_level: true },
    })
    const results: EvalResult[] = []
    for (const u of users) {
      const r = await this.evaluate(u.id, asOf, trigger)
      results.push(r)
    }
    return results
  }

  /**
   * POST /api/admin/level/evaluate/:userId
   * 单用户评估
   */
  async evaluate(userId: string, asOf: Date = new Date(), trigger: 'CRON' | 'MANUAL' | 'NEW_TX' = 'MANUAL'): Promise<EvalResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new Error(`员工 ${userId} 不存在`)

    // 1. rolling 6-month window
    const windowEnd = asOf
    const windowStart = new Date(asOf)
    windowStart.setMonth(windowStart.getMonth() - 6)
    const effectiveWindowStart = user.joined_at > windowStart ? user.joined_at : windowStart

    // 2. L 6m 业绩
    const txSum = await this.prisma.transaction.groupBy({
      by: ['product_type'],
      where: {
        user_id: userId,
        sold_at: { gte: effectiveWindowStart, lte: windowEnd },
        product_type: { in: ['HK', 'SG'] },
      },
      _sum: { std_premium: true },
    })
    let recent6mHK = 0
    let recent6mSG = 0
    for (const row of txSum) {
      const v = Number(row._sum.std_premium ?? 0)
      if (row.product_type === 'HK') recent6mHK = v
      if (row.product_type === 'SG') recent6mSG = v
    }

    // 3. M (招管穿透 2 级)
    const directRecruits = await this.prisma.user.findMany({
      where: { recruiter_id: userId },
      select: { id: true },
    })
    const grandRecruits = directRecruits.length
      ? await this.prisma.user.findMany({
          where: { recruiter_id: { in: directRecruits.map((r) => r.id) } },
          select: { id: true },
        })
      : []
    const allDescendantIds = [...directRecruits, ...grandRecruits].map((u) => u.id)

    let tree2LevelHK = 0
    let tree2LevelSG = 0
    if (allDescendantIds.length) {
      const treeTx = await this.prisma.transaction.groupBy({
        by: ['product_type'],
        where: {
          user_id: { in: allDescendantIds },
          sold_at: { gte: effectiveWindowStart, lte: windowEnd },
          product_type: { in: ['HK', 'SG'] },
        },
        _sum: { std_premium: true },
      })
      for (const row of treeTx) {
        const v = Number(row._sum.std_premium ?? 0)
        if (row.product_type === 'HK') tree2LevelHK = v
        if (row.product_type === 'SG') tree2LevelSG = v
      }
    }
    const tree2LevelTotal = tree2LevelHK + tree2LevelSG
    const directRecruitCount = directRecruits.length

    // 4. 算 target_level / target_mgmt_level
    const lPromoteHK = await this.configService.findOne('L_PROMOTE_HK').catch(() => null)
    const lPromoteSG = await this.configService.findOne('L_PROMOTE_SG').catch(() => null)
    const lCfgHK: any = lPromoteHK?.data?.value ?? { L2: 50000, L3: 100000 }
    const lCfgSG: any = lPromoteSG?.data?.value ?? { L2: 50000, L3: 100000 }
    const mPromote = await this.configService.findOne('M_PROMOTE').catch(() => null)
    const mCfg: any = mPromote?.data?.value ?? {
      M2: { directRecruits: 2, total6m: 200000 },
      M3: { directRecruits: 4, total6m: 400000 },
    }

    let targetLevel = 1
    if (recent6mHK >= lCfgHK.L3 || recent6mSG >= lCfgSG.L3) targetLevel = 3
    else if (recent6mHK >= lCfgHK.L2 || recent6mSG >= lCfgSG.L2) targetLevel = 2

    let targetMgmtLevel = 0
    if (directRecruitCount >= 2) targetMgmtLevel = 1
    if (directRecruitCount >= mCfg.M3.directRecruits && tree2LevelTotal >= mCfg.M3.total6m) targetMgmtLevel = 3
    else if (directRecruitCount >= mCfg.M2.directRecruits && tree2LevelTotal >= mCfg.M2.total6m) targetMgmtLevel = 2

    // 5. 维护期判断 (2026-08-16)
    const lRatio = Number((await this.configService.findOne('L_MAINTENANCE_THRESHOLD_RATIO').catch(() => null))?.data?.value ?? 0.5)
    const mRatio = Number((await this.configService.findOne('M_MAINTENANCE_THRESHOLD_RATIO').catch(() => null))?.data?.value ?? 0.5)
    const inMaintenance = user.in_maintenance_until ? user.in_maintenance_until > asOf : false
    const lMaintainThreshold = Math.max(lCfgHK.L2 ?? 50000, lCfgSG.L2 ?? 50000) * lRatio  // 默认 2.5万

    // 已有 pending demote (保守: 不被 promote 覆盖)
    const hasPendingDemote =
      (user.pending_level !== null && user.pending_level !== undefined && user.pending_level < user.current_level) ||
      (user.pending_management_level !== null && user.pending_management_level !== undefined && user.pending_management_level < user.current_management_level)

    // 6. 决策 final newLevel / newMgmtLevel
    let newLevel = user.current_level
    let newMgmtLevel = user.current_management_level
    let reason: 'PROMOTE' | 'DEMOTE' | 'MAINTAIN' = 'MAINTAIN'

    if (inMaintenance) {
      // 维护期内: 任一维持门槛不达 → 降 1 级 (只 L/M 各自判断一次)
      const lMaintainOk = recent6mHK >= lMaintainThreshold || recent6mSG >= lMaintainThreshold
      if (!lMaintainOk && user.current_level > 1) {
        newLevel = user.current_level - 1
        reason = 'DEMOTE'
      }
      const mMaintainDirectOk = directRecruitCount >= Math.max(1, Math.floor(mCfg.M2.directRecruits * mRatio))
      const mMaintainTotalOk = tree2LevelTotal >= (mCfg.M2.total6m ?? 200000) * mRatio
      if (!(mMaintainDirectOk && mMaintainTotalOk) && user.current_management_level > 0) {
        newMgmtLevel = Math.max(0, user.current_management_level - 1)
        reason = 'DEMOTE'
      }
    } else if (!hasPendingDemote) {
      // 无维护期: 只升级不降级 (用户原话: 降级只在维护期内触发)
      if (targetLevel > user.current_level) { newLevel = targetLevel; reason = 'PROMOTE' }
      if (targetMgmtLevel > user.current_management_level) { newMgmtLevel = targetMgmtLevel; reason = 'PROMOTE' }
    }

    // 7. 写 pending (次月 1 号)
    const promoteNextMonthRaw = (await this.configService.findOne('PROMOTE_NEXT_MONTH').catch(() => null))?.data?.value
    const promoteNextMonth = promoteNextMonthRaw === undefined ? 1 : Number(promoteNextMonthRaw)
    let pendingLevel: number | null = null
    let pendingMgmtLevel: number | null = null
    let effectiveAt: Date | null = null

    if (newLevel !== user.current_level || newMgmtLevel !== user.current_management_level) {
      if (promoteNextMonth) {
        const nextMonth1st = this.addMonths(asOf, 1)
        nextMonth1st.setDate(1)
        nextMonth1st.setHours(0, 0, 0, 0)
        // 只有实际变化的维度才记 pending (避免 false pending)
        pendingLevel = (newLevel !== user.current_level) ? newLevel : null
        pendingMgmtLevel = (newMgmtLevel !== user.current_management_level) ? newMgmtLevel : null
        effectiveAt = nextMonth1st
      } else {
        // 立即生效 (legacy 模式)
        await this.prisma.user.update({
          where: { id: userId },
          data: { current_level: newLevel, current_management_level: newMgmtLevel },
        })
      }
    }

    // 8. 写 pending 字段到 User
    if (pendingLevel !== null || pendingMgmtLevel !== null) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          pending_level: pendingLevel,
          pending_management_level: pendingMgmtLevel,
          pending_effective_at: effectiveAt,
        },
      })
    }

    // 9. 写 LevelHistory (STAGED, 立即生效的也写 STAGED + effective_at=eval_at)
    await this.prisma.levelHistory.create({
      data: {
        user_id: userId,
        level: newLevel,
        mgmt_level: newMgmtLevel,
        eval_at: asOf,
        effective_at: effectiveAt,
        window_start: effectiveWindowStart,
        window_end: windowEnd,
        reason,
        trigger,
        status: 'STAGED',
      },
    })

    return {
      user_id: userId,
      old_level: user.current_level,
      new_level: newLevel,
      old_mgmt_level: user.current_management_level,
      new_mgmt_level: newMgmtLevel,
      reason,
      trigger,
      pending_level: pendingLevel,
      pending_management_level: pendingMgmtLevel,
      pending_effective_at: effectiveAt,
      in_maintenance_until: user.in_maintenance_until,
      window_start: effectiveWindowStart,
      window_end: windowEnd,
      context: {
        recent_6m_HK: recent6mHK,
        recent_6m_SG: recent6mSG,
        direct_recruits: directRecruitCount,
        tree_2level_total_6m: tree2LevelTotal,
        tree_2level_HK_6m: tree2LevelHK,
        tree_2level_SG_6m: tree2LevelSG,
      },
    }
  }

  private addMonths(d: Date, m: number): Date {
    const r = new Date(d)
    r.setMonth(r.getMonth() + m)
    return r
  }

  /**
   * GET /api/admin/level/summary
   * 全员等级分布汇总
   */
  async getSummary() {
    const [byL, byM, pendingCount] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['current_level'],
        where: { status: 'ACTIVE' },
        _count: { id: true },
      }),
      this.prisma.user.groupBy({
        by: ['current_management_level'],
        where: { status: 'ACTIVE' },
        _count: { id: true },
      }),
      this.prisma.user.count({
        where: {
          status: 'ACTIVE',
          OR: [{ pending_level: { not: null } }, { pending_management_level: { not: null } }],
        },
      }),
    ])
    return {
      success: true,
      data: {
        by_level: byL.map((b) => ({ level: b.current_level, count: b._count.id })),
        by_management_level: byM.map((b) => ({ level: b.current_management_level, count: b._count.id })),
        pending_count: pendingCount,
      },
    }
  }

  /**
   * GET /api/admin/level/pending
   * 列出所有有 pending 等级变更的 user
   */
  async getPendingUsers() {
    const users = await this.prisma.user.findMany({
      where: {
        OR: [{ pending_level: { not: null } }, { pending_management_level: { not: null } }],
      },
      select: {
        id: true,
        name: true,
        email: true,
        current_level: true,
        current_management_level: true,
        pending_level: true,
        pending_management_level: true,
        pending_effective_at: true,
        last_promoted_at: true,
        in_maintenance_until: true,
      },
      orderBy: { pending_effective_at: 'asc' },
    })
    return { success: true, data: users }
  }

  /**
   * POST /api/admin/level/cancel-pending/:userId
   * 撤回 user 的 pending 变更 (admin 操作, 测试用)
   */
  async cancelPending(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new Error(`员工 ${userId} 不存在`)
    await this.prisma.user.update({
      where: { id: userId },
      data: { pending_level: null, pending_management_level: null, pending_effective_at: null },
    })
    // 标记最近的 STAGED LevelHistory 为 CANCELLED
    const staged = await this.prisma.levelHistory.findMany({
      where: { user_id: userId, status: 'STAGED' },
      orderBy: { eval_at: 'desc' },
    })
    for (const h of staged) {
      await this.prisma.levelHistory.update({ where: { id: h.id }, data: { status: 'CANCELLED' } })
    }
    this.logger.log(`[L/M Cancel] user=${userId} 撤回 pending, 影响 ${staged.length} 条 STAGED history`)
    return { success: true, cancelled_history_count: staged.length }
  }
}