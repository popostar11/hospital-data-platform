import type { DictItem, DictSaveRequest, DictType } from '@hospital/shared'
import { del, get, post, put } from './client'

/** 按类型查询字典（disease / sourceType / caseStatus / eventType） */
export function listDicts(type: DictType): Promise<DictItem[]> {
  return get<DictItem[]>('/dicts', { type })
}

/** 新增字典项 */
export function createDict(payload: DictSaveRequest): Promise<{ id: number }> {
  return post<{ id: number }>('/dicts', payload)
}

/** 编辑字典项 */
export function updateDict(id: number, payload: DictSaveRequest): Promise<void> {
  return put<void>(`/dicts/${id}`, payload)
}

/** 删除字典项（被引用时后端返回冲突码） */
export function removeDict(id: number): Promise<void> {
  return del<void>(`/dicts/${id}`)
}
