import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { AuthService } from './auth.service'
import { Public } from './decorators/public.decorator'

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * GET /api/auth/profile
   * 2026-08-12: 培训不再自己签发 JWT, 仅暴露 profile 给前端 (h5/admin iframe) 验证 token 是否还有效.
   *   鉴权逻辑: JwtAuthGuard 从 Bearer token verify, JwtStrategy.validate 已填充 req.user.
   *   返回字段与 4in1 /auth/me 一致 (id, email, name, isAdmin), 便于前端统一.
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiOperation({ summary: '当前登录用户信息 (Bearer JWT from 4in1 IdP)' })
  async profile(@Req() req: any) {
    return {
      success: true,
      data: {
        id: req.user.userId,
        email: req.user.email,
        name: req.user.name,
        isAdmin: req.user.isAdmin,
        firebaseUid: req.user.firebase_uid,
      },
    }
  }

  /**
   * POST /api/auth/internal/users/upsert
   * 2026-08-13: 内部同步接口 — 4in1 server.ts batch-create 创建 Firebase user 后调用,
   *   把账号推到培训 DB, 让培训管理后台能看见所有 4in1 已开通的普通账号.
   *   仅 Docker 网络内可访问 (无 JWT 鉴权, 由 docker-compose network 隔离).
   *   Body: { users: [{ firebaseUid, email, name, isAdmin }] }
   *   行为: 按 firebaseUid upsert (复用 AuthService.findOrCreateFromJwt 的语义)
   */
  @Post('internal/users/upsert')
  @Public()
  @ApiOperation({ summary: '(内部) 4in1 batch-create 同步用户到培训 DB' })
  async internalUpsert(@Body() body: {
    users: Array<{ firebaseUid: string; email: string; name: string; isAdmin?: boolean }>
  }) {
    const rows = Array.isArray(body?.users) ? body.users : []
    const out = { created: 0, updated: 0, errors: [] as Array<{ firebaseUid: string; error: string }> }
    for (const u of rows) {
      if (!u?.firebaseUid || !u?.email) {
        out.errors.push({ firebaseUid: u?.firebaseUid ?? '', error: 'missing firebaseUid/email' })
        continue
      }
      try {
        const existed = await this.authService.findOrCreateFromJwt({
          sub: u.firebaseUid,
          email: u.email,
          name: u.name || u.email.split('@')[0],
          firebaseUid: u.firebaseUid,
          isAdmin: !!u.isAdmin,
        })
        // 简化版: 区分 created/updated 不重要, 累计即可
        if (existed) out.created++
      } catch (e: any) {
        out.errors.push({ firebaseUid: u.firebaseUid, error: e?.message || String(e) })
      }
    }
    return { success: out.errors.length === 0, data: out }
  }
}