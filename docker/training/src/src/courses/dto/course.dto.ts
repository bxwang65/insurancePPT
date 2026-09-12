import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, IsIn, IsNumber, IsInt, Min, IsNotEmpty, IsArray, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

// ============================================================
// 查询 DTO
// ============================================================

export class QueryCoursesDto {
  @ApiPropertyOptional({ description: '按阶段过滤：ONBOARDING / TRANSFER / ADVANCEMENT' })
  @IsOptional()
  @IsString()
  @IsIn(['ONBOARDING', 'TRANSFER', 'ADVANCEMENT'])
  stage?: string

  @ApiPropertyOptional({ description: '当前用户 ID（用于关联进度）', default: 'u_001' })
  @IsOptional()
  @IsString()
  userId?: string
}

// ============================================================
// 子类型（被其他类型引用，需前置定义）
// ============================================================

export class MaterialDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  title: string

  @ApiProperty()
  file_url: string

  @ApiProperty({ description: '文件类型：PDF / PPT / DOC' })
  file_type: string

  @ApiPropertyOptional({ description: '文件大小（字节）' })
  file_size?: number

  @ApiProperty()
  created_at: string
}

// ============================================================
// 响应 DTO
// ============================================================

export class CourseResponseDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  title: string

  @ApiProperty()
  cover_image: string

  @ApiProperty()
  stage: string

  @ApiProperty()
  stage_name: string

  @ApiProperty()
  duration_minutes: number

  @ApiPropertyOptional()
  description?: string

  @ApiPropertyOptional({ description: '视频 CDN URL（本地路径或 OSS 链接）' })
  video_url?: string

  @ApiProperty({ description: '当前用户的进度百分比（0-100）' })
  progress_percentage: number

  @ApiPropertyOptional({ description: '最后观看时间' })
  last_watched_at?: string

  @ApiPropertyOptional({ description: '课件列表', type: [MaterialDto] })
  materials?: MaterialDto[]
}

export class CourseListResponseDto {
  @ApiProperty({ type: [CourseResponseDto] })
  courses: CourseResponseDto[]

  @ApiProperty()
  total: number
}

// ============================================================
// 写入 DTO（管理后台课程 CRUD，字段严格对齐 admin-web payload）
// ============================================================

export class MaterialInputDto {
  @ApiProperty({ description: '课件名称' })
  @IsString()
  @IsNotEmpty()
  title: string

  @ApiProperty({ description: 'OSS/CDN 下载链接' })
  @IsString()
  @IsNotEmpty()
  file_url: string

  @ApiProperty({ description: '文件类型：PDF / PPT / DOC' })
  @IsString()
  @IsNotEmpty()
  file_type: string

  @ApiPropertyOptional({ description: '文件大小（字节）' })
  @IsOptional()
  @IsNumber()
  file_size?: number
}

export class CreateCourseDto {
  @ApiProperty({ description: '课程标题' })
  @IsString()
  @IsNotEmpty()
  title: string

  @ApiProperty({ description: '阶段：ONBOARDING / TRANSFER / ADVANCEMENT' })
  @IsString()
  @IsIn(['ONBOARDING', 'TRANSFER', 'ADVANCEMENT'])
  stage: string

  @ApiProperty({ description: '阶段中文名', example: '新人训' })
  @IsString()
  @IsNotEmpty()
  stage_name: string

  @ApiPropertyOptional({ description: '课程简介' })
  @IsOptional()
  @IsString()
  description?: string

  @ApiPropertyOptional({ description: '封面图 URL' })
  @IsOptional()
  @IsString()
  cover_image?: string

  @ApiPropertyOptional({ description: '视频 CDN URL（本地路径或 OSS 链接）' })
  @IsOptional()
  @IsString()
  video_url?: string

  @ApiProperty({ description: '课程总时长（分钟，正整数）' })
  @IsNumber()
  @IsInt()
  @Min(1)
  duration_minutes: number

  @ApiPropertyOptional({ description: '课件列表', type: [MaterialInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MaterialInputDto)
  materials?: MaterialInputDto[]
}

export class UpdateCourseDto {
  @ApiPropertyOptional({ description: '课程标题' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string

  @ApiPropertyOptional({ description: '阶段：ONBOARDING / TRANSFER / ADVANCEMENT' })
  @IsOptional()
  @IsString()
  @IsIn(['ONBOARDING', 'TRANSFER', 'ADVANCEMENT'])
  stage?: string

  @ApiPropertyOptional({ description: '阶段中文名' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  stage_name?: string

  @ApiPropertyOptional({ description: '课程简介' })
  @IsOptional()
  @IsString()
  description?: string

  @ApiPropertyOptional({ description: '封面图 URL' })
  @IsOptional()
  @IsString()
  cover_image?: string

  @ApiPropertyOptional({ description: '视频 CDN URL（本地路径或 OSS 链接）' })
  @IsOptional()
  @IsString()
  video_url?: string

  @ApiPropertyOptional({ description: '课程总时长（分钟，正整数）' })
  @IsOptional()
  @IsNumber()
  @IsInt()
  @Min(1)
  duration_minutes?: number

  @ApiPropertyOptional({ description: '课件列表（传入时全量重建，不传则不动课件）', type: [MaterialInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MaterialInputDto)
  materials?: MaterialInputDto[]
}
