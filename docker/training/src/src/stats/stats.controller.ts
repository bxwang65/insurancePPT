import { Controller, Get, Post, Param, Query, Req, ForbiddenException, NotFoundException, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger'
import { StatsService } from './stats.service'
import { BusinessProfileService } from './business-profile.service'
import { AdminGuard } from '../auth/guards/admin.guard'
import {
  StudentStatsResponseDto,
  DashboardSummaryDto,
  StudentListResponseDto,
  StudentDetailDto,
  StudentQueryDto,
} from './dto/stats.dto'

@ApiTags('学情统计')
@Controller('admin/stats')
export class StatsController {
  constructor(
    private readonly statsService: StatsService,
    private readonly businessProfileService: BusinessProfileService,
  ) {}

  @Get('student/:id')
  @ApiOperation({ summary: '获取学员学情统计数据' })
  @ApiResponse({ status: 200, type: StudentStatsResponseDto })
  @ApiResponse({ status: 404, description: '学员不存在' })
  async getStudentStats(@Param('id') userId: string, @Req() req: any) {
    // 权限校验：管理员可查看任意学员，学员只能看自己
    if (!req.user.isAdmin && req.user.userId !== userId) {
      throw new ForbiddenException('无权查看其他学员的学习数据')
    }
    try {
      const stats = await this.statsService.getStudentStats(userId)
      return { success: true, data: stats }
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error
      }
      throw error
    }
  }

  @Get('dashboard/summary')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '获取看板汇总数据（仅管理员）' })
  @ApiResponse({ status: 200, type: DashboardSummaryDto })
  async getDashboardSummary(@Req() req: any) {
    const data = await this.statsService.getDashboardSummary()
    return { success: true, data }
  }

  @Get('students')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '获取学员列表（分页+搜索+阶段筛选，仅管理员）' })
  @ApiQuery({ name: 'name', required: false, type: String })
  @ApiQuery({ name: 'stage', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, type: StudentListResponseDto })
  async getStudents(@Query() query: StudentQueryDto, @Req() req: any) {
    const data = await this.statsService.getStudents(query)
    return { success: true, data }
  }

  @Get('students/:id/detail')
  @ApiOperation({ summary: '获取学员档案详情' })
  @ApiResponse({ status: 200, type: StudentDetailDto })
  @ApiResponse({ status: 404, description: '学员不存在' })
  async getStudentDetail(@Param('id') userId: string, @Req() req: any) {
    // 权限校验：管理员可查看任意学员档案，学员只能看自己
    if (!req.user.isAdmin && req.user.userId !== userId) {
      throw new ForbiddenException('无权查看其他学员的档案')
    }
    try {
      const data = await this.statsService.getStudentDetail(userId)
      return { success: true, data }
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error
      }
      throw error
    }
  }

  /**
   * 2026-08-14: 业务看板 (admin 全公司视角)
   *   - range: month | quarter | year (默认 month)
   *   - 不传 range 时默认本月
   */
  @Get('business')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '业务看板汇总 (admin)' })
  @ApiQuery({ name: 'range', required: false, enum: ['month', 'quarter', 'year'] })
  async getBusinessDashboard(@Query('range') range?: 'month' | 'quarter' | 'year') {
    const r: 'month' | 'quarter' | 'year' =
      range === 'quarter' || range === 'year' ? range : 'month'
    const data = await this.statsService.getBusinessDashboard(r)
    return { success: true, data }
  }

  /**
   * 2026-08-14: 单学员业务画像 (admin 查看任意学员 / 学员自己看自己)
   *   - 业务逻辑抽到 stats.service.getStudentBusiness, 避免与 student.controller 重复
   */
  @Get('students/:id/business')
  @ApiOperation({ summary: '单学员业务画像 (admin 查看任意学员 / 学员自己看自己)' })
  @ApiQuery({ name: 'range', required: false, enum: ['month', 'quarter', 'year'] })
  async getStudentBusiness(@Param('id') userId: string, @Query('range') range?: 'month' | 'quarter' | 'year', @Req() req?: any) {
    if (req?.user && !req.user.isAdmin && req.user.userId !== userId) {
      throw new ForbiddenException('无权查看其他学员的业务画像')
    }
    const r: 'month' | 'quarter' | 'year' =
      range === 'quarter' || range === 'year' ? range : 'month'
    const data = await this.businessProfileService.getStudentBusiness(userId, r)
    if (!data) throw new NotFoundException(`学员 ${userId} 不存在`)
    return { success: true, data }
  }
}
