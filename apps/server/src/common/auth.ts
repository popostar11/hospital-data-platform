import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { ERROR_CODE, type PermCode, type RoleCode } from '@hospital/shared'
import { ApiException, type RequestWithUser } from './api'
import { config } from '../config'

export const IS_PUBLIC = 'auth:public'
export const REQUIRED_PERMS = 'auth:perms'
export const REQUIRED_ROLES = 'auth:roles'
export const SCREEN_ENDPOINT = 'auth:screen'

/** 完全公开（登录、验证码、健康检查） */
export const Public = () => SetMetadata(IS_PUBLIC, true)
/** 要求权限点（任一命中即可） */
export const RequirePerms = (...perms: PermCode[]) => SetMetadata(REQUIRED_PERMS, perms)
/** 要求角色（任一命中即可） */
export const RequireRoles = (...roles: RoleCode[]) => SetMetadata(REQUIRED_ROLES, roles)
/**
 * 大屏端点：演示模式允许匿名只读；生产（DEMO_MODE=false）必须携带有效令牌。
 * 无论哪种方式，返回数据都在服务端完成脱敏。
 */
export const ScreenEndpoint = () => SetMetadata(SCREEN_ENDPOINT, true)

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<RequestWithUser>().user
})

export interface JwtPayload {
  sub: number
  username: string
  realName: string
  deptId: number | null
  roles: string[]
  perms: string[]
  typ: 'access' | 'refresh'
}

function extractToken(req: RequestWithUser): string | null {
  const header = req.headers['authorization']
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim()
  const q = req.query?.token
  if (typeof q === 'string' && q) return q
  return null
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>()
    const handlers = [context.getHandler(), context.getClass()]

    const token = extractToken(req)
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<JwtPayload>(token, { secret: config.jwtSecret })
        if (payload.typ === 'access') {
          req.user = {
            id: payload.sub,
            username: payload.username,
            realName: payload.realName,
            deptId: payload.deptId ?? null,
            roles: payload.roles ?? [],
            perms: payload.perms ?? [],
          }
        }
      } catch {
        /* 令牌无效时继续走下面的匿名判断 */
      }
    }

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, handlers)) return true

    const isScreen = this.reflector.getAllAndOverride<boolean>(SCREEN_ENDPOINT, handlers)
    if (isScreen && !req.user && config.demoMode) return true

    if (!req.user) throw new ApiException(ERROR_CODE.UNAUTHORIZED)

    const perms = this.reflector.getAllAndOverride<PermCode[]>(REQUIRED_PERMS, handlers)
    if (perms?.length && !this.hasAnyPerm(req.user.perms, perms)) {
      throw ApiException.forbidden(`缺少权限：${perms.join(' / ')}`)
    }

    const roles = this.reflector.getAllAndOverride<RoleCode[]>(REQUIRED_ROLES, handlers)
    if (roles?.length && !roles.some((r) => req.user!.roles.includes(r))) {
      throw ApiException.forbidden(`需要角色：${roles.join(' / ')}`)
    }

    return true
  }

  private hasAnyPerm(owned: string[], required: PermCode[]): boolean {
    if (owned.includes('*')) return true
    return required.some((p) => owned.includes(p))
  }
}
