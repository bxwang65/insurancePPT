import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class ConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/admin/config
   * 返回所有配置 (key -> parsed value)
   */
  async findAll() {
    const rows = await this.prisma.config.findMany()
    const data: Record<string, any> = {}
    for (const r of rows) {
      try {
        data[r.key] = JSON.parse(r.value)
      } catch {
        data[r.key] = r.value
      }
    }
    return { success: true, data }
  }

  /**
   * PUT /api/admin/config/:key
   * body: { value: any }
   */
  async update(key: string, value: any, updatedBy?: string) {
    const valueStr = typeof value === 'string' ? value : JSON.stringify(value)
    const existing = await this.prisma.config.findUnique({ where: { key } })
    if (!existing) throw new NotFoundException(`配置 ${key} 不存在`)

    await this.prisma.config.update({
      where: { key },
      data: { value: valueStr, updated_by: updatedBy ?? null },
    })

    return { success: true, data: { key, value } }
  }

  /**
   * GET /api/admin/config/:key
   */
  async findOne(key: string) {
    const row = await this.prisma.config.findUnique({ where: { key } })
    if (!row) throw new NotFoundException(`配置 ${key} 不存在`)
    try {
      return { success: true, data: { key, value: JSON.parse(row.value) } }
    } catch {
      return { success: true, data: { key, value: row.value } }
    }
  }
}