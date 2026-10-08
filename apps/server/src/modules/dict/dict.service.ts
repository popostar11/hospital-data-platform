import { Injectable } from '@nestjs/common'
import type { DictItem } from '@hospital/shared'
import { InjectDb } from '../../db/db.module'
import { now, v, type Db, type SqlValue } from '../../db/sqlite'
import { ApiException } from '../../common/api'
import { enumValue, optionalBool, optionalNumber, optionalString, requiredString } from '../../common/validate'

export const DICT_TYPES = ['disease', 'sourceType', 'caseStatus', 'eventType'] as const
export type DictTypeCode = (typeof DICT_TYPES)[number]

export interface DictRow {
  id: number
  type: string
  code: string
  name: string
  color: string | null
  sortNo: number
  enabled: number
  remark: string | null
}

/**
 * 字典服务（大屏配色的事实来源）。
 * 带进程内缓存：大屏每次聚合都要取疾病名与颜色，避免高频查库；写操作即失效。
 */
@Injectable()
export class DictService {
  private readonly cache = new Map<string, DictRow[]>()

  constructor(@InjectDb() private readonly db: Db) {}

  list(type: string, includeDisabled = false): DictRow[] {
    if (!includeDisabled) {
      const hit = this.cache.get(type)
      if (hit) return hit
    }
    const rows = this.db.all<DictRow>(
      `SELECT id, type, code, name, color, sort_no AS sortNo, enabled, remark
         FROM dict_item WHERE type = ? ${includeDisabled ? '' : 'AND enabled = 1'}
        ORDER BY sort_no ASC, id ASC`,
      [type],
    )
    if (!includeDisabled) this.cache.set(type, rows)
    return rows
  }

  mapOf(type: string): Map<string, DictRow> {
    return new Map(this.list(type).map((r) => [r.code, r]))
  }

  nameOf(type: string, code: string | null | undefined): string {
    if (!code) return '—'
    return this.mapOf(type).get(code)?.name ?? code
  }

  colorOf(type: string, code: string | null | undefined): string | null {
    if (!code) return null
    return this.mapOf(type).get(code)?.color ?? null
  }

  invalidate(type?: string): void {
    if (type) this.cache.delete(type)
    else this.cache.clear()
  }

  /** 供前端表单一次性获取全部分类（大屏/病例表单） */
  all(): Record<string, DictItem[]> {
    const out: Record<string, DictItem[]> = {}
    for (const t of DICT_TYPES) out[t] = this.list(t) as unknown as DictItem[]
    return out
  }

  page(type?: string, includeDisabled = true): DictRow[] {
    if (type) return this.list(type, includeDisabled)
    return this.db.all<DictRow>(
      `SELECT id, type, code, name, color, sort_no AS sortNo, enabled, remark
         FROM dict_item ${includeDisabled ? '' : 'WHERE enabled = 1'}
        ORDER BY type ASC, sort_no ASC, id ASC`,
    )
  }

  create(body: Record<string, unknown>): DictRow {
    const type = enumValue(body.type, DICT_TYPES, '字典类型')
    const code = requiredString(body.code, '字典编码', 32)
    const name = requiredString(body.name, '字典名称', 64)
    const exists = this.db.get<{ id: number }>('SELECT id FROM dict_item WHERE type = ? AND code = ?', [type, code])
    if (exists) throw ApiException.conflict(`字典编码 ${code} 已存在`)
    const id = this.db.insert('dict_item', {
      type,
      code,
      name,
      color: optionalString(body.color, '颜色', 16),
      sort_no: optionalNumber(body.sortNo, '排序', 0, 9999) ?? 99,
      enabled: v(optionalBool(body.enabled, '启用状态') ?? true),
      remark: optionalString(body.remark, '备注', 200),
      created_at: now(),
      updated_at: now(),
    })
    this.invalidate(type)
    return this.getById(id)!
  }

  update(id: number, body: Record<string, unknown>): DictRow {
    const current = this.getById(id)
    if (!current) throw ApiException.notFound('字典项')
    const data: Record<string, SqlValue> = { updated_at: now() }
    if (body.name !== undefined) data.name = requiredString(body.name, '字典名称', 64)
    if (body.color !== undefined) data.color = optionalString(body.color, '颜色', 16)
    if (body.sortNo !== undefined) data.sort_no = optionalNumber(body.sortNo, '排序', 0, 9999) ?? 99
    if (body.enabled !== undefined) data.enabled = v(optionalBool(body.enabled, '启用状态'))
    if (body.remark !== undefined) data.remark = optionalString(body.remark, '备注', 200)
    this.db.update('dict_item', id, data)
    this.invalidate(current.type)
    return this.getById(id)!
  }

  remove(id: number): void {
    const current = this.getById(id)
    if (!current) throw ApiException.notFound('字典项')
    const refs = this.refCount(current.type, current.code)
    if (refs > 0) throw ApiException.conflict(`该字典项已被 ${refs} 条病例引用，无法删除，可改为停用`)
    this.db.run('DELETE FROM dict_item WHERE id = ?', [id])
    this.invalidate(current.type)
  }

  /** 引用计数：删除前提示，避免字典被删导致历史数据失去名称 */
  refCount(type: string, code: string): number {
    if (type === 'disease') {
      return this.db.scalar<number>('SELECT COUNT(*) FROM green_channel_case WHERE disease_code = ?', [code]) ?? 0
    }
    if (type === 'sourceType') {
      return this.db.scalar<number>('SELECT COUNT(*) FROM green_channel_case WHERE source_type = ?', [code]) ?? 0
    }
    if (type === 'caseStatus') {
      return this.db.scalar<number>('SELECT COUNT(*) FROM green_channel_case WHERE status_code = ?', [code]) ?? 0
    }
    if (type === 'eventType') {
      return this.db.scalar<number>('SELECT COUNT(*) FROM case_event WHERE event_code = ?', [code]) ?? 0
    }
    return 0
  }

  private getById(id: number): DictRow | null {
    return this.db.get<DictRow>(
      `SELECT id, type, code, name, color, sort_no AS sortNo, enabled, remark FROM dict_item WHERE id = ?`,
      [id],
    )
  }

  /** 给列表批量补充引用计数（字典管理页展示用） */
  withRefCount(rows: DictRow[]): (DictRow & { refCount: number })[] {
    return rows.map((r) => ({ ...r, refCount: this.refCount(r.type, r.code) }))
  }
}
