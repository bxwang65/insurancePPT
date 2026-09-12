import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, IsNumber, IsOptional, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

// ============================================================
// 打点同步请求 DTO
// ============================================================

export class SyncProgressDto {
  @ApiProperty({ description: '课程 ID' })
  @IsString()
  courseId: string

  @ApiPropertyOptional({ description: '视频 ID（VOD 预留字段）' })
  @IsOptional()
  @IsString()
  videoId?: string

  @ApiProperty({ description: '当前播放位置（秒）', minimum: 0 })
  @IsNumber()
  @Min(0)
  currentPosition: number
}

// ============================================================
// 响应 DTO
// ============================================================

export class SyncProgressResponseDto {
  @ApiProperty({ description: '是否成功' })
  success: boolean

  @ApiProperty({ description: '更新后的进度百分比' })
  progress_percentage: number

  @ApiPropertyOptional({ description: '防作弊警告信息' })
  warning?: string

  @ApiPropertyOptional({ description: '是否触发防作弊拦截' })
  blocked?: boolean
}

// ============================================================
// 批量同步 DTO（支持前端批量上报）
// ============================================================

export class BatchSyncProgressDto {
  @ApiProperty({ type: [SyncProgressDto] })
  @ValidateNested({ each: true })
  @Type(() => SyncProgressDto)
  items: SyncProgressDto[]
}
