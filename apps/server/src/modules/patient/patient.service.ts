import { Injectable } from '@nestjs/common'
import {
  GENDER,
  calcAge,
  formatDate,
  genderLabel,
  maskIdCard,
  maskName,
  maskPhone,
  type GenderCode,
  type Paginated,
  type PatientDetail,
  type PatientImportResult,
  type PatientImportRow,
  type PatientListItem,
  type PatientListQuery,
  type PatientPlain,
  type PatientSaveRequest,
} from '@hospital/shared'
import { InjectDb } from '../../db/db.module'
import { now, type Db, type SqlValue } from '../../db/sqlite'
import { ApiException, orderBy, paging } from '../../common/api'
import { decrypt, encrypt } from '../../common/crypto'
import { optionalDay, optionalString, requiredNumber, requiredString } from '../../common/validate'

interface DictEntry {
  name: string
  color: string | null
}
type DictMap = Map<string, DictEntry>

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
  sourceType?: string | null
  statusCode?: string | null
  caseCreatedAt?: string | null
}

/** 患者 + 最近一条绿道病例：病例子查询只取每个患者的 MAX(id)，即最新一条 */
const LATEST_CASE_JOIN = /* sql */ `
  FROM patient p
  LEFT JOIN (
    SELECT patient_id, MAX(id) AS cid
      FROM green_channel_case
     WHERE deleted_at IS NULL
     GROUP BY patient_id
  ) l ON l.patient_id = p.id
  LEFT JOIN green_channel_case c ON c.id = l.cid
`

const SELECT_PATIENT = /* sql */ `
  SELECT p.id, p.mrn, p.name_masked AS nameMasked, p.gender, p.birth_date AS birthDate,
         p.id_card_masked AS idCardMasked, p.phone_masked AS phoneMasked, p.remark,
         p.created_at AS createdAt,
         (SELECT COUNT(*) FROM green_channel_case x WHERE x.patient_id = p.id AND x.deleted_at IS NULL) AS visitCount,
         c.id AS caseId, c.case_no AS caseNo, c.disease_code AS diseaseCode,
         c.source_type AS sourceType, c.status_code AS statusCode, c.created_at AS caseCreatedAt
`

/**
 * 患者服务。
 * 铁律：姓名/身份证/手机号 只以密文入库；对外只输出脱敏字段；
 * 明文读取单独授权并逐次写审计日志。
 */
