import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Req } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { TransactionsService } from './transactions.service'
import { CreateTransactionDto, UpdateTransactionDto, TransactionQueryDto } from './dto/create-transaction.dto'
import { AdminGuard } from '../auth/guards/admin.guard'

@ApiTags('管理员 - 业绩流水 (HK/SG/ART)')
@Controller('admin/transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '录入业绩流水 (HK/SG/ART 共表)' })
  async create(@Body() dto: CreateTransactionDto, @Req() req: any) {
    // 2026-08-16: 透传 admin JWT 给 service, 内部调 /api/rates/preview 自动算 commission
    const adminAuthHeader = (req.headers?.authorization as string | undefined) || ''
    return this.transactionsService.create(dto, req.user?.sub ?? 'admin', adminAuthHeader)
  }

  @Get()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '查询业绩流水' })
  async findAll(@Query() query: TransactionQueryDto) {
    return this.transactionsService.findAll(query)
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '更新业绩流水' })
  async update(@Param('id') id: string, @Body() dto: UpdateTransactionDto) {
    return this.transactionsService.update(id, dto)
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '删除业绩流水' })
  async remove(@Param('id') id: string) {
    return this.transactionsService.remove(id)
  }
}