import { Controller, Get, Put, Param, Body, UseGuards, Req } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { ConfigService } from './config.service'
import { AdminGuard } from '../auth/guards/admin.guard'

@ApiTags('管理员 - 基本法配置')
@Controller('admin/config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '获取所有基本法配置 (L_PROMOTE_HK/M_PROMOTE/RECRUITER_RATES 等)' })
  async findAll() {
    return this.configService.findAll()
  }

  @Get(':key')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '获取单个配置' })
  async findOne(@Param('key') key: string) {
    return this.configService.findOne(key)
  }

  @Put(':key')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '更新配置' })
  async update(@Param('key') key: string, @Body() body: { value: any }, @Req() req: any) {
    return this.configService.update(key, body.value, req.user?.sub)
  }
}