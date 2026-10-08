import type {
  PageQuery,
  Paginated,
  PatientDetail,
  PatientListItem,
  PatientPlain,
  PatientSaveRequest,
} from '@hospital/shared'
import { get, post, put } from './client'

/** 患者列表查询条件 */
export interface PatientQuery extends PageQuery {
  keyword?: string
}

/** 患者分页列表（列表一律返回脱敏字段） */
export function listPatients(query: PatientQuery): Promise<Paginated<PatientListItem>> {
  return get<Paginated<PatientListItem>>('/patients', query)
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

/** 明文查看（需 patient:plain 权限，后端写审计日志） */
export function getPatientPlain(id: number): Promise<PatientPlain> {
  return get<PatientPlain>(`/patients/${id}/plain`)
}
