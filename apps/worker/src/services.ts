/**
 * 领域辅助：字典查询与行 → DTO 映射。
 * SQL 与本地 NestJS 版的 service 一一对应，便于对照排查。
 */
import { calcAge, formatDate, formatMonthDayMinute, genderLabel } from '@hospital/shared'
import type { CaseListItem, PatientListItem, ScreenTableRow } from '@hospital/shared'
import type { Db } from './db'
import { formatDateTime } from './db'
import { ApiException } from './http'

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

const SELECT_DICT = `SELECT id, type, code, name, color, sort_no AS sortNo, enabled, remark FROM dict_item`

/**
 * 字典访问器（请求级缓存）。
 * Workers 每次请求可能是新的 isolate，因此不做跨请求缓存；
 * 单次请求内缓存已足够（大屏一次聚合要多次用到疾病名称与配色）。
 */
export class Dicts {
  private readonly cache = new Map<string, Map<string, DictRow>>()

  constructor(private readonly db: Db) {}

  async mapOf(type: string): Promise<Map<string, DictRow>> {
    const hit = this.cache.get(type)
    if (hit) return hit
    const rows = await this.db.all<DictRow>(
      `${SELECT_DICT} WHERE type = ? AND enabled = 1 ORDER BY sort_no ASC, id ASC`,
      [type],
    )
    const map = new Map(rows.map((r) => [r.code, r]))
    this.cache.set(type, map)
    return map
  }

  async list(type: string, includeDisabled = false): Promise<DictRow[]> {
    return this.db.all<DictRow>(
      `${SELECT_DICT} WHERE type = ?${includeDisabled ? '' : ' AND enabled = 1'} ORDER BY sort_no ASC, id ASC`,
      [type],
    )
  }

  async all(includeDisabled = false): Promise<Record<string, DictRow[]>> {
    const rows = await this.db.all<DictRow>(
      `${SELECT_DICT}${includeDisabled ? '' : ' WHERE enabled = 1'} ORDER BY type ASC, sort_no ASC, id ASC`,
    )
    const out: Record<string, DictRow[]> = {}
    for (const r of rows) (out[r.type] ??= []).push(r)
    return out
  }
}

/* ------------------------------------------------------------ 病例行映射 */

export interface CaseRow {
  id: number
  caseNo: string
  patientId: number
  patientName: string
  gender: number
  birthDate: string | null
  mrn: string | null
  idCardMasked: string | null
  phoneMasked: string | null
  diseaseCode: string
  sourceType: string
  statusCode: string
  distanceKm: number | null
  deptId: number | null
  deptName: string | null
  isClosed: number
  closedAt: string | null
  createdAt: string
  updatedAt: string
  remark: string | null
}

export const SELECT_CASE = /* sql */ `
  SELECT c.id, c.case_no AS caseNo, c.patient_id AS patientId,
         p.name_masked AS patientName, p.gender, p.birth_date AS birthDate, p.mrn,
         p.id_card_masked AS idCardMasked, p.phone_masked AS phoneMasked,
         c.disease_code AS diseaseCode, c.source_type AS sourceType, c.status_code AS statusCode,
         c.distance_km AS distanceKm, c.dept_id AS deptId, d.name AS deptName,
         c.is_closed AS isClosed, c.closed_at AS closedAt, c.created_at AS createdAt,
         c.updated_at AS updatedAt, c.remark
    FROM green_channel_case c
    JOIN patient p ON p.id = c.patient_id
    LEFT JOIN department d ON d.id = c.dept_id
`

export async function toCaseListItem(dicts: Dicts, row: CaseRow): Promise<CaseListItem> {
  const disease = (await dicts.mapOf('disease')).get(row.diseaseCode)
  const source = (await dicts.mapOf('sourceType')).get(row.sourceType)
  const status = (await dicts.mapOf('caseStatus')).get(row.statusCode)
  return {
    id: row.id,
    caseNo: row.caseNo,
    patientId: row.patientId,
    patientName: row.patientName,
    genderName: genderLabel(row.gender),
    age: calcAge(row.birthDate),
    diseaseCode: row.diseaseCode as CaseListItem['diseaseCode'],
    diseaseName: disease?.name ?? row.diseaseCode,
    diseaseColor: disease?.color ?? '#4FA8FF',
    sourceType: row.sourceType as CaseListItem['sourceType'],
    sourceTypeName: source?.name ?? row.sourceType,
    statusCode: row.statusCode as CaseListItem['statusCode'],
    statusName: status?.name ?? row.statusCode,
    statusColor: status?.color ?? '#18C8FF',
    distanceKm: row.distanceKm,
    deptId: row.deptId,
    deptName: row.deptName,
    isClosed: row.isClosed === 1,
    closedAt: row.closedAt ? formatDate(row.closedAt) : null,
    createdAt: formatDate(row.createdAt),
    updatedAt: formatDate(row.updatedAt),
    remark: row.remark,
  }
}

export async function toScreenRow(dicts: Dicts, row: CaseRow): Promise<ScreenTableRow> {
  const item = await toCaseListItem(dicts, row)
  return {
    id: item.id,
    caseNo: item.caseNo,
    name: item.patientName,
    gender: item.genderName,
    age: item.age,
    diseaseCode: item.diseaseCode,
    diseaseName: item.diseaseName,
    diseaseColor: item.diseaseColor,
    time: formatMonthDayMinute(item.createdAt),
    createdAt: item.createdAt,
    sourceType: item.sourceType,
    sourceTypeName: item.sourceTypeName,
    distance: item.distanceKm === null || item.distanceKm === undefined ? null : `${Number(item.distanceKm).toFixed(2)} km`,
    statusCode: item.statusCode,
    statusName: item.statusName,
    statusColor: item.statusColor,
  }
}

