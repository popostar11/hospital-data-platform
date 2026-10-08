/**
 * 统一响应体与错误处理（与本地 NestJS 版保持完全一致的契约）
 *
 * 契约见 docs/PLAN.md §6：{ code, message, data, traceId }，code=0 为成功，
 * 业务错误统一返回 HTTP 200 + 错误码，便于前端用同一套拦截器处理。
 */
import { ERROR_CODE, ERROR_MESSAGES } from '@hospital/shared'

export class ApiException extends Error {
  constructor(
    readonly code: number,
    message?: string,
  ) {
    super(message ?? ERROR_MESSAGES[code] ?? 'error')
  }

  static notFound(what = '数据') {
    return new ApiException(ERROR_CODE.NOT_FOUND, `${what}不存在或已被删除`)
  }
  static forbidden(detail?: string) {
    return new ApiException(ERROR_CODE.FORBIDDEN, detail)
  }
  static param(detail?: string) {
    return new ApiException(ERROR_CODE.PARAM_INVALID, detail)
  }
  static conflict(detail?: string) {
    return new ApiException(ERROR_CODE.CONFLICT, detail)
  }
  static unauthorized(detail?: string) {
    return new ApiException(ERROR_CODE.UNAUTHORIZED, detail)
  }
}

export interface Envelope<T> {
  code: number
  message: string
  data: T
  traceId: string
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // 演示接口：允许任意来源读取（大屏可能部署在不同域名下）
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type,x-trace-id',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
}

export function ok<T>(data: T, traceId: string): Response {
  const body: Envelope<T> = { code: ERROR_CODE.OK, message: 'ok', data, traceId }
  return new Response(JSON.stringify(body), { headers: JSON_HEADERS })
}

export function fail(err: unknown, traceId: string): Response {
  if (err instanceof ApiException) {
    const body: Envelope<null> = { code: err.code, message: err.message, data: null, traceId }
    return new Response(JSON.stringify(body), { headers: JSON_HEADERS })
  }
  const message = err instanceof Error ? err.message : String(err)
  // 未预期异常：打日志便于在 wrangler tail 里定位
  console.error(`[${traceId}] 未处理异常:`, message, err instanceof Error ? err.stack : '')
  const body: Envelope<null> = { code: ERROR_CODE.INTERNAL_ERROR, message: ERROR_MESSAGES[ERROR_CODE.INTERNAL_ERROR]!, data: null, traceId }
  return new Response(JSON.stringify(body), { headers: JSON_HEADERS })
}

export function newTraceId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* ------------------------------------------------------------ 参数处理 */

export function paging(query: URLSearchParams): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Number(query.get('page')) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.get('pageSize')) || 20))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

/**
 * 排序白名单：对外字段名 → 带表别名的 SQL 表达式。
 * 必须带别名，否则 JOIN 后同名列（如 patient.created_at）会 ambiguous。
 */
export function orderBy(sort: string | null, allowed: Record<string, string>, fallback: string): string {
  const [field, dir] = String(sort ?? '').split(':')
  const expr = field ? allowed[field] : undefined
  if (!expr) return fallback
  return `${expr} ${String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'}`
}

export function requireString(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim()) throw ApiException.param(`${field}不能为空`)
  const s = value.trim()
  if (s.length > max) throw ApiException.param(`${field}长度不能超过 ${max}`)
  return s
}

export function optionalString(value: unknown, field: string, max = 500): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw ApiException.param(`${field}格式不正确`)
  const s = value.trim()
  if (s.length > max) throw ApiException.param(`${field}长度不能超过 ${max}`)
  return s === '' ? null : s
}

export function optionalNumber(value: unknown, field: string, min = -Infinity, max = Infinity): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) throw ApiException.param(`${field}必须是数字`)
  if (n < min || n > max) throw ApiException.param(`${field}必须在 ${min} ~ ${max} 之间`)
  return n
}

export function optionalBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return undefined
}

/** YYYY-MM-DD 或 YYYY-MM-DD HH:mm(:ss) → 归一化为 'YYYY-MM-DD HH:mm:ss' */
export function optionalDateTime(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw ApiException.param(`${field}格式不正确`)
  const s = value.trim().replace('T', ' ')
  if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(s)) throw ApiException.param(`${field}格式应为 YYYY-MM-DD HH:mm`)
  if (s.length === 10) return `${s} 00:00:00`
  return s.length === 16 ? `${s}:00` : s
}

export function optionalDay(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw ApiException.param(`${field}格式应为 YYYY-MM-DD`)
  return value
}
