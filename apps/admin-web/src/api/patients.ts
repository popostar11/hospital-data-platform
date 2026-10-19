import type { AxiosResponse } from 'axios'
import type {
  Paginated,
  PatientDetail,
  PatientImportResult,
  PatientImportRow,
  PatientListItem,
  PatientListQuery,
  PatientPlain,
  PatientSaveRequest,
} from '@hospital/shared'
import { del, download, get, post, put } from './client'

/** 患者列表查询条件（含疾病 / 状态 / 推送方式三个筛选） */
export type PatientQuery = PatientListQuery

/** 患者分页列表（每行附带最近一条绿道病例的拍平字段） */
export function listPatients(query: PatientQuery): Promise<Paginated<PatientListItem>> {
  return get<Paginated<PatientListItem>>('/patients', query)
}

/** 导出 CSV（筛选条件与列表一致） */
export function exportPatients(query: PatientQuery): Promise<AxiosResponse<Blob>> {
  const params: Record<string, unknown> = { ...query }
  delete params.page
  delete params.pageSize
  delete params.sort
  return download('/patients/export', params)
}

/** 批量导入：前端把 CSV 解析成行后提交 */
export function importPatients(rows: PatientImportRow[]): Promise<PatientImportResult> {
  return post<PatientImportResult>('/patients/import', { rows })
}

/** 批量删除（连同各自病例一起软删除） */
export function batchDeletePatients(ids: number[]): Promise<{ deleted: number }> {
  return post<{ deleted: number }>('/patients/batch-delete', { ids })
}

/** 病例表单里远程搜索患者 */
export function searchPatients(keyword: string): Promise<PatientListItem[]> {
  return get<PatientListItem[]>('/patients/search', { keyword })
}

/** 患者详情 */
export function getPatient(id: number): Promise<PatientDetail> {
  return get<PatientDetail>(`/patients/${id}`)
}

/** 新增患者 */
export function createPatient(payload: PatientSaveRequest): Promise<{ id: number }> {
  return post<{ id: number }>('/patients', payload)
}

/** 编辑患者 */
export function updatePatient(id: number, payload: PatientSaveRequest): Promise<void> {
  return put<void>(`/patients/${id}`, payload)
}

/** 删除患者（软删除，连同其绿道病例） */
export function removePatient(id: number): Promise<{ id: number }> {
  return del<{ id: number }>(`/patients/${id}`)
}

/** 明文查看（需 patient:plain 权限，后端写审计日志） */
export function getPatientPlain(id: number): Promise<PatientPlain> {
  return get<PatientPlain>(`/patients/${id}/plain`)
}
