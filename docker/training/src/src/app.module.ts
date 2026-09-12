import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { CoursesModule } from './courses/courses.module'
import { ProgressModule } from './progress/progress.module'
import { StatsModule } from './stats/stats.module'
import { FeedbackModule } from './feedback/feedback.module'
import { VideoModule } from './video/video.module'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { StudentModule } from './student/student.module'
import { UploadModule } from './upload/upload.module'
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard'
import { TransactionsModule } from './transactions/transactions.module'
import { ConfigModule } from './config/config.module'
import { LevelModule } from './level/level.module'

@Module({
  imports: [
    // 全局 JWT 配置（JWT_SECRET 在 main.ts 启动时校验）
    JwtModule.register({
      secret: process.env.JWT_SECRET!,
      signOptions: { expiresIn: '7d' },
    }),
    // 2026-08-15: 全局 rate limit (防止暴力破解 / 接口刷量)
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'medium', ttl: 60000, limit: 100 },
    ]),
    PrismaModule,
    CoursesModule,
    ProgressModule,
    StatsModule,
    FeedbackModule,
    VideoModule,
    AuthModule,
    UsersModule,
    StudentModule,
    // 2026-08-12: 基本法模块 (Transaction/Config/Level)
    ConfigModule,
    TransactionsModule,
    LevelModule,
    // 2026-08-31: 培训资料迁移 OSS 后, upload 走 UploadModule (含 OssService)
    UploadModule,
  ],
  providers: [
    // 全局鉴权 Guard，所有接口默认需要 JWT
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // 全局 rate limit guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
