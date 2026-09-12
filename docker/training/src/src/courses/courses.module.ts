import { Module } from '@nestjs/common'
import { CoursesController } from './courses.controller'
import { CoursesService } from './courses.service'
import { VideoModule } from '../video/video.module'
// 2026-08-31: Phase 5 - OSS 灰度切换需要 OssService
import { UploadModule } from '../upload/upload.module'

@Module({
  imports: [VideoModule, UploadModule],
  controllers: [CoursesController],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule {}
