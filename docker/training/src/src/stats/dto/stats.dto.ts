import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, IsInt, Min } from 'class-validator'
import { Type } from 'class-transformer'

// ============================================================
// 先定义子类型（被其他类型引用的类型要放前面）
// ============================================================

export class StageStatsDto {
  @ApiProperty()
  total: number

  @ApiProperty()
  completed: number

  @ApiProperty()
  in_progress: number

  @ApiProperty()
  avg_progress: number
}

export class StageDistributionDto {
  @ApiProperty()
  onboarding: StageStatsDto

  @ApiProperty()
  product: StageStatsDto

  @ApiProperty()
  transfer: StageStatsDto

  @ApiProperty()
  advancement: StageStatsDto
}

export class HonorDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiProperty()
  icon_url: string

  @ApiProperty()
  earned_at: string
}

// ============================================================
// 学员学情统计响应 DTO（放在最后，因为它引用了上面的类型）
// ============================================================

export class StudentStatsResponseDto {
  @ApiProperty()
  userId: string

  @ApiProperty()
  name: string

  @ApiProperty()
  total_learning_minutes: number

  @ApiProperty()
  total_learning_hours: number

  @ApiProperty()
  level: number

  @ApiProperty()
  level_name: string

  @ApiProperty()
  completed_courses: number

  @ApiProperty()
  in_progress_courses: number

  @ApiProperty()
  overall_completion_rate: number

  @ApiProperty()
  stage_distribution: StageDistributionDto

  @ApiPropertyOptional()
  recent_honors?: HonorDto[]
}

// ============================================================
// 看板汇总统计
// ============================================================

export class DashboardSummaryDto {
  @ApiProperty()
  total_students: number

  @ApiProperty()
  active_students_this_month: number

  @ApiProperty()
  avg_learning_hours: number

  @ApiProperty()
  course_completion_rate: number

  @ApiProperty()
  stage_distribution: { name: string; count: number }[]

  @ApiProperty()
  top_courses: { id: string; title: string; view_count: number; like_count: number }[]

  @ApiProperty()
  recent_activities: {
    user_id: string
    user_name: string
    avatar_url?: string
    action: string
    course_title: string
    created_at: string
  }[]
}

// ============================================================
// 学员列表查询
// ============================================================

export class StudentQueryDto {
  @ApiPropertyOptional({ description: '姓名搜索', default: '' })
  @IsOptional()
  @IsString()
  name?: string

  @ApiPropertyOptional({ description: '阶段: ONBOARDING / PRODUCT / TRANSFER / ADVANCEMENT' })
  @IsOptional()
  @IsString()
  stage?: string

  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ description: '每页数量', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number
}

export class StudentCourseDetailDto {
  @ApiProperty()
  course_id: string

  @ApiProperty()
  course_title: string

  @ApiProperty()
  progress_percentage: number

  @ApiProperty()
  completed: boolean
}

export class StudentListItemDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiPropertyOptional()
  avatar_url?: string

  @ApiProperty()
  level: number

  @ApiProperty()
  level_name: string

  @ApiProperty()
  total_learning_minutes: number

  @ApiPropertyOptional()
  last_watched_at?: string

  @ApiProperty()
  completed_courses: number

  @ApiProperty()
  in_progress_courses: number

  @ApiProperty()
  current_stage: string

  @ApiProperty()
  current_stage_name: string
}

export class StudentListResponseDto {
  @ApiProperty({ type: [StudentListItemDto] })
  students: StudentListItemDto[]

  @ApiProperty()
  total: number

  @ApiProperty()
  page: number

  @ApiProperty()
  limit: number
}

export class StudentDetailDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  name: string

  @ApiPropertyOptional()
  avatar_url?: string

  @ApiProperty({ nullable: true })
  role: string | null

  @ApiPropertyOptional()
  title?: string

  @ApiProperty()
  level: number

  @ApiProperty()
  level_name: string

  @ApiProperty()
  total_learning_minutes: number

  @ApiProperty()
  completed_courses: number

  @ApiProperty()
  in_progress_courses: number

  @ApiProperty()
  current_stage: string

  @ApiProperty()
  current_stage_name: string

  @ApiPropertyOptional()
  last_watched_at?: string

  @ApiProperty({ description: '账号是否启用' })
  is_active: boolean

  @ApiProperty({ type: [StudentCourseDetailDto] })
  course_detail: StudentCourseDetailDto[]

  @ApiProperty({ description: '雷达图数据：法税/产品/话术三维能力分布' })
  radar_stats: { dimension: string; score: number }[]

  // 2026-08-14: 招管分离字段, 档案 drawer 编辑用
  @ApiPropertyOptional({ nullable: true })
  recruiter_id?: string | null

  @ApiPropertyOptional({ nullable: true })
  recruiter_name?: string | null

  @ApiPropertyOptional({ nullable: true })
  manager_id?: string | null

  @ApiPropertyOptional({ nullable: true })
  manager_name?: string | null
}
