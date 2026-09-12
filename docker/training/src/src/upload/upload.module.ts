import { Module } from '@nestjs/common'
import { UploadController } from './upload.controller'
import { OssService } from './oss.service'

@Module({
  controllers: [UploadController],
  providers: [OssService],
  exports: [OssService],
})
export class UploadModule {}