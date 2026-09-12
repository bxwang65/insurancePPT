import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, IsNumber, IsOptional, Min, Max, IsBoolean } from 'class-validator'

// ============================================================
// 提交反馈 DTO
// ============================================================

export class CreateFeedbackDto {
  @ApiProperty({ description: '课程 ID' })
  @IsString()
  courseId: string

  @ApiProperty({ description: '星级评分', minimum: 1, maximum: 5 })
  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number

  @ApiPropertyOptional({ description: '文字评价（可选）' })
  @IsOptional()
  @IsString()
  comment?: string

  @ApiProperty({ description: '是否点赞', default: true })
  @IsBoolean()
  liked: boolean
}

// ============================================================
// 响应 DTO
// ============================================================

export class FeedbackResponseDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  user_id: string

  @ApiProperty()
  course_id: string

  @ApiProperty()
  rating: number

  @ApiPropertyOptional()
  comment?: string

  @ApiProperty()
  liked: boolean

  @ApiProperty()
  created_at: string
}

export class FeedbackListResponseDto {
  @ApiProperty({ type: [FeedbackResponseDto] })
  feedback_list: FeedbackResponseDto[]

  @ApiProperty()
  total: number

  @ApiProperty()
  avg_rating: number

  @ApiProperty()
  like_count: number
}
