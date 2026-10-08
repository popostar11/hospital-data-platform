/**
 * 认证路由：登录、刷新、当前用户、改密、验证码占位。
 * 与本地 NestJS 版返回完全一致的 LoginResponse / UserInfo。
 */
import { ERROR_CODE, PERM, type LoginResponse, type UserInfo } from '@hospital/shared'
import { now } from '../db'
import { ApiException } from '../http'
import { optionalString, requireString } from '../http'
import { hashPassword, signJwt, verifyJwt, verifyPassword } from '../security'
import type { Ctx, Route, SessionUser } from '../types'
import { verifyJwt as verify } from '../security'

interface UserRow {
  id: number
  username: string
  passwordHash: string
  realName: string
  deptId: number | null
  deptName: string | null
  enabled: number
}

const SELECT_USER = /* sql */ `
  SELECT u.id, u.username, u.password_hash AS passwordHash, u.real_name AS realName,
         u.dept_id AS deptId, d.name AS deptName, u.enabled
    FROM sys_user u LEFT JOIN department d ON d.id = u.dept_id
`

async function buildUserInfo(ctx: Ctx, user: UserRow): Promise<UserInfo> {
  const roleRows = await ctx.db.all<{ code: string; name: string; perms: string }>(
    `SELECT r.code, r.name, r.perms FROM role r
       JOIN user_role ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.id`,
    [user.id],
  )
  const perms = new Set<string>()
  let wildcard = false
  for (const r of roleRows) {
    let list: string[] = []
    try {
      list = JSON.parse(r.perms)
    } catch {
      list = []
    }
    if (list.includes('*')) wildcard = true
    list.forEach((p) => perms.add(p))
  }
  return {
    id: user.id,
    username: user.username,
    realName: user.realName,
    deptId: user.deptId ?? null,
    deptName: user.deptName ?? null,
    roles: roleRows.map((r) => ({ code: r.code as UserInfo['roles'][number]['code'], name: r.name })),
    perms: (wildcard ? ['*'] : [...perms]) as UserInfo['perms'],
  }
}

async function issueTokens(ctx: Ctx, info: UserInfo): Promise<LoginResponse> {
  const base = {
    sub: info.id,
    username: info.username,
    realName: info.realName,
    deptId: info.deptId,
    roles: info.roles.map((r) => r.code as string),
    perms: info.perms as string[],
  }
  const secret = ctx.env.JWT_SECRET
  const [accessToken, refreshToken] = await Promise.all([
    signJwt({ ...base, typ: 'access' }, secret, 2 * 60 * 60),
    signJwt({ ...base, typ: 'refresh' }, secret, 7 * 24 * 60 * 60),
  ])
  return { accessToken, refreshToken, expiresIn: 2 * 60 * 60, user: info }
}