/* ------------------------------------------------------------ 患者行映射 */

interface PatientRow {
  id: number
  mrn: string | null
  nameMasked: string
  gender: number
  birthDate: string | null
  idCardMasked: string | null
  phoneMasked: string | null
  remark: string | null
  visitCount: number
  createdAt: string
  /* 关联出来的最近一条病例（无病例时为 null） */
  caseId?: number | null
  caseNo?: string | null
  diseaseCode?: string | null
  deptId?: number | null
  deptName?: string | null
  sourceType?: string | null
  statusCode?: string | null
  caseCreatedAt?: string | null
}

/**
 * 患者 + 最近一条绿道病例。
 * 病例子查询只取每个患者的 MAX(id)（最新一条），患者管理列表直接消费这些拍平字段。
 */
export const SELECT_PATIENT = /* sql */ `
  SELECT p.id, p.mrn, p.name_masked AS nameMasked, p.gender, p.birth_date AS birthDate,
         p.id_card_masked AS idCardMasked, p.phone_masked AS phoneMasked, p.remark,
         p.created_at AS createdAt,
         (SELECT COUNT(*) FROM green_channel_case x WHERE x.patient_id = p.id AND x.deleted_at IS NULL) AS visitCount,
         c.id AS caseId, c.case_no AS caseNo, c.disease_code AS diseaseCode,
         c.dept_id AS deptId, d.name AS deptName,
         c.source_type AS sourceType, c.status_code AS statusCode, c.created_at AS caseCreatedAt
    FROM patient p
    LEFT JOIN (
      SELECT patient_id, MAX(id) AS cid
        FROM green_channel_case
       WHERE deleted_at IS NULL
       GROUP BY patient_id
    ) l ON l.patient_id = p.id
    LEFT JOIN green_channel_case c ON c.id = l.cid
    LEFT JOIN department d ON d.id = c.dept_id
`

export interface PatientDicts {
  disease?: Map<string, DictRow>
  source?: Map<string, DictRow>
  status?: Map<string, DictRow>
}

export function toPatientListItem(row: PatientRow, dicts: PatientDicts = {}): PatientListItem {
  const disease = row.diseaseCode ? dicts.disease?.get(row.diseaseCode) : undefined
  const source = row.sourceType ? dicts.source?.get(row.sourceType) : undefined
  const status = row.statusCode ? dicts.status?.get(row.statusCode) : undefined
  return {
    id: row.id,
    mrn: row.mrn,
    nameMasked: row.nameMasked,
    gender: row.gender as PatientListItem['gender'],
    genderName: genderLabel(row.gender),
    age: calcAge(row.birthDate),
    phoneMasked: row.phoneMasked,
    idCardMasked: row.idCardMasked,
    visitCount: row.visitCount ?? 0,
    createdAt: formatDate(row.createdAt),
    remark: row.remark,
    lastCaseId: row.caseId ?? null,
    lastCaseNo: row.caseNo ?? null,
    diseaseCode: row.diseaseCode ?? null,
    diseaseName: disease?.name ?? row.diseaseCode ?? null,
    diseaseColor: disease?.color ?? null,
    deptId: row.deptId ?? null,
    deptName: row.deptName ?? null,
    sourceType: row.sourceType ?? null,
    sourceTypeName: source?.name ?? row.sourceType ?? null,
    sourceColor: source?.color ?? null,
    statusCode: row.statusCode ?? null,
    statusName: status?.name ?? row.statusCode ?? null,
    statusColor: status?.color ?? null,
    lastVisitAt: row.caseCreatedAt ? formatDate(row.caseCreatedAt) : null,
  }
}

/* ------------------------------------------------------------------ 其它 */

/** 患者姓名脱敏（云版不保存明文，因此新建患者时直接落脱敏姓名） */
export function maskNameOnly(name: string): string {
  const s = String(name ?? '').trim()
  if (!s) throw ApiException.param('姓名不能为空')
  if (/^[A-Za-z]/.test(s)) return s[0]!.toUpperCase() + '***'
  const chars = Array.from(s)
  if (chars.length === 1) return `${chars[0]}*`
  if (chars.length === 2) return `${chars[0]}*`
  return `${chars[0]}${'*'.repeat(Math.max(1, chars.length - 2))}${chars[chars.length - 1]}`
}

/** 病例编号：LD + YYYYMMDD + 4 位流水 */
export async function nextCaseNo(db: Db, createdAt: string): Promise<string> {
  const prefix = `LD${createdAt.slice(0, 10).replace(/-/g, '')}`
  const count = (await db.scalar<number>('SELECT COUNT(*) FROM green_channel_case WHERE case_no LIKE ?', [`${prefix}%`])) ?? 0
  let seq = count + 1
  let caseNo = `${prefix}${String(seq).padStart(4, '0')}`
  while (await db.get('SELECT id FROM green_channel_case WHERE case_no = ?', [caseNo])) {
    seq += 1
    caseNo = `${prefix}${String(seq).padStart(4, '0')}`
  }
  return caseNo
}

export { formatDateTime }
