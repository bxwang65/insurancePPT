import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtStrategy } from './strategies/jwt.strategy'
import { JwtAuthGuard } from './guards/jwt-auth.guard'

/**
 * 2026-08-12: 培训不再自己签发 JWT, 走 4in1 IdP 校验.
 *   - 去掉 JwtModule.register (不再 sign token)
 *   - JwtStrategy 直接用 process.env.JWT_SECRET (与 insurance-ppt 共享)
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    PrismaModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}