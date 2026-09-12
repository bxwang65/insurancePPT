import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { LevelService } from './level.service'
import { AdminGuard } from '../auth/guards/admin.guard'

@ApiTags('管理员 - 等级评估 (L/M)')
@Controller('admin/level')
export class LevelController {
  constructor(private readonly levelService: LevelService) {}

  @Get('summary')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '全员等级分布汇总 (含 pending_count)' })
  async getSummary() {
    return this.levelService.getSummary()
  }

  @Post('evaluate-all')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '手动触发全量评估 (rolling 6-month + 维护期)' })
  async evaluateAll() {
    const results = await this.levelService.evaluateAll(new Date(), 'MANUAL')
    return {
      success: true,
      data: {
        count: results.length,
        promoted: results.filter((r) => r.reason === 'PROMOTE').length,
        demoted: results.filter((r) => r.reason === 'DEMOTE').length,
        maintained: results.filter((r) => r.reason === 'MAINTAIN').length,
        pending_count: results.filter((r) => r.pending_level !== null || r.pending_management_level !== null).length,
        results: results.map((r) => ({
          user_id: r.user_id,
          old_level: r.old_level,
          new_level: r.new_level,
          old_mgmt_level: r.old_mgmt_level,
          new_mgmt_level: r.new_mgmt_level,
          reason: r.reason,
          pending_level: r.pending_level,
          pending_management_level: r.pending_management_level,
          pending_effective_at: r.pending_effective_at,
          in_maintenance_until: r.in_maintenance_until,
          context: r.context,
        })),
      },
    }
  }

  @Post('evaluate/:userId')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '单用户评估' })
  async evaluate(@Param('userId') userId: string) {
    const r = await this.levelService.evaluate(userId, new Date(), 'MANUAL')
    return {
      success: true,
      data: {
        user_id: r.user_id,
        old_level: r.old_level,
        new_level: r.new_level,
        old_mgmt_level: r.old_mgmt_level,
        new_mgmt_level: r.new_mgmt_level,
        reason: r.reason,
        pending_level: r.pending_level,
        pending_management_level: r.pending_management_level,
        pending_effective_at: r.pending_effective_at,
        in_maintenance_until: r.in_maintenance_until,
        context: r.context,
      },
    }
  }

  // 2026-08-16: Phase 7 新 endpoints (维护期 + pending 模型)
  @Get('pending')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '列出所有有 pending 等级变更的 user' })
  async getPending() {
    return this.levelService.getPendingUsers()
  }

  @Post('commit-now')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '手动触发 commitScheduledChanges (测试用)' })
  async commitNow() {
    const count = await this.levelService.commitScheduledChanges()
    return { success: true, data: { committed_count: count } }
  }

  @Post('cancel-pending/:userId')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '撤回 user 的 pending 等级变更' })
  async cancelPending(@Param('userId') userId: string) {
    return this.levelService.cancelPending(userId)
  }
}