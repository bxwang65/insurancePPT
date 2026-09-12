import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { LevelService } from '../level/level.service'
import { CreateTransactionDto, UpdateTransactionDto, TransactionQueryDto } from './dto/create-transaction.dto'

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly levelService: LevelService,
  ) {}

  /**
   * 计算 HK/SG 标保: annual × years / 5 (5年等效年缴归一)
   */
  private computeStdPremium(annual: number | null | undefined, years: number | null | undefined): number | null {
    if (annual == null || years == null) return null
    return Math.round((annual * years / 5) * 100) / 100
  }

  /**
   * POST /api/admin/transactions
   * admin 录入业绩流水 (HK/SG/ART 共表)
   */
  async create(dto: CreateTransactionDto, recordedBy: string, adminAuthHeader: string = '') {
    // 校验用户存在
    const user = await this.prisma.user.findUnique({ where: { id: dto.user_id } })
    if (!user) throw new BadRequestException(`员工 ${dto.user_id} 不存在`)

    // 校验: HK/SG 必须有 annual + years; HK 还必须有 4 个产品识别字段
    if (dto.product_type === 'HK' || dto.product_type === 'SG') {
      if (dto.annual_premium == null || dto.payment_years == null) {
        throw new BadRequestException('HK/SG 必填 annual_premium + payment_years')
      }
    }
    if (dto.product_type === 'HK') {
      // 2026-08-16: HK 必填 hk_company / hk_code / hk_plan / hk_term
      if (!dto.hk_company || !dto.hk_code || !dto.hk_plan || dto.hk_term == null) {
        throw new BadRequestException('HK 必填 hk_company + hk_code + hk_plan + hk_term')
      }
    }
    if (dto.product_type === 'ART_MODERN' || dto.product_type === 'ART_CONTEMP') {
      if (!dto.artist || !dto.work_title || dto.sale_price == null) {
        throw new BadRequestException('ART 必填 artist + work_title + sale_price')
      }
    }

    const stdPremium = this.computeStdPremium(dto.annual_premium, dto.payment_years)

    // 2026-08-16: HK 自动调 /api/rates/lookup 算完整佣金明细 (单源真相, 防客户端篡改)
    //   - 内部 fetch insurance-ppt:80, 转发 admin 的 JWT
    //   - 失败降级: commission_amount=null, save 仍成功 (warn log)
    //   - 用 /lookup 而非 /preview 因为要存完整明细 (y1/y2/add/renew/berlue),
    //     管理员 UI 业绩录入列表要按分项展示
    let commissionAmount: number | null = null
    let commissionBreakdown: string | null = null
    // 2026-08-16: 客户合格投资人状态 (默认 pi 是保守假设, 实际业务里 PI/NPI 由客户决定)
    const investor: 'pi' | 'npi' = dto.investor ?? 'pi'
    if (
      dto.product_type === 'HK'
      && dto.hk_company && dto.hk_code && dto.hk_plan && dto.hk_term != null
      && dto.annual_premium && dto.annual_premium > 0
    ) {
      const result = await this.fetchHkxLookup({
        company: dto.hk_company,
        code: dto.hk_code,
        term: dto.hk_term,
        premium: dto.annual_premium,
        adminAuthHeader,
        investor,  // 2026-08-16: 由 dto.investor 控制, 走 PI 或 NPI 费率表
      })
      if (result) {
        commissionAmount = result.total_usd
        commissionBreakdown = JSON.stringify({
          source: 'lookup',
          total_usd: result.total_usd,
          points: result.points,
          plan: result.plan,
          is_activity: result.is_activity,
          activity_deadline: result.activity_deadline,
          investor: result.investor,  // 2026-08-16: 由 dto.investor 决定 (pi/npi)
          level: result.level,
          // 完整明细 — admin 列表展示分项
          y1_usd: result.y1_usd,
          y2_usd: result.y2_usd,
          y3_usd: result.y3_usd,
          y4_usd: result.y4_usd,
          y5_usd: result.y5_usd,
          add_usd: result.add_usd,
          renew_usd: result.renew_usd,
          direct_usd: result.direct_usd,
          indirect_usd: result.indirect_usd,
          as_of: new Date().toISOString(),
        })
      }
    }

    const tx = await this.prisma.transaction.create({
      data: {
        user_id: dto.user_id,
        product_type: dto.product_type,
        annual_premium: dto.product_type === 'HK' || dto.product_type === 'SG' ? dto.annual_premium : null,
        payment_years: dto.product_type === 'HK' || dto.product_type === 'SG' ? dto.payment_years : null,
        std_premium: stdPremium ? String(stdPremium) : null,
        policy_no: dto.policy_no ?? null,
        artist: dto.artist ?? null,
        work_title: dto.work_title ?? null,
        sale_price: dto.product_type === 'ART_MODERN' || dto.product_type === 'ART_CONTEMP' ? dto.sale_price : null,
        currency: dto.currency ?? 'RMB',
        sold_at: new Date(dto.sold_at),
        recorded_by: recordedBy,
        // 2026-08-16: HK 产品识别 + 自动算佣金
        hk_company: dto.product_type === 'HK' ? dto.hk_company ?? null : null,
        hk_code: dto.product_type === 'HK' ? dto.hk_code ?? null : null,
        hk_plan: dto.product_type === 'HK' ? dto.hk_plan ?? null : null,
        hk_term: dto.product_type === 'HK' && dto.hk_term != null ? dto.hk_term : null,
        commission_amount: commissionAmount != null ? String(commissionAmount) : null,
        commission_breakdown: commissionBreakdown,
      },
    })

    // 2026-08-16: 录入 HK 交易后, 自动算上下两级招募人的伯乐
    //   - seller.recruiter_id 不存在 → 没有直接招募人 → 直接伯乐归公司, 不发 (用户原话)
    //   - directUpline.recruiter_id 不存在 → 没有间接招募人 → 间接伯乐归公司, 不发
    //   - 走 /api/rates/lookup 取 beneficiary 的 direct_pct / indirect_pct × annual_premium
    //   - investor 默认 'pi' (与个别保险公司保守假设一致), level = beneficiary.current_level
    //   - 失败降级: 静默 (不阻塞 save), warn log
    if (dto.product_type === 'HK' && commissionAmount != null) {
      await this.computeAndStoreBerlue(tx.id, dto.hk_company!, dto.hk_code!, dto.hk_plan!, dto.hk_term!, dto.annual_premium!, adminAuthHeader, investor).catch((e) => {
        this.logger.warn(`[transactions/berlue] 计算失败 tx=${tx.id}: ${e?.message ?? e}`)
      })
      // 2026-08-16: 管理奖 (极差) — 招管分离第2棵树, 走 manager_id 链
      await this.computeAndStoreManagement(tx.id, dto.hk_company!, dto.hk_code!, dto.hk_plan!, dto.hk_term!, dto.annual_premium!, adminAuthHeader, investor).catch((e) => {
        this.logger.warn(`[transactions/management] 计算失败 tx=${tx.id}: ${e?.message ?? e}`)
      })
    }

    // 录入交易后自动重评 L/M 等级 — 让用户端的徽章和推管树立即反映新业绩
    try {
      const evalResult = await this.levelService.evaluate(dto.user_id, new Date(), 'NEW_TX')
      if (evalResult.reason !== 'MAINTAIN') {
        this.logger.log(
          `[L/M Auto Eval] user=${dto.user_id} L${evalResult.old_level}→${evalResult.new_level} ` +
          `M${evalResult.old_mgmt_level}→${evalResult.new_mgmt_level} (${evalResult.reason})`,
        )
      }
      // 2026-08-16: Phase 7 — 如果有 pending, 额外 log 让 admin 后台能看到 staged 变更
      if (evalResult.pending_level !== null || evalResult.pending_management_level !== null) {
        this.logger.log(
          `[L/M Stage] user=${dto.user_id} pending L${evalResult.pending_level} M${evalResult.pending_management_level} ` +
          `@ ${evalResult.pending_effective_at?.toISOString()} (in_maintenance_until=${evalResult.in_maintenance_until?.toISOString() ?? 'null'})`,
        )
      }
    } catch (e: any) {
      // 评估失败不影响交易创建
      this.logger.warn(`[L/M Auto Eval] user=${dto.user_id} 评估失败: ${e?.message ?? e}`)
    }

    return {
      success: true,
      data: this.formatTx(tx),
    }
  }

  /**
   * GET /api/admin/transactions?user_id=&product_type=&from=&to=&page=&limit=
   */
  async findAll(query: TransactionQueryDto) {
    const { user_id, product_type, from, to, page = 1, limit = 20 } = query
    const skip = (page - 1) * limit

    const where: any = {}
    if (user_id) where.user_id = user_id
    if (product_type) where.product_type = product_type
    if (from || to) {
      where.sold_at = {}
      if (from) where.sold_at.gte = new Date(from)
      if (to) where.sold_at.lte = new Date(to)
    }

    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { sold_at: 'desc' },
        include: { user: { select: { id: true, name: true } } },
      }),
      this.prisma.transaction.count({ where }),
    ])

    // 2026-08-16: 汇总 (按 product_type 分组) — 用同 where 但不分页, 给 admin 看总览
    //   commission null 不计入 sum (老数据 + 降级未算出来的)
    //   ART 无 commission, 改算总成交价 + 件数, 给 admin 看
    const summaryRaw = await this.prisma.transaction.groupBy({
      by: ['product_type'],
      where,
      _count: { id: true },
      _sum: {
        std_premium: true,
        commission_amount: true,
        annual_premium: true,
        sale_price: true,
      },
    })

    const breakdown = summaryRaw
      .map((r) => ({
        product_type: r.product_type,
        count: r._count.id,
        std_premium: r._sum.std_premium != null ? Number(r._sum.std_premium) : 0,
        annual_premium: r._sum.annual_premium != null ? Number(r._sum.annual_premium) : 0,
        commission_amount: r._sum.commission_amount != null ? Number(r._sum.commission_amount) : 0,
        sale_price: r._sum.sale_price != null ? Number(r._sum.sale_price) : 0,
      }))
      .sort((a, b) => a.product_type.localeCompare(b.product_type))

    // 全局合计 (跨产品类型)
    const totals = breakdown.reduce(
      (acc, r) => ({
        count: acc.count + r.count,
        std_premium: acc.std_premium + r.std_premium,
        annual_premium: acc.annual_premium + r.annual_premium,
        commission_amount: acc.commission_amount + r.commission_amount,
        sale_price: acc.sale_price + r.sale_price,
      }),
      { count: 0, std_premium: 0, annual_premium: 0, commission_amount: 0, sale_price: 0 },
    )
    // 保留 2 位小数
    const round2 = (n: number) => Math.round(n * 100) / 100
    totals.std_premium = round2(totals.std_premium)
    totals.annual_premium = round2(totals.annual_premium)
    totals.commission_amount = round2(totals.commission_amount)
    totals.sale_price = round2(totals.sale_price)
    for (const r of breakdown) {
      r.std_premium = round2(r.std_premium)
      r.annual_premium = round2(r.annual_premium)
      r.commission_amount = round2(r.commission_amount)
      r.sale_price = round2(r.sale_price)
    }

    return {
      success: true,
      data: {
        items: items.map((t) => ({ ...this.formatTx(t), user_name: t.user.name })),
        total,
        page,
        limit,
        summary: {
          totals,
          by_product_type: breakdown,
        },
      },
    }
  }

  /**
   * PATCH /api/admin/transactions/:id
   */
  async update(id: string, dto: UpdateTransactionDto) {
    const tx = await this.prisma.transaction.findUnique({ where: { id } })
    if (!tx) throw new NotFoundException(`交易 ${id} 不存在`)

    const data: any = {}
    if (dto.annual_premium !== undefined) data.annual_premium = dto.annual_premium
    if (dto.payment_years !== undefined) data.payment_years = dto.payment_years
    if (dto.policy_no !== undefined) data.policy_no = dto.policy_no
    if (dto.artist !== undefined) data.artist = dto.artist
    if (dto.work_title !== undefined) data.work_title = dto.work_title
    if (dto.sale_price !== undefined) data.sale_price = dto.sale_price
    if (dto.currency !== undefined) data.currency = dto.currency
    if (dto.sold_at !== undefined) data.sold_at = new Date(dto.sold_at)
    if (dto.commission_amount !== undefined) data.commission_amount = dto.commission_amount
    if (dto.commission_breakdown !== undefined) data.commission_breakdown = dto.commission_breakdown
    // 2026-08-16: HK 产品识别 PATCH (UI 锁定但 API 允许)
    if (dto.hk_company !== undefined) data.hk_company = dto.hk_company
    if (dto.hk_code !== undefined) data.hk_code = dto.hk_code
    if (dto.hk_plan !== undefined) data.hk_plan = dto.hk_plan
    if (dto.hk_term !== undefined) data.hk_term = dto.hk_term

    // 重算 std_premium
    if (dto.annual_premium !== undefined || dto.payment_years !== undefined) {
      const annual = dto.annual_premium ?? Number(tx.annual_premium)
      const years = dto.payment_years ?? tx.payment_years
      const std = this.computeStdPremium(annual, years)
      data.std_premium = std ? String(std) : null
    }

    const updated = await this.prisma.transaction.update({ where: { id }, data })

    // 修改业绩后也触发自动重评 (M 树只读依赖 recruits, 但 L 受 std_premium 影响)
    try {
      const evalResult = await this.levelService.evaluate(tx.user_id, new Date(), 'NEW_TX')
      if (evalResult.reason !== 'MAINTAIN') {
        this.logger.log(
          `[L/M Auto Eval] user=${tx.user_id} L${evalResult.old_level}→${evalResult.new_level} ` +
          `M${evalResult.old_mgmt_level}→${evalResult.new_mgmt_level} (${evalResult.reason})`,
        )
      }
    } catch (e: any) {
      this.logger.warn(`[L/M Auto Eval] user=${tx.user_id} 评估失败: ${e?.message ?? e}`)
    }

    return { success: true, data: this.formatTx(updated) }
  }

  /**
   * DELETE /api/admin/transactions/:id
   */
  async remove(id: string) {
    const tx = await this.prisma.transaction.findUnique({ where: { id } })
    if (!tx) throw new NotFoundException(`交易 ${id} 不存在`)
    // 2026-09-01: 先删下游 Berlue/Management 记录, 避免产生孤儿行导致 Prisma
    //   'Field transaction is required to return data, got null' 抛错
    await this.prisma.$transaction([
      this.prisma.transactionBerlue.deleteMany({ where: { transaction_id: id } }),
      this.prisma.transactionManagement.deleteMany({ where: { transaction_id: id } }),
      this.prisma.transaction.delete({ where: { id } }),
    ])
    return { success: true, data: { id } }
  }

  private formatTx(t: any) {
    return {
      id: t.id,
      user_id: t.user_id,
      product_type: t.product_type,
      annual_premium: t.annual_premium != null ? Number(t.annual_premium) : null,
      payment_years: t.payment_years,
      std_premium: t.std_premium != null ? Number(t.std_premium) : null,
      policy_no: t.policy_no,
      artist: t.artist,
      work_title: t.work_title,
      sale_price: t.sale_price != null ? Number(t.sale_price) : null,
      currency: t.currency,
      sold_at: t.sold_at.toISOString(),
      recorded_by: t.recorded_by,
      commission_amount: t.commission_amount != null ? Number(t.commission_amount) : null,
      commission_breakdown: t.commission_breakdown,
      // 2026-08-16: HK 产品识别 (HK 才有值, 其他类型 null)
      hk_company: t.hk_company ?? null,
      hk_code: t.hk_code ?? null,
      hk_plan: t.hk_plan ?? null,
      hk_term: t.hk_term ?? null,
      created_at: t.created_at.toISOString(),
    }
  }

  /**
   * 2026-08-16: 算并落库上下两级伯乐
   *   - 找 seller.recruiter_id (直接招募人)
   *     - 不存在 → 直接伯乐归公司, return (用户原话)
   *   - 调 /api/rates/lookup 取 direct_pct / indirect_pct (按 beneficiary 的 level/investor)
   *   - 找 directUpline.recruiter_id (间接招募人)
   *     - 不存在 → 间接伯乐归公司, 跳过 indirect
   *   - 写 TransactionBerlue (direct + indirect)
   */
  private async computeAndStoreBerlue(
    txId: string,
    company: string,
    code: string,
    plan: string,
    term: number,
    annualPremium: number,
    adminAuthHeader: string,
    investor: 'pi' | 'npi' = 'pi',  // 2026-08-16: 由 dto.investor 传入
  ): Promise<void> {
    // 1. 找 seller
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } })
    if (!tx) return
    const seller = await this.prisma.user.findUnique({ where: { id: tx.user_id } })
    if (!seller) return

    // 2. 没有直接招募人 → 伯乐归公司, return
    if (!seller.recruiter_id) {
      this.logger.log(`[transactions/berlue] tx=${txId} seller 无 recruiter, 直接伯乐归公司`)
      return
    }
    const directUpline = await this.prisma.user.findUnique({ where: { id: seller.recruiter_id } })
    if (!directUpline) return

    // 3. 调 lookup 取 beneficiary 的 direct_pct / indirect_pct
    const directLevel = `L${Math.max(1, Math.min(3, directUpline.current_level || 1))}`
    const lookup = await this.fetchHkxLookup({
      company,
      code,
      term,
      premium: annualPremium,
      adminAuthHeader,
      level: directLevel,
      investor,  // 2026-08-16: 用 dto.investor 而非硬编码 pi
    })
    if (!lookup) {
      this.logger.warn(`[transactions/berlue] tx=${txId} lookup 失败, 跳过伯乐`)
      return
    }

    // 4. 写直接伯乐
    if (lookup.direct_usd > 0) {
      await this.prisma.transactionBerlue.create({
        data: {
          transaction_id: txId,
          beneficiary_id: directUpline.id,
          type: 'direct',
          amount: String(lookup.direct_usd),
          direct_pct: lookup.direct_pct,
          indirect_pct: lookup.indirect_pct,
          investor,  // 2026-08-16: 持久化实际算的 investor
          level: directLevel,
        },
      })
      this.logger.log(
        `[transactions/berlue] tx=${txId} direct 伯乐 ${directUpline.name}(${directUpline.id}) +$${lookup.direct_usd} (${lookup.direct_pct.toFixed(2)}% × $${annualPremium})`,
      )
    }

    // 5. 间接招募人
    if (!directUpline.recruiter_id) {
      this.logger.log(`[transactions/berlue] tx=${txId} directUpline 无 recruiter, 间接伯乐归公司`)
      return
    }
    const indirectUpline = await this.prisma.user.findUnique({ where: { id: directUpline.recruiter_id } })
    if (!indirectUpline) return

    const indirectLevel = `L${Math.max(1, Math.min(3, indirectUpline.current_level || 1))}`
    // 同公司/产品/年期, 只是 beneficiary 的 level 不同 → 再查一次
    const indirectLookup = await this.fetchHkxLookup({
      company,
      code,
      term,
      premium: annualPremium,
      adminAuthHeader,
      level: indirectLevel,
      investor,  // 2026-08-16: 同上
    })
    if (!indirectLookup || indirectLookup.indirect_usd <= 0) return

    await this.prisma.transactionBerlue.create({
      data: {
        transaction_id: txId,
        beneficiary_id: indirectUpline.id,
        type: 'indirect',
        amount: String(indirectLookup.indirect_usd),
        direct_pct: indirectLookup.direct_pct,
        indirect_pct: indirectLookup.indirect_pct,
        investor,  // 2026-08-16: 同上
        level: indirectLevel,
      },
    })
    this.logger.log(
      `[transactions/berlue] tx=${txId} indirect 伯乐 ${indirectUpline.name}(${indirectUpline.id}) +$${indirectLookup.indirect_usd} (${indirectLookup.indirect_pct.toFixed(2)}% × $${annualPremium})`,
    )
  }

  /**
   * 2026-08-16: 算并落库招管分离第2棵树的管理奖 (极差)
   *   - 触发: HK 交易录入 (L1/L2/L3 卖单都触发)
   *   - 走 seller.manager_id 链, 上级 manager 拿 (manager.y1_pct - L1.y1_pct) × annual_premium
   *   - L1 manager → skip (无 spread, 用户原话 "管理人是L2/L3")
   *   - 链尾 (manager_id=null) → 归公司, 不写行, log warn
   *   - L1 baseline 只查 1 次 (chain 内共用)
   *   - MAX_DEPTH=5 防循环
   */
  private async computeAndStoreManagement(
    txId: string,
    company: string,
    code: string,
    plan: string,
    term: number,
    annualPremium: number,
    adminAuthHeader: string,
    investor: 'pi' | 'npi' = 'pi',  // 2026-08-16: 由 dto.investor 传入
  ): Promise<void> {
    // 1. 找 seller
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } })
    if (!tx) return
    const seller = await this.prisma.user.findUnique({ where: { id: tx.user_id } })
    if (!seller) return

    // 2. L1 baseline (chain 内共用, 只查 1 次)
    const l1Lookup = await this.fetchHkxLookup({
      company, code, term, premium: annualPremium,
      adminAuthHeader, level: 'L1', investor,  // 2026-08-16: 用 dto.investor
    })
    if (!l1Lookup) {
      this.logger.warn(`[transactions/management] tx=${txId} L1 baseline lookup 失败, 跳过管理奖`)
      return
    }
    // 2026-08-16: "首年的差值" = 首年佣金率. 用 total_pct (PI: 单一年化率, NPI: y1_pct + add_pct 都包含).
    //   用 y1_pct 对 NPI 永远是常数 (L1/L2/L3 都是 5.09%), 极差 0 (实测).
    const l1FirstYearPct = l1Lookup.total_pct

    // 3. 走 manager 链
    let current = seller
    let depth = 1
    const MAX_DEPTH = 5  // 安全网防循环
    while (depth <= MAX_DEPTH && current.manager_id) {
      const manager = await this.prisma.user.findUnique({ where: { id: current.manager_id } })
      if (!manager) break

      const mgrLevel = `L${Math.max(1, Math.min(3, manager.current_level || 1))}`

      // L1 manager skip (无 spread)
      if (mgrLevel === 'L1') {
        this.logger.log(`[transactions/management] tx=${txId} manager=${manager.name} 是 L1, 跳过 (无 spread)`)
        break
      }

      // 查 manager level 的首年佣金率
      const mgrLookup = await this.fetchHkxLookup({
        company, code, term, premium: annualPremium,
        adminAuthHeader, level: mgrLevel, investor,  // 2026-08-16: 同上
      })
      if (!mgrLookup) {
        this.logger.warn(`[transactions/management] tx=${txId} manager ${mgrLevel} lookup 失败, 跳过该层`)
        current = manager
        depth++
        continue
      }

      const mgrFirstYearPct = mgrLookup.total_pct
      // 极差 = (mgr - L1), spread USD = (spread / 100) × premium
      const spreadPct = mgrFirstYearPct - l1FirstYearPct
      const amount = (spreadPct / 100) * annualPremium
      if (amount > 0) {
        await this.prisma.transactionManagement.create({
          data: {
            transaction_id: txId,
            beneficiary_id: manager.id,
            chain_depth: depth,
            amount: String(amount.toFixed(2)),
            manager_y1_pct: mgrFirstYearPct,  // 2026-08-16: 实际存"首年佣金率", PI=total_pct, NPI=y1_pct
            l1_y1_pct: l1FirstYearPct,
            investor,  // 2026-08-16: 用 dto.investor
            level: mgrLevel,
          },
        })
        this.logger.log(
          `[transactions/management] tx=${txId} ${mgrLevel}管理奖 ${manager.name}(${manager.id}) ` +
          `+$${amount.toFixed(2)} (差值 ${spreadPct.toFixed(2)}% × $${annualPremium})`,
        )
      }

      current = manager
      depth++
    }

    // 4. 链尾 (current.manager_id 已 null 且未到 L1) → 归公司
    if (!current.manager_id) {
      this.logger.log(`[transactions/management] tx=${txId} manager 链尾 (${current.name} 无 manager), 剩余差值归公司`)
    }
    if (depth > MAX_DEPTH) {
      this.logger.warn(`[transactions/management] tx=${txId} chain > ${MAX_DEPTH} 强制截断, 防循环`)
    }
  }

  /**
   * 2026-08-16: 内部 fetch insurance-ppt 的 /api/rates/lookup
   *   - 用于 create HK 交易时自动算完整 commission 明细 (y1/y2/add/renew/berlue)
   *   - 复用 users.controller.ts:78 的 INSURANCE_PPT_URL + JWT 透传模式
   *   - 失败返回 null (degraded), service.create 写 commission=null 不阻塞 save
   *   - 用 /lookup 而非 /preview 因为需要明细分项 (admin 列表 UI 展示用)
   */
  private async fetchHkxLookup(args: {
    company: string
    code: string
    term: number
    premium: number
    adminAuthHeader: string
    level?: string  // 2026-08-16: 默认 L2; 算伯乐时用 beneficiary.current_level (L1/L2/L3)
    investor?: string  // 2026-08-16: 默认 'pi'; 暂未按 user 自定义
  }): Promise<{
    total_usd: number
    points: number
    plan: string
    is_activity: number
    activity_deadline: string | null
    investor: string
    level: string
    y1_usd: number
    y2_usd: number
    y3_usd: number
    y4_usd: number
    y5_usd: number
    add_usd: number
    renew_usd: number
    direct_usd: number
    indirect_usd: number
    direct_pct: number   // 2026-08-16: 算伯乐时要存 pct
    indirect_pct: number
    y1_pct: number
    y2_pct: number
    y3_pct: number
    y4_pct: number
    y5_pct: number
    add_pct: number
    total_pct: number
  } | null> {
    const url = process.env.INSURANCE_PPT_URL || 'http://insurance-ppt:80'
    try {
      const res = await fetch(`${url}/api/rates/lookup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(args.adminAuthHeader ? { Authorization: args.adminAuthHeader } : {}),
        },
        body: JSON.stringify({
          company: args.company,
          code: args.code,
          term: args.term,
          premium: args.premium,
          // 2026-08-16: investor 默认 pi (保守假设), 算伯乐时也用 pi — 同一公司同表, 仅 level 不同
          investor: args.investor ?? 'pi',
          // 2026-08-16: level 默认为 L2 (commission), 算伯乐时按 beneficiary 的实际 level
          level: args.level ?? 'L2',
        }),
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) {
        this.logger.warn(
          `[transactions/auto-commission] insurance-ppt /lookup ${res.status} ` +
          `(company=${args.company} code=${args.code} term=${args.term})`,
        )
        return null
      }
      const data = (await res.json()) as any
      if (typeof data?.total_usd !== 'number') {
        this.logger.warn(`[transactions/auto-commission] lookup 响应缺 total_usd: ${JSON.stringify(data).slice(0, 200)}`)
        return null
      }
      const num = (k: string, def = 0) => (typeof data?.[k] === 'number' ? data[k] : def)
      return {
        total_usd: data.total_usd,
        points: num('points'),
        plan: String(data.plan || ''),
        is_activity: num('is_activity'),
        activity_deadline: data.activity_deadline ?? null,
        investor: String(data.investor || 'pi'),
        level: String(data.level || 'L2'),
        y1_usd: num('y1_usd'),
        y2_usd: num('y2_usd'),
        y3_usd: num('y3_usd'),
        y4_usd: num('y4_usd'),
        y5_usd: num('y5_usd'),
        add_usd: num('add_usd'),
        renew_usd: num('renew_usd'),
        direct_usd: num('direct_usd'),
        indirect_usd: num('indirect_usd'),
        direct_pct: num('direct_pct'),
        indirect_pct: num('indirect_pct'),
        y1_pct: num('y1_pct'),
        y2_pct: num('y2_pct'),
        y3_pct: num('y3_pct'),
        y4_pct: num('y4_pct'),
        y5_pct: num('y5_pct'),
        add_pct: num('add_pct'),
        total_pct: num('total_pct'),
      }
    } catch (e: any) {
      this.logger.warn(
        `[transactions/auto-commission] insurance-ppt down: ${e?.message ?? e} ` +
        `(company=${args.company} code=${args.code} term=${args.term})`,
      )
      return null
    }
  }
}