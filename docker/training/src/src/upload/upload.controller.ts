import {
  Controller, Post, Get, UseInterceptors, UploadedFile,
  BadRequestException, Query, Logger,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger'
import { memoryStorage } from 'multer'
import { OssService } from './oss.service'

/**
 * mimetype → 文件扩展名白名单映射
 * 强制白名单, 不信任 originalname, 杜绝伪造 .html 等同源文件导致 XSS.
 */
const MIME_EXT_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'application/pdf': '.pdf',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
}

@ApiTags('文件上传')
@Controller('upload')
export class UploadController {
  private readonly logger = new Logger(UploadController.name)

  constructor(private readonly ossService: OssService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // 2026-08-31: 改用内存存储, 上传后立即推 OSS, 不落本地
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
      fileFilter: (_req, file, callback) => {
        if (MIME_EXT_MAP[file.mimetype]) {
          callback(null, true)
        } else {
          callback(new BadRequestException(`不支持的文件类型: ${file.mimetype}`), false)
        }
      },
    }),
  )
  @ApiOperation({ summary: '上传文件（封面/视频/课件）→ OSS' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请选择要上传的文件')
    }
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('文件为空')
    }

    // 生成 OSS key: training/uploads/{ts}-{rand}.{ext}
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    const ext = MIME_EXT_MAP[file.mimetype] ?? ''
    const filename = `${uniqueSuffix}${ext}`

    const ossKey = await this.ossService.put(filename, file.buffer, file.mimetype)
    const signedUrl = await this.ossService.signUrl(ossKey, 3600)

    this.logger.log(`uploaded: ${ossKey} (${file.size} bytes)`)

    return {
      success: true,
      data: {
        filename,
        originalname: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
        oss_key: ossKey,
        url: signedUrl,        // 1 小时签名 URL, 前端直接用
        expires_in: 3600,
      },
    }
  }

  /**
   * 给前端续签 OSS URL (视频 src 接近 1h 过期时主动调)
   */
  @Get('sign')
  @ApiOperation({ summary: 'OSS 签名 URL 续签' })
  @ApiQuery({ name: 'key', description: 'OSS key, 如 training/uploads/xxx.mp4' })
  async sign(@Query('key') key: string, @Query('expires') expires?: string) {
    if (!key) {
      throw new BadRequestException('key 必填')
    }
    const ttl = Math.min(parseInt(expires ?? '3600', 10) || 3600, 7 * 24 * 3600)
    const url = await this.ossService.signUrl(key, ttl)
    return {
      success: true,
      data: { url, expires_in: ttl },
    }
  }
}