@Injectable()
export class PatientService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** 排序白名单：对外字段名 → 带别名的 SQL 表达式（必须带别名，否则与病例表同名列歧义） */
  static readonly SORTABLE: Record<string, string> = {
    created_at: 'p.created_at',
    last_visit_at: 'COALESCE(c.created_at, p.created_at)',
    id: 'p.id',
    name_masked: 'p.name_masked',
  }

  /** 列表默认排序：最近有就诊的排前面，其次按建档时间 */
  private static readonly DEFAULT_ORDER = 'COALESCE(c.created_at, p.created_at) DESC, p.id DESC'

  page(query: PatientListQuery): Paginated<PatientListItem> {
    const { page, pageSize, offset } = paging(query)
    const { clause, params } = buildFilter(query)
    const total =
      this.db.scalar<number>(`SELECT COUNT(*) ${LATEST_CASE_JOIN} WHERE ${clause}`, params) ?? 0
    const order = orderBy(query.sort, PatientService.SORTABLE, PatientService.DEFAULT_ORDER)
    const rows = this.db.all<PatientRow>(
      `${SELECT_PATIENT} ${LATEST_CASE_JOIN} WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )
    const dicts = this.dicts()
    return { list: rows.map((r) => toListItem(r, dicts)), total, page, pageSize }
  }

  /** 导出用：与列表同样的筛选与排序，但不分页 */
  exportRows(query: PatientListQuery): PatientListItem[] {
    const { clause, params } = buildFilter(query)
    const rows = this.db.all<PatientRow>(
      `${SELECT_PATIENT} ${LATEST_CASE_JOIN} WHERE ${clause} ORDER BY ${PatientService.DEFAULT_ORDER}`,
      params,
    )
    const dicts = this.dicts()
    return rows.map((r) => toListItem(r, dicts))
  }

  /** 病例表单的远程搜索（不关联病例，字段保持全 null） */
  search(keyword: string, limit = 20): PatientListItem[] {
    const kw = (keyword ?? '').trim()
    const params: SqlValue[] = []
    let clause = 'p.deleted_at IS NULL'
    if (kw) {
      clause += ' AND (p.name_masked LIKE ? OR p.mrn LIKE ?)'
      params.push(`%${kw}%`, `%${kw}%`)
    }
    const rows = this.db.all<PatientRow>(
      `SELECT p.id, p.mrn, p.name_masked AS nameMasked, p.gender, p.birth_date AS birthDate,
              p.id_card_masked AS idCardMasked, p.phone_masked AS phoneMasked, p.remark,
              p.created_at AS createdAt, 0 AS visitCount
         FROM patient p WHERE ${clause} ORDER BY p.id DESC LIMIT ?`,
      [...params, Math.min(50, limit)],
    )
    return rows.map((r) => toListItem(r))
  }

  detail(id: number): PatientDetail {
    const row = this.db.get<PatientRow>(
      `${SELECT_PATIENT} ${LATEST_CASE_JOIN} WHERE p.id = ? AND p.deleted_at IS NULL`,
      [id],
    )
    if (!row) throw ApiException.notFound('患者')
    return { ...toListItem(row, this.dicts()), birthDate: row.birthDate, remark: row.remark }
  }

  /** 明文查看：需 patient:plain 权限，调用方负责写审计日志 */
  plain(id: number): PatientPlain {
    const row = this.db.get<{ id: number; nameCipher: string; idCardCipher: string | null; phoneCipher: string | null }>(
      'SELECT id, name_cipher AS nameCipher, id_card_cipher AS idCardCipher, phone_cipher AS phoneCipher FROM patient WHERE id = ? AND deleted_at IS NULL',
      [id],
    )
    if (!row) throw ApiException.notFound('患者')
    return { id: row.id, name: decrypt(row.nameCipher) ?? '—', idCard: decrypt(row.idCardCipher), phone: decrypt(row.phoneCipher) }
  }

  create(body: PatientSaveRequest): number {
    const name = requiredString(body.name, '姓名', 32)
    const gender = requiredNumber(body.gender, '性别', 1, 9) as GenderCode
    const mrn = optionalString(body.mrn, '病案号', 32)
    if (mrn) {
      const dup = this.db.get<{ id: number }>('SELECT id FROM patient WHERE mrn = ? AND deleted_at IS NULL', [mrn])
      if (dup) throw ApiException.conflict(`病案号 ${mrn} 已存在`)
    }
    const idCard = optionalString(body.idCard, '身份证号', 32)
    const phone = optionalString(body.phone, '手机号', 32)
    const ts = now()
    return this.db.insert('patient', {
      mrn,
      name_cipher: encrypt(name)!,
      name_masked: maskName(name),
      gender,
      birth_date: optionalDay(body.birthDate, '出生日期'),
      id_card_cipher: encrypt(idCard),
      id_card_masked: maskIdCard(idCard),
      phone_cipher: encrypt(phone),
      phone_masked: maskPhone(phone),
      remark: optionalString(body.remark, '备注', 200),
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    })
  }

  update(id: number, body: PatientSaveRequest): void {
    const exists = this.db.get<{ id: number }>('SELECT id FROM patient WHERE id = ? AND deleted_at IS NULL', [id])
    if (!exists) throw ApiException.notFound('患者')
    const data: Record<string, SqlValue> = { updated_at: now() }
    if (body.name !== undefined) {
      const name = requiredString(body.name, '姓名', 32)
      data.name_cipher = encrypt(name)
      data.name_masked = maskName(name)
    }
    if (body.gender !== undefined) data.gender = requiredNumber(body.gender, '性别', 1, 9)
    if (body.birthDate !== undefined) data.birth_date = optionalDay(body.birthDate, '出生日期')
    if (body.mrn !== undefined) data.mrn = optionalString(body.mrn, '病案号', 32)
    if (body.idCard !== undefined) {
      const idCard = optionalString(body.idCard, '身份证号', 32)
      data.id_card_cipher = encrypt(idCard)
      data.id_card_masked = maskIdCard(idCard)
    }
    if (body.phone !== undefined) {
      const phone = optionalString(body.phone, '手机号', 32)
      data.phone_cipher = encrypt(phone)
      data.phone_masked = maskPhone(phone)
    }
    if (body.remark !== undefined) data.remark = optionalString(body.remark, '备注', 200)
    this.db.update('patient', id, data)
  }

  /**
   * 批量导入。逐行创建，单行失败不影响其他行：
   *   - 病案号重复 → 计入 skipped
   *   - 姓名为空等参数问题 → 计入 errors（带行号，行号以表头为第 1 行计）
   */
  importRows(rows: PatientImportRow[]): PatientImportResult {
    const result: PatientImportResult = { total: rows.length, created: 0, skipped: 0, errors: [] }
    if (!Array.isArray(rows) || rows.length === 0) throw ApiException.param('导入内容为空')
    if (rows.length > 2000) throw ApiException.param('单次最多导入 2000 行')
    rows.forEach((row, index) => {
      const lineNo = index + 2
      try {
        this.create({
          name: row.name ?? '',
          gender: parseGender(row.gender),
          birthDate: row.birthDate ?? null,
          mrn: row.mrn ?? null,
          idCard: row.idCard ?? null,
          phone: row.phone ?? null,
          remark: row.remark ?? null,
        })
        result.created++
      } catch (err) {
        result.skipped++
        if (result.errors.length < 20) {
          result.errors.push({ row: lineNo, message: err instanceof Error ? err.message : String(err) })
        }
      }
    })
    return result
  }

  /** 单条删除：连同其绿道病例一起软删除（可追溯，物理记录保留） */
  remove(id: number): number {
    const exists = this.db.get<{ id: number }>('SELECT id FROM patient WHERE id = ? AND deleted_at IS NULL', [id])
    if (!exists) throw ApiException.notFound('患者')
    return this.softDelete([id])
  }

  /** 批量删除：返回实际删除的患者数 */
  removeMany(ids: number[]): number {
    if (!Array.isArray(ids) || ids.length === 0) throw ApiException.param('请选择要删除的患者')
    if (ids.length > 500) throw ApiException.param('单次最多删除 500 条')
    return this.softDelete(ids.map((i) => Number(i)).filter((i) => Number.isFinite(i) && i > 0))
  }

  private softDelete(ids: number[]): number {
    const ts = now()
    let deleted = 0
    for (const id of ids) {
      const hit = this.db.get<{ id: number }>('SELECT id FROM patient WHERE id = ? AND deleted_at IS NULL', [id])
      if (!hit) continue
      this.db.update('patient', id, { deleted_at: ts, updated_at: ts })
      this.db.run(
        'UPDATE green_channel_case SET deleted_at = ?, updated_at = ? WHERE patient_id = ? AND deleted_at IS NULL',
        [ts, ts, id],
      )
      deleted++
    }
    return deleted
  }

  /** 供病例模块使用：存在即返回，否则新建 */
  ensurePatient(body: PatientSaveRequest): number {
    return this.create(body)
  }

  exists(id: number): boolean {
    return !!this.db.get('SELECT id FROM patient WHERE id = ? AND deleted_at IS NULL', [id])
  }

  /** 一次取出三类字典，避免逐行查询 */
  private dicts(): { disease: DictMap; source: DictMap; status: DictMap } {
    const load = (type: string): DictMap => {
      const rows = this.db.all<{ code: string; name: string; color: string | null }>(
        'SELECT code, name, color FROM dict_item WHERE type = ?',
        [type],
      )
      return new Map(rows.map((r) => [r.code, { name: r.name, color: r.color }]))
    }
    return { disease: load('disease'), source: load('sourceType'), status: load('caseStatus') }
  }
}

/** 列表 / 导出的筛选条件（病例维度筛选隐含「必须有病例」，因此用 INNER 语义的等值条件） */
function buildFilter(query: PatientListQuery): { clause: string; params: SqlValue[] } {
  const where: string[] = ['p.deleted_at IS NULL']
  const params: SqlValue[] = []
  const keyword = (query.keyword ?? '').trim()
  if (keyword) {
    // 关键字三合一：姓名（脱敏值）/ 病案号 / 最近一条病例的绿道号
    where.push('(p.name_masked LIKE ? OR p.mrn LIKE ? OR c.case_no LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  if (query.diseaseCode) {
    where.push('c.disease_code = ?')
    params.push(query.diseaseCode)
  }
  if (query.statusCode) {
    where.push('c.status_code = ?')
    params.push(query.statusCode)
  }
  if (query.sourceType) {
    where.push('c.source_type = ?')
    params.push(query.sourceType)
  }
  return { clause: where.join(' AND '), params }
}

/** CSV 里的性别文本 → 性别码 */
function parseGender(value: unknown): GenderCode {
  const text = String(value ?? '').trim()
  if (text === '男' || text === '1' || text.toLowerCase() === 'male') return GENDER.MALE
  if (text === '女' || text === '2' || text.toLowerCase() === 'female') return GENDER.FEMALE
  return GENDER.UNKNOWN
}

function toListItem(
  row: PatientRow,
  dicts: { disease: DictMap; source: DictMap; status: DictMap } = {
    disease: new Map(),
    source: new Map(),
    status: new Map(),
  },
): PatientListItem {
  const disease = row.diseaseCode ? dicts.disease.get(row.diseaseCode) : undefined
  const source = row.sourceType ? dicts.source.get(row.sourceType) : undefined
  const status = row.statusCode ? dicts.status.get(row.statusCode) : undefined
  return {
    id: row.id,
    mrn: row.mrn,
    nameMasked: row.nameMasked,
    gender: row.gender as GenderCode,
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
    sourceType: row.sourceType ?? null,
    sourceTypeName: source?.name ?? row.sourceType ?? null,
    sourceColor: source?.color ?? null,
    statusCode: row.statusCode ?? null,
    statusName: status?.name ?? row.statusCode ?? null,
    statusColor: status?.color ?? null,
    lastVisitAt: row.caseCreatedAt ? formatDate(row.caseCreatedAt) : null,
  }
}
