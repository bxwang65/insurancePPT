import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsString, IsNotEmpty, IsOptional, IsInt, Min, Max,
  IsIn, IsNumber, IsDateString, ValidateIf,
} from 'class-validator'
import { Type } from 'class-transformer'

const PRODUCT_TYPES = ['HK', 'SG', 'ART_MODERN', 'ART_CONTEMP'] as const

export class CreateTransactionDto {
  @ApiProperty({ description: '员工 user.id' })
  @IsString() @IsNotEmpty()
  user_id: string

  @ApiProperty({ description: '产品类型', enum: PRODUCT_TYPES })
  @IsIn(PRODUCT_TYPES)
  product_type: string

  // HK/SG 字段 - 仅 HK/SG 必填
  @ValidateIf((o) => o.product_type === 'HK' || o.product_type === 'SG')
  @IsNotEmpty({ message: '年缴保费必填 (HK/SG)' })
  @IsNumber()
  @Type(() => Number)
  annual_premium?: number

  @ValidateIf((o) => o.product_type === 'HK' || o.product_type === 'SG')
  @IsNotEmpty({ message: '缴费年数必填 (HK/SG)' })
  @IsInt() @Min(1)
  @Type(() => Number)
  payment_years?: number

  @ApiPropertyOptional({ description: '保单号 (HK/SG 可选)' })
  @IsOptional() @IsString()
  policy_no?: string

  // 2026-08-16: HK 产品识别 (product_type='HK' 时必填)
  //   - hk_term 是 hx-rates 查找键 (与 payment_years 不同语义: 10年保单可5年付清)
  //   - hk_code + hk_plan 联合定位
  @ValidateIf((o) => o.product_type === 'HK')
  @IsNotEmpty({ message: 'hk_company 必填 (HK)' })
  @IsString()
  hk_company?: string

  @ValidateIf((o) => o.product_type === 'HK')
  @IsNotEmpty({ message: 'hk_code 必填 (HK)' })
  @IsString()
  hk_code?: string

  @ValidateIf((o) => o.product_type === 'HK')
  @IsNotEmpty({ message: 'hk_plan 必填 (HK)' })
  @IsString()
  hk_plan?: string

  @ValidateIf((o) => o.product_type === 'HK')
  @IsNotEmpty({ message: 'hk_term 必填 (HK)' })
  @IsInt() @Min(1) @Max(20)
  @Type(() => Number)
  hk_term?: number

  // 2026-08-16: 客户合格投资人状态 (HK/SG 用, 控制费率表路由)
  //   - 'pi' = 合格投资人 (Qualified Investor), 查 pi_fee_* 表
  //   - 'npi' = 非合格投资人 (Non-Qualified Investor), 查 npi_fee_* 表
  //   - 默认 'pi' (与个别保险公司保守假设一致), 实际由录入时客户状态决定
  @ApiPropertyOptional({ description: '客户合格投资人状态: pi (合格) / npi (非合格)', enum: ['pi', 'npi'], default: 'pi' })
  @IsOptional() @IsIn(['pi', 'npi'])
  investor?: 'pi' | 'npi'

  // ART 字段 - 仅 ART 必填
  @ValidateIf((o) => o.product_type === 'ART_MODERN' || o.product_type === 'ART_CONTEMP')
  @IsNotEmpty({ message: '艺术家必填 (ART)' })
  @IsString()
  artist?: string

  @ValidateIf((o) => o.product_type === 'ART_MODERN' || o.product_type === 'ART_CONTEMP')
  @IsNotEmpty({ message: '作品名必填 (ART)' })
  @IsString()
  work_title?: string

  @ValidateIf((o) => o.product_type === 'ART_MODERN' || o.product_type === 'ART_CONTEMP')
  @IsNotEmpty({ message: '成交价必填 (ART)' })
  @IsNumber()
  @Type(() => Number)
  sale_price?: number

  @ApiPropertyOptional({ description: '币种 (ART 默认 RMB)', default: 'RMB' })
  @IsOptional() @IsString()
  currency?: string

  @ApiProperty({ description: '售出/成交日期 ISO8601' })
  @IsDateString()
  sold_at: string
}

export class UpdateTransactionDto {
  @ApiPropertyOptional({ description: '年缴保费 (HK/SG)' })
  @IsOptional() @IsNumber() @Type(() => Number)
  annual_premium?: number

  @ApiPropertyOptional({ description: '缴费年数 (HK/SG)' })
  @IsOptional() @IsInt() @Min(1) @Type(() => Number)
  payment_years?: number

  @ApiPropertyOptional({ description: '保单号 (HK/SG)' })
  @IsOptional() @IsString()
  policy_no?: string

  @ApiPropertyOptional({ description: '艺术家 (ART)' })
  @IsOptional() @IsString()
  artist?: string

  @ApiPropertyOptional({ description: '作品名 (ART)' })
  @IsOptional() @IsString()
  work_title?: string

  @ApiPropertyOptional({ description: '成交价 (ART)' })
  @IsOptional() @IsNumber() @Type(() => Number)
  sale_price?: number

  @ApiPropertyOptional({ description: '币种' })
  @IsOptional() @IsString()
  currency?: string

  @ApiPropertyOptional({ description: '售出/成交日期' })
  @IsOptional() @IsDateString()
  sold_at?: string

  @ApiPropertyOptional({ description: '佣金金额 (admin 后期按费用表填)' })
  @IsOptional() @IsNumber() @Type(() => Number)
  commission_amount?: number

  @ApiPropertyOptional({ description: '佣金拆解 JSON string' })
  @IsOptional() @IsString()
  commission_breakdown?: string

  // 2026-08-16: HK 产品识别 (PATCH 允许, UI 默认锁定)
  @ApiPropertyOptional({ description: 'HK 公司' })
  @IsOptional() @IsString()
  hk_company?: string

  @ApiPropertyOptional({ description: 'HK 产品代码' })
  @IsOptional() @IsString()
  hk_code?: string

  @ApiPropertyOptional({ description: 'HK 计划名' })
  @IsOptional() @IsString()
  hk_plan?: string

  @ApiPropertyOptional({ description: 'HK 保单年期' })
  @IsOptional() @IsInt() @Min(1) @Max(20) @Type(() => Number)
  hk_term?: number

  // 2026-08-16: 客户合格投资人状态 (HK/SG, 编辑时锁定, 但允许改)
  @ApiPropertyOptional({ description: '客户合格投资人状态: pi (合格) / npi (非合格)', enum: ['pi', 'npi'] })
  @IsOptional() @IsIn(['pi', 'npi'])
  investor?: 'pi' | 'npi'
}

export class TransactionQueryDto {
  @ApiPropertyOptional({ description: '员工 user.id' })
  @IsOptional() @IsString()
  user_id?: string

  @ApiPropertyOptional({ description: '产品类型' })
  @IsOptional() @IsIn(PRODUCT_TYPES)
  product_type?: string

  @ApiPropertyOptional({ description: '起始日期 ISO8601' })
  @IsOptional() @IsDateString()
  from?: string

  @ApiPropertyOptional({ description: '截止日期 ISO8601' })
  @IsOptional() @IsDateString()
  to?: string

  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number

  @ApiPropertyOptional({ description: '每页数量', default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number
}