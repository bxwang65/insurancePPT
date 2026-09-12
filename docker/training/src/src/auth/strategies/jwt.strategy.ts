import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { AuthService } from '../auth.service'

/**
 * 2026-08-12: 培训 JwtStrategy 改成信任 4in1 IdP 签发的 JWT.
 *   - secret 与 insurance-ppt 共享 (docker-compose env JWT_SECRET)
 *   - payload 形状与 4in1 signToken 完全一致: { sub, email, name, firebaseUid, isAdmin }
 *   - 不再自签 token, 不再查 user.is_admin (直接信任 JWT 里的 isAdmin claim)
 *
 *   4in1 admin 同步 Firebase custom claim → JWT isAdmin=true → 培训 admin guard 放行.
 */
export interface IdpJwtPayload {
  sub: string
  email: string
  name: string
  firebaseUid?: string
  isAdmin: boolean
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: (() => {
        const s = process.env.JWT_SECRET
        if (!s) throw new Error('JWT_SECRET 未配置 — 请先在 .env 设置 JWT_SECRET=<openssl rand -hex 32>')
        return s
      })(),
    })
  }

  /**
   * passport-jwt 在 verify 通过后回调此方法, 返回值挂到 req.user.
   *   - 用 firebase_uid upsert 培训本地 user (首次访问时建档, 后续稳定)
   *   - 返回字段含 isAdmin, admin guard 直接读 req.user.isAdmin
   */
  async validate(payload: IdpJwtPayload) {
    if (!payload?.sub || !payload?.firebaseUid) {
      throw new UnauthorizedException('idp jwt 缺少 sub/firebaseUid')
    }

    const user = await this.authService.findOrCreateFromJwt(payload)

    if (!user.is_active) {
      throw new UnauthorizedException('账号已被禁用')
    }

    return {
      userId: user.id,            // 培训本地 user.id (cuid)
      sub: payload.sub,           // 4in1 user.id
      email: payload.email,
      name: user.name,
      firebase_uid: payload.firebaseUid,
      isAdmin: payload.isAdmin,   // 信任 4in1 JWT claim (Firebase custom claim authoritative)
      phone: user.phone,          // deprecated, 旧字段
      role: user.role,            // deprecated, 旧字段
    }
  }
}