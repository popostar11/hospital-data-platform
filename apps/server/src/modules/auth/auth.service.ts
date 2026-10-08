import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { ERROR_CODE, type LoginResponse, type PermCode, type RoleCode, type UserInfo } from '@hospital/shared'
import { InjectDb } from '../../db/db.module'
import { now, type Db } from '../../db/sqlite'
import { ApiException } from '../../common/api'
import type { JwtPayload } from '../../common/auth'
import { config } from '../../config'
import { AuditService } from '../../core/audit.service'

interface UserRow {
  id: number
  username: string
  passwordHash: string
  realName: string
  deptId: number | null
  deptName: string | null
  enabled: number
}

/** 内存验证码（单实例部署足够；多实例时换 Redis，见方案 §3.3） */
const captchaStore = new Map<string, { code: string; expireAt: number }>()

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /* --------------------------------------------------------- 验证码 */

  captcha(): { enabled: boolean; captchaId?: string; svg?: string } {
    if (!config.captchaEnabled) return { enabled: false }
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXY3456789'
    let code = ''
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]
    const id = randomBytes(8).toString('hex')
    captchaStore.set(id, { code, expireAt: Date.now() + 5 * 60 * 1000 })
    // 清理过期项，避免内存无界增长
    for (const [k, v2] of captchaStore) if (v2.expireAt < Date.now()) captchaStore.delete(k)
    return { enabled: true, captchaId: id, svg: renderCaptchaSvg(code) }
  }

  /* ------------------------------------------------------------ 登录 */

  async login(input: { username: string; password: string; captchaId?: string; captchaCode?: string; ip?: string; ua?: string }): Promise<LoginResponse> {
    const { username, password } = input
    if (!username || !password) throw ApiException.param('用户名和密码不能为空')

    if (config.captchaEnabled) {
      const item = input.captchaId ? captchaStore.get(input.captchaId) : undefined
      if (!item || item.expireAt < Date.now()) throw ApiException.param('验证码已失效，请刷新')
      if (item.code.toLowerCase() !== String(input.captchaCode ?? '').toLowerCase()) throw ApiException.param('验证码错误')
      captchaStore.delete(input.captchaId!)
    }

    const attempt = this.db.get<{ failCount: number; lockedUntil: string | null }>(
      'SELECT fail_count AS failCount, locked_until AS lockedUntil FROM login_attempt WHERE username = ?',
      [username],
    )
    if (attempt?.lockedUntil && attempt.lockedUntil > now()) {
      await this.audit.login({ username, success: false, message: '账号锁定中', ip: input.ip, ua: input.ua })
      throw new ApiException(ERROR_CODE.TOO_MANY_REQUESTS, `账号已锁定，请于 ${attempt.lockedUntil} 后重试`)
    }

    const user = this.db.get<UserRow>(
      `SELECT u.id, u.username, u.password_hash AS passwordHash, u.real_name AS realName,
              u.dept_id AS deptId, d.name AS deptName, u.enabled
         FROM sys_user u LEFT JOIN department d ON d.id = u.dept_id
        WHERE u.username = ? AND u.deleted_at IS NULL`,
      [username],
    )

    const ok = user ? bcrypt.compareSync(password, user.passwordHash) : false
    if (!user || !ok || user.enabled !== 1) {
      this.recordFailure(username)
      await this.audit.login({
        username,
        success: false,
        message: !user ? '账号不存在' : user.enabled !== 1 ? '账号已停用' : '密码错误',
        ip: input.ip,
        ua: input.ua,
      })
      throw new ApiException(ERROR_CODE.UNAUTHORIZED, !user ? '账号或密码错误' : user.enabled !== 1 ? '账号已停用，请联系管理员' : '账号或密码错误')
    }

    this.db.run('DELETE FROM login_attempt WHERE username = ?', [username])
    this.db.update('sys_user', user.id, { last_login_at: now() })

    const info = this.buildUserInfo(user.id, user.username, user.realName, user.deptId, user.deptName)
    const result = this.issueTokens(info)
    await this.audit.login({ username, success: true, message: '登录成功', ip: input.ip, ua: input.ua })
    return result
  }

  async refresh(refreshToken: string): Promise<LoginResponse> {
    if (!refreshToken) throw ApiException.param('缺少刷新令牌')
    let payload: JwtPayload
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, { secret: config.jwtSecret })
    } catch {
      throw new ApiException(ERROR_CODE.TOKEN_EXPIRED, '登录已过期，请重新登录')
    }
    if (payload.typ !== 'refresh') throw new ApiException(ERROR_CODE.TOKEN_EXPIRED, '令牌类型不正确')
    const user = this.db.get<UserRow>(
      `SELECT u.id, u.username, u.password_hash AS passwordHash, u.real_name AS realName,
              u.dept_id AS deptId, d.name AS deptName, u.enabled
         FROM sys_user u LEFT JOIN department d ON d.id = u.dept_id
        WHERE u.id = ? AND u.deleted_at IS NULL`,
      [payload.sub],
    )
    if (!user || user.enabled !== 1) throw new ApiException(ERROR_CODE.UNAUTHORIZED, '账号不可用')
    const info = this.buildUserInfo(user.id, user.username, user.realName, user.deptId, user.deptName)
    return this.issueTokens(info)
  }

  me(userId: number): UserInfo {
    const user = this.db.get<UserRow>(
      `SELECT u.id, u.username, u.password_hash AS passwordHash, u.real_name AS realName,
              u.dept_id AS deptId, d.name AS deptName, u.enabled
         FROM sys_user u LEFT JOIN department d ON d.id = u.dept_id
        WHERE u.id = ? AND u.deleted_at IS NULL`,
      [userId],
    )
    if (!user) throw new ApiException(ERROR_CODE.UNAUTHORIZED, '账号不存在')
    return this.buildUserInfo(user.id, user.username, user.realName, user.deptId, user.deptName)
  }

  changePassword(userId: number, oldPassword: string, newPassword: string): void {
    const user = this.db.get<{ passwordHash: string }>('SELECT password_hash AS passwordHash FROM sys_user WHERE id = ?', [userId])
    if (!user) throw ApiException.notFound('账号')
    if (!bcrypt.compareSync(oldPassword ?? '', user.passwordHash)) throw ApiException.param('原密码不正确')
    this.assertPasswordStrength(newPassword)
    this.db.update('sys_user', userId, { password_hash: bcrypt.hashSync(newPassword, 10), updated_at: now() })
  }

  assertPasswordStrength(password: string): void {
    const pwd = String(password ?? '')
    if (pwd.length < 8) throw ApiException.param('密码长度至少 8 位')
    if (!/[a-z]/.test(pwd) || !/[A-Z]/.test(pwd) || !/\d/.test(pwd)) {
      throw ApiException.param('密码需同时包含大写字母、小写字母和数字')
    }
  }

  /* ------------------------------------------------------------ 内部 */

  private recordFailure(username: string): void {
    const row = this.db.get<{ failCount: number }>('SELECT fail_count AS failCount FROM login_attempt WHERE username = ?', [username])
    const failCount = (row?.failCount ?? 0) + 1
    let lockedUntil: string | null = null
    if (failCount >= config.loginMaxFail) {
      const d = new Date(Date.now() + config.loginLockMinutes * 60000)
      const p = (n: number) => String(n).padStart(2, '0')
      lockedUntil = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    }
    this.db.run(
      `INSERT INTO login_attempt (username, fail_count, locked_until) VALUES (?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET fail_count = excluded.fail_count, locked_until = excluded.locked_until`,
      [username, failCount, lockedUntil],
    )
  }

  private buildUserInfo(id: number, username: string, realName: string, deptId: number | null, deptName: string | null): UserInfo {
    const roleRows = this.db.all<{ code: string; name: string; perms: string }>(
      `SELECT r.code, r.name, r.perms FROM role r
         JOIN user_role ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.id`,
      [id],
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
      id,
      username,
      realName,
      deptId: deptId ?? null,
      deptName: deptName ?? null,
      roles: roleRows.map((r) => ({ code: r.code as RoleCode, name: r.name })),
      perms: (wildcard ? ['*'] : [...perms]) as PermCode[],
    }
  }

  private issueTokens(user: UserInfo): LoginResponse {
    const base = {
      sub: user.id,
      username: user.username,
      realName: user.realName,
      deptId: user.deptId,
      roles: user.roles.map((r) => r.code as string),
      perms: user.perms as string[],
    }
    const accessToken = this.jwt.sign({ ...base, typ: 'access' }, { secret: config.jwtSecret, expiresIn: config.jwtExpiresIn })
    const refreshToken = this.jwt.sign({ ...base, typ: 'refresh' }, { secret: config.jwtSecret, expiresIn: config.refreshExpiresIn })
    return { accessToken, refreshToken, expiresIn: config.jwtExpiresIn, user }
  }
}

/** 生成简单可读的 SVG 验证码（无第三方依赖） */
function renderCaptchaSvg(code: string): string {
  const width = 120
  const height = 40
  const colors = ['#1d5fbf', '#1f8f7a', '#a1551b', '#8a3fa0']
  const chars = code
    .split('')
    .map((c, i) => {
      const x = 16 + i * 26
      const y = 28 + (i % 2 === 0 ? -2 : 2)
      const rotate = (i % 2 === 0 ? -1 : 1) * (8 + i * 3)
      return `<text x="${x}" y="${y}" font-size="26" font-family="Arial,Helvetica,sans-serif" font-weight="bold" fill="${colors[i % colors.length]}" transform="rotate(${rotate} ${x} ${y})">${c}</text>`
    })
    .join('')
  const lines = [0, 1, 2, 3]
    .map((i) => {
      const y1 = 6 + i * 9
      const y2 = 34 - i * 5
      return `<line x1="0" y1="${y1}" x2="${width}" y2="${y2}" stroke="rgba(90,150,220,.45)" stroke-width="1"/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#eef4ff"/>${lines}${chars}</svg>`
}
