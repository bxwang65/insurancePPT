import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max } from 'class-validator'

/**
 * POST /api/user/sync-progress 请求体
 * - courseId 必填
 * - percentage 与 currentPosition 至少传一个（都缺时 service 层抛 400）
 * - currentPosition 为合法数字时直接作为打点秒数（跳过百分比折算）
 */
export class SyncProgressDto {
  @ApiProperty({ description: '课程 ID' })
  @IsString()
  @IsNotEmpty()
  courseId: string

  @ApiPropertyOptional({ description: '学习进度百分比（0-100）' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage?: number

  @ApiPropertyOptional({ description: '当前播放位置（秒，≥0，优先于 percentage）' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  currentPosition?: number
}
