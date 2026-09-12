import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, IsBoolean, Length, Matches, IsIn, IsDateString } from 'class-validator'
import { Type } from 'class-transformer'

// 2026-08-14: 头衔改为 L1/L2/L3 三档 (业务等级, 跟 current_level 1-3 对齐)
const TITLES = ['L1', 'L2', 'L3'] as const
const USER_STATUSES = ['ACTIVE', 'INACTIVE'] as const

export class CreateUserDto {
  @ApiProperty({ description: '姓名' })
  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  name: string

  @ApiProperty({ description: '手机号', example: '13800138001' })
  @IsString()
  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string

  @ApiPropertyOptional({ description: '联系手机号 (可选)', example: '13800138001' })
  @IsOptional()
  @IsString()
  @Length(0, 20, { message: '手机号长度不能超过 20 位' })
  mobile?: string

  @ApiProperty({ description: '初始密码', example: 'Songshi@2026' })
  @IsString()
  @IsNotEmpty({ message: '初始密码不能为空' })
  @Length(6, 32, { message: '密码长度6-32位' })
  password: string

  @ApiPropertyOptional({ description: '头衔', enum: TITLES, example: 'L1' })
  @IsOptional()
  @IsIn(TITLES)
  title?: string

  @ApiPropertyOptional({ description: '角色标签', example: '新人学员' })
  @IsOptional()
  @IsString()
  role?: string

  @ApiPropertyOptional({ description: '等级', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  level?: number

  // 2026-08-12: 基本法字段
  @ApiPropertyOptional({ description: '招募人 user.id (招我进来的人)' })
  @IsOptional() @IsString()
  recruiter_id?: string

  @ApiPropertyOptional({ description: '主管 user.id (默认=recruiter_id, admin 可改)' })
  @IsOptional() @IsString()
  manager_id?: string

  @ApiPropertyOptional({ description: 'L 业务等级 1-3', default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @IsIn([1, 2, 3])
  current_level?: number

  @ApiPropertyOptional({ description: 'M 管理等级 1-3', default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @IsIn([1, 2, 3])
  current_management_level?: number

  // 2026-08-14: 主推产品字段已删除 (产品维度不再由 user 维度决定)

  @ApiPropertyOptional({ description: '入职时间 ISO8601', example: '2026-01-01' })
  @IsOptional() @IsDateString()
  joined_at?: string

  @ApiPropertyOptional({ description: '账号状态', enum: USER_STATUSES, default: 'ACTIVE' })
  @IsOptional() @IsIn(USER_STATUSES)
  status?: string
}

export class UpdateUserStatusDto {
  @ApiProperty({ description: '是否启用', type: Boolean })
  @IsBoolean()
  is_active: boolean
}

// 2026-08-12: PATCH /api/admin/users/:id 通用更新 DTO
//   字段全部可选, 业务绩效/级别/头衔/角色 全在一个 endpoint 维护
export class UpdateUserDto {
  @ApiPropertyOptional({ description: '头衔 L1/L2/L3', enum: TITLES })
  @IsOptional() @IsIn(TITLES)
  title?: string

  @ApiPropertyOptional({ description: '联系手机号 (可选)', example: '13800138001' })
  @IsOptional() @IsString()
  @Length(0, 20, { message: '手机号长度不能超过 20 位' })
  mobile?: string

  @ApiPropertyOptional({ description: '角色标签' })
  @IsOptional() @IsString()
  role?: string

  @ApiPropertyOptional({ description: '等级 1/2/3' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  level?: number

  @ApiPropertyOptional({ description: '业务业绩金额 (HKD)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  sales_amount?: number

  @ApiPropertyOptional({ description: '综合业绩得分 0-100' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  performance_score?: number

  // 2026-08-12: 基本法字段
  @ApiPropertyOptional({ description: 'L 业务等级 1-3 (manual override)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @IsIn([1, 2, 3])
  current_level?: number

  @ApiPropertyOptional({ description: 'M 管理等级 1-3 (manual override)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @IsIn([1, 2, 3])
  current_management_level?: number

  @ApiPropertyOptional({ description: '招募人 user.id (招管分离 - 招我的人)' })
  @IsOptional() @IsString()
  recruiter_id?: string

  @ApiPropertyOptional({ description: '主管 user.id (招管分离 - 管我的人). 改变会写 ManagerChangeLog' })
  @IsOptional() @IsString()
  manager_id?: string

  @ApiPropertyOptional({ description: '改 manager 的原因' })
  @IsOptional() @IsString()
  manager_change_reason?: string

  // 2026-08-14: 主推产品字段已删除 (产品维度不再由 user 维度决定)

  @ApiPropertyOptional({ description: '入职时间 ISO8601' })
  @IsOptional() @IsDateString()
  joined_at?: string

  @ApiPropertyOptional({ description: '账号状态 ACTIVE/INACTIVE' })
  @IsOptional() @IsIn(USER_STATUSES)
  status?: string

  // 2026-08-24: admin 标志位 (仅超级管理员可改, 把 admin 降为普通员工或反之)
  @ApiPropertyOptional({ description: '管理员标志 (仅超级管理员 123@qqq.com 可改)' })
  @IsOptional() @IsBoolean()
  is_admin?: boolean
}

export class UserQueryDto {
  @ApiPropertyOptional({ description: '姓名搜索' })
  @IsOptional()
  @IsString()
  name?: string

  @ApiPropertyOptional({ description: '手机号搜索' })
  @IsOptional()
  @IsString()
  phone?: string

  @ApiPropertyOptional({ description: '账号状态', type: Boolean })
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean

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