export const authRoutes: Route[] = [
  {
    method: 'GET',
    path: '/auth/captcha',
    isPublic: true,
    // 公网演示关闭验证码：Worker 无跨请求内存，且演示无需防爆破
    handler: () => ({ enabled: false }),
  },
  {
    method: 'POST',
    path: '/auth/login',
    isPublic: true,
    handler: async (ctx) => {
      const username = String(ctx.body?.username ?? '').trim()
      const password = String(ctx.body?.password ?? '')
      if (!username || !password) throw ApiException.param('用户名和密码不能为空')

      const user = await ctx.db.get<UserRow>(`${SELECT_USER} WHERE u.username = ? AND u.deleted_at IS NULL`, [username])
      const okPassword = user ? await verifyPassword(password, user.passwordHash) : false

      if (!user || !okPassword || user.enabled !== 1) {
        await ctx.db.insert('sys_login_log', {
          username,
          success: 0,
          message: !user ? '账号不存在' : user.enabled !== 1 ? '账号已停用' : '密码错误',
          ip: ctx.req.headers.get('cf-connecting-ip') ?? '',
          user_agent: ctx.req.headers.get('user-agent') ?? '',
          created_at: ctx.nowStr,
        })
        throw new ApiException(ERROR_CODE.UNAUTHORIZED, !user ? '账号或密码错误' : user.enabled !== 1 ? '账号已停用，请联系管理员' : '账号或密码错误')
      }

      await ctx.db.update('sys_user', user.id, { last_login_at: ctx.nowStr })
      const info = await buildUserInfo(ctx, user)
      const result = await issueTokens(ctx, info)
      await ctx.db.insert('sys_login_log', {
        username,
        success: 1,
        message: '登录成功',
        ip: ctx.req.headers.get('cf-connecting-ip') ?? '',
        user_agent: ctx.req.headers.get('user-agent') ?? '',
        created_at: ctx.nowStr,
      })
      return result
    },
  },
  {
    method: 'POST',
    path: '/auth/refresh',
    isPublic: true,
    handler: async (ctx) => {
      const token = String(ctx.body?.refreshToken ?? '')
      if (!token) throw ApiException.param('缺少刷新令牌')
      const payload = await verify(token, ctx.env.JWT_SECRET)
      if (!payload || payload.typ !== 'refresh') throw new ApiException(ERROR_CODE.TOKEN_EXPIRED, '登录已过期，请重新登录')
      const user = await ctx.db.get<UserRow>(`${SELECT_USER} WHERE u.id = ? AND u.deleted_at IS NULL`, [payload.sub])
      if (!user || user.enabled !== 1) throw ApiException.unauthorized('账号不可用')
      return issueTokens(ctx, await buildUserInfo(ctx, user))
    },
  },
  {
    method: 'POST',
    path: '/auth/logout',
    handler: async (ctx) => {
      await ctx.db.insert('sys_oper_log', {
        user_id: ctx.user?.id ?? null,
        user_name: ctx.user?.username ?? null,
        module: 'auth',
        action: 'LOGOUT',
        created_at: ctx.nowStr,
      })
      return { ok: true }
    },
  },
  {
    method: 'GET',
    path: '/auth/me',
    handler: async (ctx) => {
      const user = await ctx.db.get<UserRow>(`${SELECT_USER} WHERE u.id = ? AND u.deleted_at IS NULL`, [ctx.user!.id])
      if (!user) throw ApiException.unauthorized('账号不存在')
      return buildUserInfo(ctx, user)
    },
  },
  {
    method: 'POST',
    path: '/auth/change-password',
    handler: async (ctx) => {
      const oldPassword = String(ctx.body?.oldPassword ?? '')
      const newPassword = requireString(ctx.body?.newPassword, '新密码', 64)
      const user = await ctx.db.get<{ passwordHash: string }>('SELECT password_hash AS passwordHash FROM sys_user WHERE id = ?', [
        ctx.user!.id,
      ])
      if (!user) throw ApiException.notFound('账号')
      if (!(await verifyPassword(oldPassword, user.passwordHash))) throw ApiException.param('原密码不正确')
      if (newPassword.length < 8 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
        throw ApiException.param('密码需至少 8 位且包含大小写字母与数字')
      }
      await ctx.db.update('sys_user', ctx.user!.id, { password_hash: await hashPassword(newPassword), updated_at: now(ctx.timeZone) })
      return { ok: true }
    },
  },
]

/** 供 index.ts 复用的鉴权辅助 */
export async function loadSession(env: { JWT_SECRET: string }, token: string | null): Promise<SessionUser | null> {
  if (!token) return null
  const payload = await verifyJwt(token, env.JWT_SECRET)
  if (!payload || payload.typ !== 'access') return null
  return {
    id: payload.sub,
    username: payload.username,
    realName: payload.realName,
    deptId: payload.deptId ?? null,
    roles: payload.roles ?? [],
    perms: payload.perms ?? [],
  }
}

export function hasAnyPerm(user: SessionUser | null, perms: string[]): boolean {
  if (!user) return false
  if (user.perms.includes('*')) return true
  return perms.some((p) => user.perms.includes(p))
}

export { PERM, optionalString }
