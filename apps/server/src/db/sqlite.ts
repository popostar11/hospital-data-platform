import { DatabaseSync, type StatementSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as path from 'node:path'

export type SqlValue = string | number | bigint | null | Uint8Array
export type Row = Record<string, SqlValue>

/**
 * node:sqlite 的薄封装。
 *
 * 为什么不用 Prisma / better-sqlite3：
 *   - 零原生依赖、零引擎下载，内网/离线环境一定能装起来；
 *   - node:sqlite 自 Node 22.5 起内置，Node 24 可直接使用。
 * 生产切 MySQL 时只需替换本文件 + schema.sql（SQL 均为标准语法，见 docs/adr/001）。
 */
export class Db {
  private readonly raw: DatabaseSync
  private readonly cache = new Map<string, StatementSync>()

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
    this.raw = new DatabaseSync(file)
    this.raw.exec('PRAGMA journal_mode = WAL;')
    this.raw.exec('PRAGMA foreign_keys = ON;')
    this.raw.exec('PRAGMA busy_timeout = 8000;')
    this.raw.exec('PRAGMA synchronous = NORMAL;')
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql)
    if (!s) {
      s = this.raw.prepare(sql)
      this.cache.set(sql, s)
    }
    return s
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  all<T = Row>(sql: string, params: SqlValue[] = []): T[] {
    return this.stmt(sql).all(...params) as unknown as T[]
  }

  get<T = Row>(sql: string, params: SqlValue[] = []): T | null {
    const r = this.stmt(sql).get(...params)
    return (r as unknown as T) ?? null
  }

  /** 取第一行第一列 */
  scalar<T extends SqlValue = number>(sql: string, params: SqlValue[] = []): T | null {
    const row = this.get<Row>(sql, params)
    if (!row) return null
    const keys = Object.keys(row)
    return (keys.length ? (row[keys[0]!] as T) : null) ?? null
  }

  run(sql: string, params: SqlValue[] = []): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...params)
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
  }

  insert(table: string, data: Record<string, SqlValue>): number {
    const keys = Object.keys(data)
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
    return this.run(
      sql,
      keys.map((k) => data[k]!),
    ).lastInsertRowid
  }

  update(table: string, id: number, data: Record<string, SqlValue>): number {
    const keys = Object.keys(data)
    if (!keys.length) return 0
    const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`
    return this.run(
      sql,
      [...keys.map((k) => data[k]!), id],
    ).changes
  }

  /** 事务包装：抛错自动回滚 */
  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN')
    try {
      const r = fn()
      this.raw.exec('COMMIT')
      return r
    } catch (e) {
      try {
        this.raw.exec('ROLLBACK')
      } catch {
        /* ignore */
      }
      throw e
    }
  }

  close(): void {
    this.cache.clear()
    this.raw.close()
  }
}

/** JS 值归一化：node:sqlite 不接受 boolean / undefined */
export function v(input: unknown): SqlValue {
  if (input === undefined || input === null) return null
  if (typeof input === 'boolean') return input ? 1 : 0
  if (input instanceof Date) return formatDateTime(input)
  if (typeof input === 'number' || typeof input === 'bigint' || typeof input === 'string') return input
  if (input instanceof Uint8Array) return input
  return String(input)
}

/** 统一时间格式：YYYY-MM-DD HH:mm:ss（本地时区，字符串可直接比较排序） */
export function formatDateTime(d: Date = new Date()): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function now(): string {
  return formatDateTime(new Date())
}

/** 数据库当前时间（以 SQLite 本地时间为准，避免 Node 与 DB 时钟不一致） */
export function dbNow(db: Db): string {
  return String(db.scalar<string>("SELECT datetime('now','localtime')"))
}

export const toBool = (val: SqlValue): boolean => val === 1 || val === '1'
export const b = (val: boolean | undefined | null): SqlValue => (val === undefined || val === null ? null : val ? 1 : 0)
