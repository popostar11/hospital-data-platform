import type { AxiosResponse } from 'axios'
import type {
  CaseCloseRequest,
  CaseDetail,
  CaseEventSaveRequest,
  CaseImportResult,
  CaseImportRow,
  CaseListItem,
  CaseQuery,
  CaseSaveRequest,
  DepartmentNode,
  DictItem,
  Paginated,
} from '@hospital/shared'
import { del, download, get, post, put } from './client'

/** 病例表单下拉元数据：一次拿全（shared 未定义，按后端契约在此补充） */
export interface CaseMeta {
  diseases: DictItem[]
  sourceTypes: DictItem[]
  caseStatuses: DictItem[]
  eventTypes: DictItem[]
  departments: DepartmentNode[]
}

/** 病例分页列表 */
export function listCases(query: CaseQuery): Promise<Paginated<CaseListItem>> {
  return get<Paginated<CaseListItem>>('/cases', query)
}

/** 表单下拉字典（疾病 / 推送方式 / 状态 / 事件类型 / 科室树） */
export function caseMeta(): Promise<CaseMeta> {
  return get<CaseMeta>('/cases/meta')
}

/** 病例详情（含时间轴、附件） */
export function getCase(id: number): Promise<CaseDetail> {
  return get<CaseDetail>(`/cases/${id}`)
}

/** 新增病例 */
export function createCase(payload: CaseSaveRequest): Promise<{ id: number }> {
  return post<{ id: number }>('/cases', payload)
}

/** 编辑病例 */
export function updateCase(id: number, payload: CaseSaveRequest): Promise<void> {
  return put<void>(`/cases/${id}`, payload)
}

/** 删除病例（后端软删除） */
export function removeCase(id: number): Promise<void> {
  return del<void>(`/cases/${id}`)
}

/** 补录时间节点 */
export function addCaseEvent(id: number, payload: CaseEventSaveRequest): Promise<void> {
  return post<void>(`/cases/${id}/events`, payload)
}

/** 闭环 */
export function closeCase(id: number, payload: CaseCloseRequest): Promise<void> {
  return post<void>(`/cases/${id}/close`, payload)
}

/** 导出 xlsx（二进制，绕过统一响应包装） */
export function exportCases(query: CaseQuery): Promise<AxiosResponse<Blob>> {
  const params: Record<string, unknown> = { ...query }
  delete params.page
  delete params.pageSize
  delete params.sort
  return download('/cases/export', params)
}

/** 批量导入病例（每行新建患者 + 一条病例；疾病/推送方式可填中文名） */
export function importCases(rows: CaseImportRow[]): Promise<CaseImportResult> {
  return post<CaseImportResult>('/cases/import', { rows })
}

/** 批量删除病例（软删除） */
export function batchDeleteCases(ids: number[]): Promise<{ deleted: number }> {
  return post<{ deleted: number }>('/cases/batch-delete', { ids })
}
