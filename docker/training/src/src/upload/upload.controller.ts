import { Controller, Post, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger'
import { diskStorage } from 'multer'
import { join } from 'path'

/**
 * mimetype → 落盘扩展名白名单映射
 * 落盘扩展名一律取映射结果，不信任 originalname，
 * 杜绝伪造 .html 等同源文件导致的 XSS。
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
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(__dirname, '../../uploads'),
        filename: (_req, file, callback) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
          // 扩展名取白名单映射结果，不使用 extname(originalname)
          const ext = MIME_EXT_MAP[file.mimetype] ?? ''
          callback(null, `${uniqueSuffix}${ext}`)
        },
      }),
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
  @ApiOperation({ summary: '上传文件（封面/视频/课件）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请选择要上传的文件')
    }

    return {
      success: true,
      data: {
        filename: file.filename,
        originalname: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
        url: `/uploads/${file.filename}`,
      },
    }
  }
}
