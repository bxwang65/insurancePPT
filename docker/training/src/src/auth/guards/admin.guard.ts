import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common'

/**
 * 管理员权限 Guard
 * 依赖全局 JwtAuthGuard 先执行：到达本 Guard 时 req.user 已由 jwt.strategy 填充，
 * 其中 isAdmin 来自 User.is_admin 字段。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest()
    if (!req.user?.isAdmin) {
      throw new ForbiddenException('需要管理员权限')
    }
    return true
  }
}
