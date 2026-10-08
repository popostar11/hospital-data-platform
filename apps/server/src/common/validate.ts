import { ApiException } from './api'

/**
 * 轻量参数校验。
 *
 * 设计取舍：类型只在 @hospital/shared 定义一次，因此不引入 class-validator 的 DTO 类
 * （那会与 shared 类型形成第二份定义、容易漂移）。校验在这里显式表达，错误统一走 ApiException。
 */
export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw ApiException.param(message)
}

export function requiredString(value: unknown, field: string, max = 200): string {
  assert(typeof value === 'string' && value.trim().length > 0, `${field}不能为空`)
  const s = (value as string).trim()
  assert(s.length <= max, `${field}长度不能超过 ${max}`)
  return s
}

export function optionalString(value: unknown, field: string, max = 500): string | null {
  if (value === undefined || value === null || value === '') return null
  assert(typeof value === 'string', `${field}格式不正确`)
  const s = (value as string).trim()
  assert(s.length <= max, `${field}长度不能超过 ${max}`)
  return s === '' ? null : s
}

export function requiredNumber(value: unknown, field: string, min = -Infinity, max = Infinity): number {
  const n = Number(value)
  assert(Number.isFinite(n), `${field}必须是数字`)
  assert(n >= min && n <= max, `${field}必须在 ${min} ~ ${max} 之间`)
  return n
}

export function optionalNumber(value: unknown, field: string, min = -Infinity, max = Infinity): number | null {
  if (value === undefined || value === null || value === '') return null
  return requiredNumber(value, field, min, max)
}

export function optionalBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  throw ApiException.param(`${field}格式不正确`)
}

export function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  assert(typeof value === 'string' && (allowed as readonly string[]).includes(value), `${field}取值不合法`)
  return value as T
}

export function optionalEnumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T | null {
  if (value === undefined || value === null || value === '') return null
  return enumValue(value, allowed, field)
}

/** YYYY-MM-DD 或 YYYY-MM-DD HH:mm(:ss) */
export function optionalDateTime(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  assert(typeof value === 'string', `${field}格式不正确`)
  const s = (value as string).trim().replace('T', ' ')
  assert(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(s), `${field}格式应为 YYYY-MM-DD HH:mm`)
  return s.length === 10 ? `${s} 00:00:00` : s.length === 16 ? `${s}:00` : s
}

export function optionalDay(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), `${field}格式应为 YYYY-MM-DD`)
  return value
}

/** 取客户端 IP（兼容反向代理） */
export function clientIp(headers: Record<string, unknown>, socket?: { remoteAddress?: string }): string {
  const xff = headers['x-forwarded-for']
  if (typeof xff === 'string' && xff) return xff.split(',')[0]!.trim()
  return socket?.remoteAddress ?? ''
}
