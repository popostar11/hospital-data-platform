import { Injectable } from '@nestjs/common'
import type { Db } from '../db/sqlite'
import { InjectDb } from '../db/db.module'
import { now, v } from '../db/sqlite'
import type { PageQuery, Paginated } from '@hospital/shared'
import { paging } from '../common/api'

export interface OperLogInput {
  userId?: number | null
  userName?: string | null
  module: string
  action: string
  targetType?: string | null
  targetId?: string | number | null
  detail?: unknown
  ip?: string | null
  ua?: string | null
}

/**
 * 审计服务：登录、增删改、导出、明文查看、大屏配置变更全部入库（等保留存 ≥6 个月）。
 */
@Injectable()
export class AuditService {
  constructor(@InjectDb() private readonly db: Db) {}

  async log(input: OperLogInput): Promise<void> {
    this.db.insert('sys_oper_log', {
      user_id: v(input.userId),
      user_name: v(input.userName),
      module: input.module,
      action: input.action,
      target_type: v(input.targetType),
      target_id: v(input.targetId === undefined || input.targetId === null ? null : String(input.targetId)),
      detail: input.detail === undefined ? null : JSON.stringify(input.detail),
      ip: v(input.ip),
      ua: v(input.ua),
      created_at: now(),
    })
  }

  async login(input: { username: string; success: boolean; message?: string; ip?: string; ua?: string }): Promise<void> {
    this.db.insert('sys_login_log', {
      username: input.username,
      success: input.success ? 1 : 0,
      message: v(input.message),
      ip: v(input.ip),
      user_agent: v(input.ua),
      created_at: now(),
    })
  }

  pageOperLogs(query: PageQuery & { keyword?: string; module?: string; action?: string; from?: string; to?: string }): Paginated<unknown> {
    const { page, pageSize, offset } = paging(query)
    const where: string[] = ['1=1']
    const params: (string | number)[] = []
    if (query.keyword) {
      where.push('(user_name LIKE ? OR target_id LIKE ? OR detail LIKE ?)')
      params.push(`%${query.keyword}%`, `%${query.keyword}%`, `%${query.keyword}%`)
    }
    if (query.module) {
      where.push('module = ?')
      params.push(query.module)
    }
    if (query.action) {
      where.push('action = ?')
      params.push(query.action)
    }
    if (query.from) {
      where.push('created_at >= ?')
      params.push(`${query.from} 00:00:00`)
    }
    if (query.to) {
      where.push('created_at <= ?')
      params.push(`${query.to} 23:59:59`)
    }
    const clause = where.join(' AND ')
    const total = this.db.scalar<number>(`SELECT COUNT(*) FROM sys_oper_log WHERE ${clause}`, params) ?? 0
    const rows = this.db.all(
      `SELECT id, user_id AS userId, user_name AS userName, module, action,
              target_type AS targetType, target_id AS targetId, detail, ip, created_at AS createdAt
         FROM sys_oper_log WHERE ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )
    return { list: rows, total, page, pageSize }
  }

  pageLoginLogs(query: PageQuery & { keyword?: string; success?: boolean; from?: string; to?: string }): Paginated<unknown> {
    const { page, pageSize, offset } = paging(query)
    const where: string[] = ['1=1']
    const params: (string | number)[] = []
    if (query.keyword) {
      where.push('username LIKE ?')
      params.push(`%${query.keyword}%`)
    }
    if (query.success !== undefined && query.success !== null) {
      where.push('success = ?')
      params.push(query.success ? 1 : 0)
    }
    if (query.from) {
      where.push('created_at >= ?')
      params.push(`${query.from} 00:00:00`)
    }
    if (query.to) {
      where.push('created_at <= ?')
      params.push(`${query.to} 23:59:59`)
    }
    const clause = where.join(' AND ')
    const total = this.db.scalar<number>(`SELECT COUNT(*) FROM sys_login_log WHERE ${clause}`, params) ?? 0
    const rows = this.db.all(
      `SELECT id, username, success, message, ip, user_agent AS userAgent, created_at AS createdAt
         FROM sys_login_log WHERE ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )
    return { list: rows, total, page, pageSize }
  }
}
