/**
 * D1 数据访问层。
 *
 * 刻意与本地版 `apps/server/src/db/sqlite.ts` 保持**同名方法**（all/get/run/insert/update/scalar），
 * 这样两个后端里的 SQL 与业务写法几乎可以对照阅读，迁移时不必重新理解一套接口。
 * 差异只在：D1 是异步的，且没有交互式事务（用 batch 表达批量原子写）。
 */

export type SqlValue = string | number | null

export interface D1ResultMeta {
  last_row_id?: number
  changes?: number
}

export class Db {
  constructor(private readonly d1: D1Database) {}

  /** 归一化参数：D1 只接受 null / number / string / ArrayBuffer */
  private bind(stmt: D1PreparedStatement, params: unknown[]): D1PreparedStatement {
    const normalized = params.map((p) => {
      if (p === undefined || p === null) return null
      if (typeof p === 'boolean') return p ? 1 : 0
      if (p instanceof Date) return formatDateTime(p)
      if (typeof p === 'number' || typeof p === 'string') return p
      return String(p)
    })
    return normalized.length ? stmt.bind(...normalized) : stmt
  }

  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.bind(this.d1.prepare(sql), params).all<T>()
    return (res.results ?? []) as T[]
  }

  async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const row = await this.bind(this.d1.prepare(sql), params).first<T>()
    return (row ?? null) as T | null
  }

  /** 取第一行第一列 */
  async scalar<T extends SqlValue = number>(sql: string, params: unknown[] = []): Promise<T | null> {
    const row = await this.get<Record<string, T>>(sql, params)
    if (!row) return null
    const keys = Object.keys(row)
    return keys.length ? (row[keys[0]!] ?? null) : null
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastRowId: number }> {
    const res = await this.bind(this.d1.prepare(sql), params).run()
    const meta = (res.meta ?? {}) as D1ResultMeta
    return { changes: Number(meta.changes ?? 0), lastRowId: Number(meta.last_row_id ?? 0) }
  }

  async insert(table: string, data: Record<string, unknown>): Promise<number> {
    const keys = Object.keys(data)
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
    const r = await this.run(sql, keys.map((k) => data[k]))
    return r.lastRowId
  }

  async update(table: string, id: number, data: Record<string, unknown>): Promise<number> {
    const keys = Object.keys(data)
    if (!keys.length) return 0
    const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`
    const r = await this.run(sql, [...keys.map((k) => data[k]), id])
    return r.changes
  }

  /** 批量原子写（D1 batch 内部是事务） */
  async batch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
    if (!statements.length) return
    const prepared = statements.map((s) => this.bind(this.d1.prepare(s.sql), s.params ?? []))
    await this.d1.batch(prepared)
  }
}

export function formatDateTime(d: Date = new Date()): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 当前时间。统一用 UTC+8，避免 Worker 运行时区为 UTC 导致大屏时间差 8 小时 */
export function now(timeZone = 'Asia/Shanghai'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

/** 本机时区下用于 SQL 的“当前时间表达式”。D1 里 datetime('now') 是 UTC，必须显式换算 */
export const SQL_NOW_LOCAL = "datetime('now', '+8 hours')"
