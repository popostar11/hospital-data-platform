import { Injectable } from '@nestjs/common'
import {
  EVENT_SEEDS,
  GENDER,
  diffMinutes,
  formatDate,
  genderLabel,
  calcAge,
  type CaseDetail,
  type CaseEventItem,
  type CaseEventSaveRequest,
  type CaseImportResult,
  type CaseImportRow,
  type CaseListItem,
  type CaseQuery,
  type CaseSaveRequest,
  type DictItem,
  type EventCode,
  type GenderCode,
  type Paginated,
  type SourceType,
} from '@hospital/shared'
import { InjectDb } from '../../db/db.module'
import { now, type Db, type SqlValue } from '../../db/sqlite'
import { ApiException, orderBy, paging } from '../../common/api'
import { optionalDateTime, optionalNumber, optionalString, requiredString, enumValue } from '../../common/validate'
import { DictService } from '../dict/dict.service'
import { PatientService } from '../patient/patient.service'
import { SOURCE_TYPE, CASE_STATUS as STATUS } from '@hospital/shared'

interface CaseRow {
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

const SELECT_CASE = /* sql */ `
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

@Injectable()
export class CaseService {
  /** 排序白名单：对外字段名 → 带别名的 SQL 表达式（避免 JOIN 后列名歧义） */
  static readonly SORTABLE: Record<string, string> = {
    created_at: 'c.created_at',
    updated_at: 'c.updated_at',
    closed_at: 'c.closed_at',
    id: 'c.id',
    distance_km: 'c.distance_km',
  }

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly dict: DictService,
    private readonly patients: PatientService,
  ) {}

  /* --------------------------------------------------------------- 查询 */

  page(query: CaseQuery): Paginated<CaseListItem> {
    const { page, pageSize, offset } = paging(query)
    const { clause, params } = this.buildFilter(query)
    const total = this.db.scalar<number>(`SELECT COUNT(*) FROM green_channel_case c JOIN patient p ON p.id = c.patient_id WHERE ${clause}`, params) ?? 0
    const order = orderBy(query.sort, CaseService.SORTABLE, 'c.created_at DESC')
    const rows = this.db.all<CaseRow>(
      `${SELECT_CASE} WHERE ${clause} ORDER BY ${order}, c.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )
    return { list: rows.map((r) => this.toListItem(r)), total, page, pageSize }
  }

  /** 导出用：不分页，但限制上限防止拖垮内存 */
  exportRows(query: CaseQuery, limit = 20000): CaseListItem[] {
    const { clause, params } = this.buildFilter(query)
    const order = orderBy(query.sort, CaseService.SORTABLE, 'c.created_at DESC')
    const rows = this.db.all<CaseRow>(`${SELECT_CASE} WHERE ${clause} ORDER BY ${order} LIMIT ?`, [...params, limit])
    return rows.map((r) => this.toListItem(r))
  }

  detail(id: number): CaseDetail {
    const row = this.db.get<CaseRow>(`${SELECT_CASE} WHERE c.id = ? AND c.deleted_at IS NULL`, [id])
    if (!row) throw ApiException.notFound('绿道病例')
    const base = this.toListItem(row)
    const events = this.listEvents(id)
    const attachments = this.db.all<{ id: number; fileName: string; fileSize: number; uploadedAt: string }>(
      `SELECT id, file_name AS fileName, file_size AS fileSize, created_at AS uploadedAt
         FROM case_attachment WHERE case_id = ? ORDER BY id DESC`,
      [id],
    )
    return {
      ...base,
      patient: {
        id: row.patientId,
        mrn: row.mrn,
        nameMasked: row.patientName,
        gender: row.gender as never,
        genderName: genderLabel(row.gender),
        age: calcAge(row.birthDate),
        phoneMasked: row.phoneMasked,
        idCardMasked: row.idCardMasked,
        visitCount: 0,
        createdAt: formatDate(row.createdAt),
        // 病例详情里的患者是从本病例反查出来的，不带「最近一条病例」的信息
        remark: null,
        lastCaseId: null,
        lastCaseNo: null,
        diseaseCode: null,
        diseaseName: null,
        diseaseColor: null,
        deptId: null,
        deptName: null,
        sourceType: null,
        sourceTypeName: null,
        sourceColor: null,
        statusCode: null,
        statusName: null,
        statusColor: null,
        lastVisitAt: null,
      },
      events,
      responseMinutes: computeResponseMinutes(events),
      attachments: attachments.map((a) => ({
        ...a,
        fileSize: a.fileSize,
        uploadedAt: formatDate(a.uploadedAt),
        url: `/api/v1/cases/attachments/${a.id}/download`,
      })),
    }
  }

  listEvents(caseId: number): CaseEventItem[] {
    const rows = this.db.all<{ id: number; eventCode: string; eventAt: string; remark: string | null; operatorName: string | null }>(
      `SELECT e.id, e.event_code AS eventCode, e.event_at AS eventAt, e.remark,
              u.real_name AS operatorName
         FROM case_event e LEFT JOIN sys_user u ON u.id = e.operator_id
        WHERE e.case_id = ? ORDER BY e.event_at ASC, e.id ASC`,
      [caseId],
    )
    const eventDict = this.dict.mapOf('eventType')
    const limits = new Map(EVENT_SEEDS.map((e) => [e.code as string, e.limitMinutes]))
    let prev: string | null = null
    return rows.map((r) => {
      const gap = prev ? diffMinutes(prev, r.eventAt) : null
      const limit = limits.get(r.eventCode) ?? null
      prev = r.eventAt
      return {
        id: r.id,
        eventCode: r.eventCode as EventCode,
        eventName: eventDict.get(r.eventCode)?.name ?? EVENT_SEEDS.find((e) => e.code === r.eventCode)?.name ?? r.eventCode,
        eventAt: formatDate(r.eventAt),
        operatorName: r.operatorName,
        remark: r.remark,
        gapMinutes: gap,
        overtime: gap !== null && limit !== null && gap > limit,
      }
    })
  }

  /** 表单元数据：一次拿全下拉选项，避免前端多次请求 */
  meta(): {
    diseases: DictItem[]
    sourceTypes: DictItem[]
    caseStatuses: DictItem[]
    eventTypes: DictItem[]
    departments: { id: number; parentId: number | null; code: string; name: string; children?: unknown[] }[]
  } {
    const all = this.dict.all()
    const departments = this.db.all<{ id: number; parentId: number | null; code: string; name: string }>(
      `SELECT id, parent_id AS parentId, code, name FROM department WHERE enabled = 1 ORDER BY sort_no ASC, id ASC`,
    )
    return {
      diseases: all.disease ?? [],
      sourceTypes: all.sourceType ?? [],
      caseStatuses: all.caseStatus ?? [],
      eventTypes: all.eventType ?? [],
      departments,
    }
  }

  /* --------------------------------------------------------------- 写入 */

  create(body: CaseSaveRequest, operatorId: number | null): number {
    const diseaseCode = requiredString(body.diseaseCode, '疾病类型', 32)
    const sourceType = enumValue(body.sourceType, Object.values(SOURCE_TYPE), '推送方式')
    const statusCode = body.statusCode
      ? enumValue(body.statusCode, Object.values(STATUS), '病例状态')
      : STATUS.CREATED
    const patientId = this.resolvePatient(body)
    const createdAt = optionalDateTime(body.createdAt, '创建时间') ?? now()
    const caseNo = this.nextCaseNo(createdAt)
    const status = statusCode as string
    const isClosed = status === STATUS.CLOSED ? 1 : 0
    const id = this.db.insert('green_channel_case', {
      case_no: caseNo,
      patient_id: patientId,
      dept_id: optionalNumber(body.deptId, '科室'),
      disease_code: diseaseCode,
      source_type: sourceType,
      status_code: status,
      distance_km: optionalNumber(body.distanceKm, '距离', 0, 9999),
      onset_at: optionalDateTime(body.onsetAt, '发病时间'),
      created_at: createdAt,
      updated_at: createdAt,
      closed_at: isClosed ? now() : null,
      is_closed: isClosed,
      creator_id: operatorId,
      remark: optionalString(body.remark, '备注', 500),
      deleted_at: null,
    })
    // 院内创建：自动落一个「呼救/创建」节点，保证时间轴有起点
    this.db.run(
      `INSERT OR IGNORE INTO case_event (case_id, event_code, event_at, operator_id, remark, created_at)
       VALUES (?, 'CALL', ?, ?, NULL, ?)`,
      [id, createdAt, operatorId, now()],
    )
    return id
  }

  update(id: number, body: CaseSaveRequest, operatorId: number | null): void {
    const current = this.db.get<{ id: number; is_closed: number; case_no: string }>(
      'SELECT id, is_closed, case_no FROM green_channel_case WHERE id = ? AND deleted_at IS NULL',
      [id],
    )
    if (!current) throw ApiException.notFound('绿道病例')
    const data: Record<string, SqlValue> = { updated_at: now() }
    if (body.diseaseCode !== undefined) data.disease_code = requiredString(body.diseaseCode, '疾病类型', 32)
    if (body.sourceType !== undefined) data.source_type = enumValue(body.sourceType, Object.values(SOURCE_TYPE), '推送方式')
    if (body.deptId !== undefined) data.dept_id = optionalNumber(body.deptId, '科室')
    if (body.distanceKm !== undefined) data.distance_km = optionalNumber(body.distanceKm, '距离', 0, 9999)
    if (body.onsetAt !== undefined) data.onset_at = optionalDateTime(body.onsetAt, '发病时间')
    if (body.remark !== undefined) data.remark = optionalString(body.remark, '备注', 500)
    if (body.patient !== undefined) {
      // 编辑时替换患者：新建一条患者记录并挂接，避免改动他人主索引
      const patientId = this.patients.create(body.patient)
      data.patient_id = patientId
    } else if (body.patientId !== undefined && body.patientId !== null) {
      if (!this.patients.exists(Number(body.patientId))) throw ApiException.param('指定的患者不存在')
      data.patient_id = Number(body.patientId)
    }
    if (body.statusCode !== undefined) {
      const status = enumValue(body.statusCode, Object.values(STATUS), '病例状态')
      data.status_code = status
      if (status === STATUS.CLOSED) {
        data.is_closed = 1
        data.closed_at = now()
      } else if (current.is_closed) {
        data.is_closed = 0
        data.closed_at = null
      }
    }
    void operatorId
    this.db.update('green_channel_case', id, data)
  }

  remove(id: number): void {
    const current = this.db.get<{ id: number }>('SELECT id FROM green_channel_case WHERE id = ? AND deleted_at IS NULL', [id])
    if (!current) throw ApiException.notFound('绿道病例')
    this.db.update('green_channel_case', id, { deleted_at: now(), updated_at: now() })
  }

  /** 批量删除（软删除；时间节点保留，靠 case.deleted_at 过滤） */
  removeMany(ids: number[]): number {
    if (!Array.isArray(ids) || ids.length === 0) throw ApiException.param('请选择要删除的病例')
    if (ids.length > 500) throw ApiException.param('单次最多删除 500 条')
    const ts = now()
    let deleted = 0
    for (const raw of ids) {
      const id = Number(raw)
      if (!Number.isFinite(id) || id <= 0) continue
      const hit = this.db.get<{ id: number }>('SELECT id FROM green_channel_case WHERE id = ? AND deleted_at IS NULL', [id])
      if (!hit) continue
      this.db.update('green_channel_case', id, { deleted_at: ts, updated_at: ts })
      deleted++
    }
    return deleted
  }

  /** 字典「编码 → 编码」与「名称 → 编码」，供导入时同时接受中文名和编码 */
  private dictCodeMap(type: string): Map<string, string> {
    const rows = this.db.all<{ code: string; name: string }>('SELECT code, name FROM dict_item WHERE type = ?', [type])
    const map = new Map<string, string>()
    for (const r of rows) {
      map.set(r.code, r.code)
      map.set(r.name, r.code)
    }
    return map
  }

  /**
   * 批量导入病例。每行「新建患者 + 一条病例」，单行失败不影响其他行：
   * 疾病 / 推送方式 既接受中文名也接受编码，不在字典中则报错并给出行号。
   */
  importRows(rows: CaseImportRow[], operatorId: number | null): CaseImportResult {
    if (!Array.isArray(rows) || rows.length === 0) throw ApiException.param('导入内容为空')
    if (rows.length > 1000) throw ApiException.param('单次最多导入 1000 行')
    const diseaseMap = this.dictCodeMap('disease')
    const sourceMap = this.dictCodeMap('sourceType')
    const result: CaseImportResult = { total: rows.length, created: 0, skipped: 0, errors: [] }
    rows.forEach((row, index) => {
      const lineNo = index + 2
      try {
        const name = requiredString(row.patientName, '姓名', 32)
        const disease = diseaseMap.get(String(row.disease ?? '').trim())
        if (!disease) throw ApiException.param(`疾病「${row.disease ?? ''}」不在字典中`)
        const source = sourceMap.get(String(row.sourceType ?? '').trim())
        if (!source) throw ApiException.param(`推送方式「${row.sourceType ?? ''}」不在字典中`)
        this.create(
          {
            diseaseCode: disease as CaseSaveRequest['diseaseCode'],
            sourceType: source as CaseSaveRequest['sourceType'],
            createdAt: row.createdAt ?? null,
            remark: row.remark ?? null,
            patient: {
              name,
              gender: parseGenderCode(row.gender),
              birthDate: row.birthDate ?? null,
            },
          },
          operatorId,
        )
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

  /** 补录/修改时间节点（同一节点重复提交即覆盖） */
  addEvent(caseId: number, body: CaseEventSaveRequest, operatorId: number | null): CaseEventItem[] {
    const exists = this.db.get<{ id: number }>('SELECT id FROM green_channel_case WHERE id = ? AND deleted_at IS NULL', [caseId])
    if (!exists) throw ApiException.notFound('绿道病例')
    const eventCode = requiredString(body.eventCode, '节点类型', 32)
    const eventAt = optionalDateTime(body.eventAt, '节点时间')
    if (!eventAt) throw ApiException.param('节点时间不能为空')
    this.db.run(
      `INSERT INTO case_event (case_id, event_code, event_at, operator_id, remark, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(case_id, event_code) DO UPDATE SET event_at = excluded.event_at,
         operator_id = excluded.operator_id, remark = excluded.remark`,
      [caseId, eventCode, eventAt, operatorId, optionalString(body.remark, '备注', 200), now()],
    )
    this.db.update('green_channel_case', caseId, { updated_at: now() })
    return this.listEvents(caseId)
  }

  close(id: number, closedAt: string | null, remark: string | null, operatorId: number | null): void {
    const current = this.db.get<{ id: number; is_closed: number; closed_at: string | null }>(
      'SELECT id, is_closed, closed_at FROM green_channel_case WHERE id = ? AND deleted_at IS NULL',
      [id],
    )
    if (!current) throw ApiException.notFound('绿道病例')
    if (current.is_closed) throw ApiException.conflict('该病例已闭环')
    const at = closedAt ?? now()
    const data: Record<string, SqlValue> = {
      status_code: STATUS.CLOSED,
      is_closed: 1,
      closed_at: at,
      updated_at: now(),
    }
    if (remark) data.remark = remark
    this.db.update('green_channel_case', id, data)
    this.db.run(
      `INSERT OR IGNORE INTO case_event (case_id, event_code, event_at, operator_id, remark, created_at)
       VALUES (?, 'FINISH', ?, ?, ?, ?)`,
      [id, at, operatorId, remark, now()],
    )
  }

  /* ------------------------------------------------------------ 附件 */

  addAttachment(caseId: number, file: { originalname: string; filename: string; size: number; mimetype: string }, uploaderId: number | null): number {
    return this.db.insert('case_attachment', {
      case_id: caseId,
      file_name: file.originalname,
      stored_name: file.filename,
      file_size: file.size,
      mime_type: file.mimetype,
      uploader_id: uploaderId,
      created_at: now(),
    })
  }

  getAttachment(id: number): { storedName: string; fileName: string } {
    const row = this.db.get<{ storedName: string; fileName: string }>(
      'SELECT stored_name AS storedName, file_name AS fileName FROM case_attachment WHERE id = ?',
      [id],
    )
    if (!row) throw ApiException.notFound('附件')
    return row
  }

  /* ------------------------------------------------------------ 内部 */

  private resolvePatient(body: CaseSaveRequest): number {
    if (body.patientId) {
      const id = Number(body.patientId)
      if (!this.patients.exists(id)) throw ApiException.param('指定的患者不存在')
      return id
    }
    if (body.patient) return this.patients.create(body.patient)
    throw ApiException.param('必须选择或新建患者')
  }

  private nextCaseNo(createdAt: string): string {
    const prefix = `LD${createdAt.slice(0, 10).replace(/-/g, '')}`
    const count = this.db.scalar<number>('SELECT COUNT(*) FROM green_channel_case WHERE case_no LIKE ?', [`${prefix}%`]) ?? 0
    let seq = count + 1
    let caseNo = `${prefix}${String(seq).padStart(4, '0')}`
    while (this.db.get('SELECT id FROM green_channel_case WHERE case_no = ?', [caseNo])) {
      seq += 1
      caseNo = `${prefix}${String(seq).padStart(4, '0')}`
    }
    return caseNo
  }

  private buildFilter(query: CaseQuery): { clause: string; params: SqlValue[] } {
    const where: string[] = ['c.deleted_at IS NULL']
    const params: SqlValue[] = []
    if (query.keyword) {
      where.push('(c.case_no LIKE ? OR p.name_masked LIKE ? OR p.mrn LIKE ?)')
      const kw = `%${query.keyword}%`
      params.push(kw, kw, kw)
    }
    if (query.diseaseCode) {
      where.push('c.disease_code = ?')
      params.push(query.diseaseCode)
    }
    if (query.sourceType) {
      where.push('c.source_type = ?')
      params.push(query.sourceType)
    }
    if (query.statusCode) {
      where.push('c.status_code = ?')
      params.push(query.statusCode)
    }
    if (query.deptId) {
      where.push('c.dept_id = ?')
      params.push(Number(query.deptId))
    }
    if (query.isClosed !== undefined && query.isClosed !== null) {
      where.push('c.is_closed = ?')
      params.push(query.isClosed ? 1 : 0)
    }
    if (query.from) {
      where.push('c.created_at >= ?')
      params.push(`${query.from} 00:00:00`)
    }
    if (query.to) {
      where.push('c.created_at <= ?')
      params.push(`${query.to} 23:59:59`)
    }
    return { clause: where.join(' AND '), params }
  }

  private toListItem(row: CaseRow): CaseListItem {
    const disease = this.dict.mapOf('disease').get(row.diseaseCode)
    const source = this.dict.mapOf('sourceType').get(row.sourceType)
    const status = this.dict.mapOf('caseStatus').get(row.statusCode)
    return {
      id: row.id,
      caseNo: row.caseNo,
      patientId: row.patientId,
      patientName: row.patientName,
      genderName: genderLabel(row.gender),
      age: calcAge(row.birthDate),
      phoneMasked: row.phoneMasked,
      diseaseCode: row.diseaseCode as never,
      diseaseName: disease?.name ?? row.diseaseCode,
      diseaseColor: disease?.color ?? '#4FA8FF',
      sourceType: row.sourceType as SourceType,
      sourceTypeName: source?.name ?? row.sourceType,
      statusCode: row.statusCode as never,
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

  /** 大屏 24 小时表格用：直接返回已脱敏的行 */
  screenRows(limit: number): CaseListItem[] {
    const rows = this.db.all<CaseRow>(
      `${SELECT_CASE} WHERE c.deleted_at IS NULL
         AND c.created_at >= datetime('now', 'localtime', '-24 hours')
        ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
      [limit],
    )
    return rows.map((r) => this.toListItem(r))
  }
}

/** 响应时长：首个节点 → 到院/分诊/首诊 */
function computeResponseMinutes(events: CaseEventItem[]): number | null {
  if (events.length < 2) return null
  const sorted = [...events].sort((a, b) => a.eventAt.localeCompare(b.eventAt))
  const first = sorted[0]!
  const end = sorted.find((e) => e.eventCode === 'ARRIVE_HOSPITAL') ?? sorted.find((e) => e.eventCode === 'TRIAGE') ?? sorted.find((e) => e.eventCode === 'FIRST_CONTACT')
  if (!end) return null
  return diffMinutes(first.eventAt, end.eventAt)
}

/** CSV 里的性别文本 → 性别码（导入用） */
function parseGenderCode(value: unknown): GenderCode {
  const text = String(value ?? '').trim()
  if (text === '男' || text === '1' || text.toLowerCase() === 'male') return GENDER.MALE
  if (text === '女' || text === '2' || text.toLowerCase() === 'female') return GENDER.FEMALE
  return GENDER.UNKNOWN
}
