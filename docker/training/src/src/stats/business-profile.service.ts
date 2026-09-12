import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

/**
 * 2026-08-14: 个人业务画像 (L/M 进度 + 招管树 + 月度 trend)
 *   共享服务, 供:
 *   - student.controller.getMyBusiness (学员自助)
 *   - stats.controller.getStudentBusiness (admin 查看任意学员)
 */
@Injectable()
export class BusinessProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getStudentBusiness(userId: string, range: 'month' | 'quarter' | 'year' = 'month') {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        recruiter: { select: { id: true, name: true, avatar_url: true } },
        manager: { select: { id: true, name: true, avatar_url: true } },
      },
    })
    if (!me) return null

    const now = new Date()
    const sixMonthsAgo = new Date(now)
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    // 月度 trend (近 6 月, HK+SG 标保, 按月聚合)
    const monthlyTx = await this.prisma.transaction.findMany({
      where: {
        user_id: userId,
        sold_at: { gte: sixMonthsAgo, lte: now },
        product_type: { in: ['HK', 'SG'] },
      },
      select: { sold_at: true, std_premium: true, product_type: true },
    })
    const monthMap = new Map<string, { HK: number; SG: number }>()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthMap.set(key, { HK: 0, SG: 0 })
    }
    for (const t of monthlyTx) {
      const d = new Date(Number(t.sold_at))
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const m = monthMap.get(key)
      if (!m) continue
      if (t.product_type === 'HK') m.HK += Number(t.std_premium ?? 0)
      else if (t.product_type === 'SG') m.SG += Number(t.std_premium ?? 0)
    }
    const monthlyTrend = Array.from(monthMap.entries()).map(([month, v]) => ({ month, HK: v.HK, SG: v.SG }))

    let recent6mHK = 0
    let recent6mSG = 0
    for (const v of monthMap.values()) {
      recent6mHK += v.HK
      recent6mSG += v.SG
    }

    // Config 阈值
    const [lPromoteHKRow, lPromoteSGRow, mPromoteRow] = await Promise.all([
      this.prisma.config.findUnique({ where: { key: 'L_PROMOTE_HK' } }).catch(() => null),
      this.prisma.config.findUnique({ where: { key: 'L_PROMOTE_SG' } }).catch(() => null),
      this.prisma.config.findUnique({ where: { key: 'M_PROMOTE' } }).catch(() => null),
    ])
    const lCfgHK: any = JSON.parse(lPromoteHKRow?.value ?? '{"L2":50000,"L3":100000}')
    const lCfgSG: any = JSON.parse(lPromoteSGRow?.value ?? '{"L2":50000,"L3":100000}')
    const mCfg: any = JSON.parse(mPromoteRow?.value ?? '{"M2":{"directRecruits":2,"total6m":200000},"M3":{"directRecruits":4,"total6m":400000}}')

    // L 进度
    let lProgress: any
    {
      const max6m = Math.max(recent6mHK, recent6mSG)
      if (me.current_level >= 3) {
        lProgress = { current: 'L3', next: null, threshold: null, current_sales: max6m, progress_pct: 100, reached: true }
      } else {
        const nextLevel = me.current_level === 1 ? 'L2' : 'L3'
        const threshold = me.current_level === 1
          ? Math.max(Number(lCfgHK.L2 ?? 50000), Number(lCfgSG.L2 ?? 50000))
          : Math.max(Number(lCfgHK.L3 ?? 100000), Number(lCfgSG.L3 ?? 100000))
        const progress = threshold > 0 ? Math.min(100, Math.round((max6m / threshold) * 100)) : 0
        lProgress = {
          current: `L${me.current_level}`,
          next: nextLevel,
          threshold,
          current_sales: max6m,
          progress_pct: progress,
          reached: progress >= 100,
        }
      }
    }

    // M 进度: 直接招募人数 + 6m 树标保
    let mProgress: any
    let recruited: any[] = []
    const recruiterChain: Array<{ id: string; name: string; avatar_url: string | null }> = []
    const managerChain: Array<{ id: string; name: string; avatar_url: string | null }> = []
    {
      const directs = await this.prisma.user.findMany({
        where: { recruiter_id: userId },
        select: { id: true, name: true, current_level: true, sales_amount: true, avatar_url: true },
      })
      const directCount = directs.length
      const grandIds = directs.length
        ? (await this.prisma.user.findMany({
            where: { recruiter_id: { in: directs.map((d) => d.id) } },
            select: { id: true },
          })).map((x) => x.id)
        : []
      const treeIds = [...directs.map((d) => d.id), ...grandIds]
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
        for (const t of txs) tree6m += Number(t._sum.std_premium ?? 0)
      }
      if (me.current_management_level >= 3) {
        mProgress = { current: 'M3', next: null, direct_recruits: directCount, tree_6m_total: tree6m, progress_pct: 100, reached: true }
      } else {
        let nextThreshold: { directRecruits: number; total6m: number }
        let nextName = ''
        if (me.current_management_level === 0) {
          nextThreshold = { directRecruits: 2, total6m: 0 }
          nextName = 'M1'
        } else if (me.current_management_level === 1) {
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
        const overallPct = nextName === 'M1'
          ? directsPct
          : Math.round((directsPct + treePct) / 2)
        mProgress = {
          current: me.current_management_level === 0 ? 'M0' : `M${me.current_management_level}`,
          next: nextName,
          threshold: nextThreshold,
          direct_recruits: directCount,
          tree_6m_total: tree6m,
          progress_pct: overallPct,
          reached: overallPct >= 100,
        }
      }

      recruited = directs.map((d) => ({
        id: d.id,
        name: d.name,
        avatar_url: d.avatar_url,
        current_level: d.current_level,
        sales_amount: Number(d.sales_amount),
      }))

      // 招我的人链
      let cur = me.recruiter
      let depth = 0
      while (cur && depth < 5) {
        recruiterChain.push({ id: cur.id, name: cur.name, avatar_url: cur.avatar_url })
        const next = await this.prisma.user.findUnique({
          where: { id: cur.id },
          select: { recruiter: { select: { id: true, name: true, avatar_url: true } } },
        })
        cur = next?.recruiter ?? null
        depth++
      }

      // 管我的主管链
      let mcur = me.manager
      let mdepth = 0
      while (mcur && mdepth < 5) {
        managerChain.push({ id: mcur.id, name: mcur.name, avatar_url: mcur.avatar_url })
        const next = await this.prisma.user.findUnique({
          where: { id: mcur.id },
          select: { manager: { select: { id: true, name: true, avatar_url: true } } },
        })
        mcur = next?.manager ?? null
        mdepth++
      }
    }

    return {
      range,
      user: {
        id: me.id,
        name: me.name,
        avatar_url: me.avatar_url,
        current_level: me.current_level,
        current_management_level: me.current_management_level,
      },
      l_progress: lProgress,
      m_progress: mProgress,
      monthly_trend: monthlyTrend,
      recruited,
      recruiter_chain: recruiterChain,
      manager_chain: managerChain,
      recent_6m: { HK: recent6mHK, SG: recent6mSG },
    }
  }
}