import { Controller, Post, Body, Headers, BadRequestException } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { ProgressService } from './progress.service'
import { SyncProgressDto, SyncProgressResponseDto, BatchSyncProgressDto } from './dto/progress.dto'

@ApiTags('学习进度')
@Controller('progress')
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  /**
   * ============================================================
   * POST /api/progress/sync
   *
   * 核心打点同步接口
   *
   * Headers: x-user-id（当前用户 ID，临时方案）
   * Body: { courseId, videoId?, currentPosition }
   * ============================================================
   */
  @Post('sync')
  @ApiOperation({ summary: '打点同步（核心接口）' })
  @ApiResponse({ status: 200, type: SyncProgressResponseDto })
  async sync(
    @Headers('x-user-id') userId: string,
    @Body() dto: SyncProgressDto,
  ) {
    if (!userId) {
      throw new BadRequestException('缺少 x-user-id 请求头')
    }

    const result = await this.progressService.sync(userId, dto)
    return result
  }

  /**
   * ============================================================
   * POST /api/progress/sync/batch
   *
   * 批量打点同步（支持定期批量上报）
   * ============================================================
   */
  @Post('sync/batch')
  @ApiOperation({ summary: '批量打点同步' })
  @ApiResponse({ status: 200, type: [SyncProgressResponseDto] })
  async batchSync(
    @Headers('x-user-id') userId: string,
    @Body() body: BatchSyncProgressDto,
  ) {
    if (!userId) {
      throw new BadRequestException('缺少 x-user-id 请求头')
    }

    const results = await this.progressService.batchSync(userId, body.items)
    return { success: true, results }
  }
}
