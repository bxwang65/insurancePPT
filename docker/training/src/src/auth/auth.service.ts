import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

/**
 * 4in1 IdP 共享 JWT payload (与 insurance-ppt src/api/server.ts signToken 对齐):
 *   { sub, email, name, firebaseUid, isAdmin, iat, exp }
 */
export interface IdpJwtPayload {
  sub: string              // 4in1 user.id (e.g. u_dceffdfbcb74)
  email: string
  name: string
  firebaseUid?: string
  isAdmin: boolean
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 用 4in1 IdP JWT 查找或创建本地 User 记录 (upsert by firebase_uid).
   * 由 JwtStrategy.validate 调用, 在用户首次进 iframe 时触发.
   *
   * 设计:
   *   - 4in1 是 IdP, 培训不再有自己的登录/密码
   *   - 同一 4in1 user 多次进 iframe 都返回同一培训 user.id (stable)
   *   - is_admin 同步: 4in1 JWT isAdmin=true → 培训 user.is_admin=true (authoritative)
   */
  async findOrCreateFromJwt(payload: IdpJwtPayload) {
    if (!payload.firebaseUid) {
      // 4in1 JWT 缺 firebaseUid, 无法 upsert. 视为 token 非法.
      throw new Error('idp jwt missing firebaseUid')
    }

    // 1. 先按真实 firebaseUid 找 (本机 4in1 user 多次进 iframe 都返回同一 record)
    const byUid = await this.prisma.user.findUnique({
      where: { firebase_uid: payload.firebaseUid },
    })
    if (byUid) {
      return this.prisma.user.update({
        where: { id: byUid.id },
        data: {
          email: payload.email,
          name: payload.name,
          is_admin: payload.isAdmin,
          is_active: true,
        },
      })
    }

    // 2. 没找到 uid → 检查 email 是否被另一行占着 (脏数据: firebase_uid 是占位值但 email 是真 email)
    //    这种情况把那条脏记录的 firebase_uid 改绑到真实的 (保留 user_id + 关联 userCourseProgress)
    const byEmail = await this.prisma.user.findUnique({
      where: { email: payload.email },
    })
    if (byEmail && byEmail.firebase_uid !== payload.firebaseUid) {
      console.warn(
        `[auth] 脏记录迁移: userId=${byEmail.id} email=${payload.email} ` +
          `old_firebase_uid=${byEmail.firebase_uid} -> new=${payload.firebaseUid}`,
      )
      return this.prisma.user.update({
        where: { id: byEmail.id },
        data: {
          firebase_uid: payload.firebaseUid,
          name: payload.name,
          is_admin: payload.isAdmin,
          is_active: true,
        },
      })
    }

    // 3. uid 不存在 + email 没被占用 → create
    return this.prisma.user.create({
      data: {
        firebase_uid: payload.firebaseUid,
        email: payload.email,
        name: payload.name,
        is_admin: payload.isAdmin,
        level: 1,
        level_name: '初阶阶段',
        total_learning_minutes: 0,
        is_active: true,
      },
    })
  }
}