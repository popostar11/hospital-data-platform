/**
 * 脱敏与格式化工具。前后端共用；后端是脱敏的「唯一执行方」，前端只做兜底展示。
 */
import { GENDER_LABELS } from './enums.js'

/* -------------------------------------------------------------- 脱敏规则 */

/** 姓名脱敏：2 字 → 张*；3 字 → 张*明；≥4 字 → 欧*娜；英文 → A*** */
export function maskName(name: string | null | undefined): string {
  if (!name) return '—'
  const s = String(name).trim()
  if (!s) return '—'
  if (/^[A-Za-z]/.test(s)) return s[0]!.toUpperCase() + '***'
  const chars = Array.from(s)
  if (chars.length === 1) return chars[0]! + '*'
  if (chars.length === 2) return chars[0]! + '*'
  return chars[0]! + '*'.repeat(Math.max(1, chars.length - 2)) + chars[chars.length - 1]!
}

/** 身份证脱敏：保留前 1 后 1 */
export function maskIdCard(id: string | null | undefined): string | null {
  if (!id) return null
  const s = String(id).trim()
  if (s.length <= 2) return '*'.repeat(s.length)
  return s[0]! + '*'.repeat(s.length - 2) + s[s.length - 1]!
}

/** 手机号脱敏：保留前 3 后 4 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const s = String(phone).trim()
  if (s.length <= 7) return '*'.repeat(s.length)
  return s.slice(0, 3) + '*'.repeat(s.length - 7) + s.slice(-4)
}

/* ---------------------------------------------------------------- 格式化 */

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

function toDate(v: Date | string | number | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  // 兼容 'YYYY-MM-DD HH:mm:ss'（Safari 不认空格分隔）
  const s = String(v).trim().replace(' ', 'T')
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 轻量格式化：支持 YYYY MM DD HH mm ss */
export function formatDate(v: Date | string | number | null | undefined, pattern = 'YYYY-MM-DD HH:mm:ss'): string {
  const d = toDate(v)
  if (!d) return ''
  return pattern
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/MM/g, pad(d.getMonth() + 1))
    .replace(/DD/g, pad(d.getDate()))
    .replace(/HH/g, pad(d.getHours()))
    .replace(/mm/g, pad(d.getMinutes()))
    .replace(/ss/g, pad(d.getSeconds()))
}

export const WEEK_LABELS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

export function weekLabel(v: Date | string | number): string {
  const d = toDate(v)
  return d ? WEEK_LABELS[d.getDay()]! : ''
}

/** 大屏表格时间列：MM-DD HH:mm */
export function formatMonthDayMinute(v: Date | string | number): string {
  return formatDate(v, 'MM-DD HH:mm')
}

/** YYYY-MM-DD（本地时区） */
export function formatDay(v: Date | string | number): string {
  return formatDate(v, 'YYYY-MM-DD')
}

/** YYYY-MM（本地时区） */
export function formatMonth(v: Date | string | number): string {
  return formatDate(v, 'YYYY-MM')
}

export function genderLabel(g: number | null | undefined): string {
  return GENDER_LABELS[Number(g)] ?? '未知'
}

/** 分钟数转为可读时长：95 → 1小时35分 */
export function formatMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined || Number.isNaN(min)) return '—'
  const m = Math.round(Number(min))
  if (m < 60) return `${m}分钟`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}小时` : `${h}小时${rest}分`
}

/** 距离展示：2.12 → "2.12 km" */
export function formatDistance(km: number | null | undefined): string | null {
  if (km === null || km === undefined || Number.isNaN(Number(km))) return null
  return `${Number(km).toFixed(2)} km`
}

/** 数值千分位 */
export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('zh-CN')
}

/* --------------------------------------------------------------- 其他 */

/** 由出生日期算年龄（周岁） */
export function calcAge(birthDate: Date | string | null | undefined, at: Date = new Date()): number | null {
  const b = toDate(birthDate)
  if (!b) return null
  let age = at.getFullYear() - b.getFullYear()
  const m = at.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && at.getDate() < b.getDate())) age--
  return age >= 0 && age < 150 ? age : null
}

/** 生成近 N 个自然月的 YYYY-MM（含当月，升序） */
export function recentMonths(count: number, at: Date = new Date()): string[] {
  const out: string[] = []
  const y = at.getFullYear()
  const m = at.getMonth()
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y, m - i, 1)
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
  }
  return out
}

/** 两个时间相差的分钟数（保留 1 位） */
export function diffMinutes(from: Date | string, to: Date | string): number | null {
  const a = toDate(from)
  const b = toDate(to)
  if (!a || !b) return null
  return Math.round(((b.getTime() - a.getTime()) / 60000) * 10) / 10
}

export { toDate }
