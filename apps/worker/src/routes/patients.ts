/**
 * 患者路由。
 *
 * 云版脱敏差异（重要）：
 *   公网演示版**不保存任何明文身份信息**，入库时只写脱敏姓名；
 *   `/patients/:id/plain` 直接拒绝（本地院内版才有该能力，且每次调用写审计）。
 *
 * 列表形态与本地版一致：每行是「患者 + 最近一条绿道病例」的拍平结果，
 * 支持按 疾病 / 状态 / 推送方式 筛选，并可导出 CSV、批量导入、批量删除。
 */
import {
  ERROR_CODE,
  GENDER,
  PERM,
  formatDate,
  type GenderCode,
  type PatientDetail,
  type PatientImportResult,
  type PatientImportRow,
  type PatientListItem,
} from '@hospital/shared'
import { ApiException, optionalDateTime, optionalNumber, optionalString, orderBy, paging, requireString } from '../http'
import { Dicts, SELECT_PATIENT, maskNameOnly, toPatientListItem, type PatientDicts } from '../services'
import type { Ctx, Route } from '../types'

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
  caseId?: number | null
  caseNo?: string | null
  diseaseCode?: string | null
  sourceType?: string | null
  statusCode?: string | null
  caseCreatedAt?: string | null
}

const SORTABLE: Record<string, string> = {
  created_at: 'p.created_at',
  last_visit_at: 'COALESCE(c.created_at, p.created_at)',
  id: 'p.id',
  name_masked: 'p.name_masked',
}

const DEFAULT_ORDER = 'COALESCE(c.created_at, p.created_at) DESC, p.id DESC'

/** 计数用的 FROM/JOIN：必须与 SELECT_PATIENT 的关联结构保持一致，否则筛选后的条数会对不上 */
const PATIENT_COUNT_FROM = /* sql */ `
  FROM patient p
  LEFT JOIN (
    SELECT patient_id, MAX(id) AS cid
      FROM green_channel_case
     WHERE deleted_at IS NULL
     GROUP BY patient_id
  ) l ON l.patient_id = p.id
  LEFT JOIN green_channel_case c ON c.id = l.cid
`

const CSV_HEADER = ['绿道号', '姓名', '性别', '年龄', '疾病', '推送方式', '手机号', '状态', '最近就诊时间', '备注']

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

/** 列表 / 导出的筛选条件（病例维度筛选隐含「必须有病例」） */
function buildFilter(query: URLSearchParams): { clause: string; params: unknown[] } {
  const where: string[] = ['p.deleted_at IS NULL']
  const params: unknown[] = []
  const keyword = (query.get('keyword') ?? '').trim()
  if (keyword) {
    where.push('(p.name_masked LIKE ? OR p.mrn LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`)
  }
  for (const [param, column] of [
    ['diseaseCode', 'c.disease_code'],
    ['statusCode', 'c.status_code'],
    ['sourceType', 'c.source_type'],
  ] as const) {
    const v = query.get(param)
    if (v) {
      where.push(`${column} = ?`)
      params.push(v)
    }
  }
  return { clause: where.join(' AND '), params }
}

async function loadDicts(ctx: Ctx): Promise<PatientDicts> {
  const dicts = new Dicts(ctx.db)
  const [disease, source, status] = await Promise.all([
    dicts.mapOf('disease'),
    dicts.mapOf('sourceType'),
    dicts.mapOf('caseStatus'),
  ])
  return { disease, source, status }
}

/** CSV 里的性别文本 → 性别码 */
function parseGender(value: unknown): GenderCode {
  const text = String(value ?? '').trim()
  if (text === '男' || text === '1' || text.toLowerCase() === 'male') return GENDER.MALE
  if (text === '女' || text === '2' || text.toLowerCase() === 'female') return GENDER.FEMALE
  return GENDER.UNKNOWN
}

export const patientRoutes: Route[] = [
  {
    method: 'GET',
    path: '/patients/search',
    perms: [PERM.PATIENT_VIEW],
    handler: async (ctx) => {
      const kw = (ctx.query.get('keyword') ?? '').trim()
      const params: unknown[] = []
      let clause = 'p.deleted_at IS NULL'
      if (kw) {
        clause += ' AND (p.name_masked LIKE ? OR p.mrn LIKE ?)'
        params.push(`%${kw}%`, `%${kw}%`)
      }
      const rows = await ctx.db.all<PatientRow>(`${SELECT_PATIENT} WHERE ${clause} ORDER BY p.id DESC LIMIT 30`, params)
      return rows.map((r) => toPatientListItem(r))
    },
  },
  {
    method: 'GET',
    path: '/patients/export',
    perms: [PERM.PATIENT_VIEW],
    handler: async (ctx) => {
      const { clause, params } = buildFilter(ctx.query)
      const rows = await ctx.db.all<PatientRow>(
        `${SELECT_PATIENT} WHERE ${clause} ORDER BY ${DEFAULT_ORDER} LIMIT 5000`,
        params,
      )
      const dicts = await loadDicts(ctx)
      const list = rows.map((r) => toPatientListItem(r, dicts))
      const lines = [CSV_HEADER.join(',')]
      for (const r of list) {
        lines.push(
          [r.lastCaseNo, r.nameMasked, r.genderName, r.age ?? '', r.diseaseName, r.sourceTypeName, r.phoneMasked, r.statusName, r.lastVisitAt, r.remark]
            .map(csvCell)
            .join(','),
        )
      }
      await ctx.db.insert('sys_oper_log', {
        user_id: ctx.user?.id ?? null,
        user_name: ctx.user?.username ?? null,
        module: 'patient',
        action: 'EXPORT',
        target_type: 'patient',
        detail: JSON.stringify({ count: list.length }),
        created_at: ctx.nowStr,
      })
      return new Response(`\uFEFF${lines.join('\r\n')}`, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="patients_${ctx.nowStr.slice(0, 10)}.csv"`,
          'access-control-allow-origin': '*',
        },
      })
    },
  },
  {
    method: 'GET',
    path: '/patients',
    perms: [PERM.PATIENT_VIEW],
    handler: async (ctx) => {
      const { page, pageSize, offset } = paging(ctx.query)
      const { clause, params } = buildFilter(ctx.query)
      const total = (await ctx.db.scalar<number>(`SELECT COUNT(*) ${PATIENT_COUNT_FROM} WHERE ${clause}`, params)) ?? 0
      const order = orderBy(ctx.query.get('sort'), SORTABLE, DEFAULT_ORDER)
      const rows = await ctx.db.all<PatientRow>(
        `${SELECT_PATIENT} WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
        [...params, pageSize, offset],
      )
      const dicts = await loadDicts(ctx)
      return { list: rows.map((r) => toPatientListItem(r, dicts)), total, page, pageSize }
    },
  },
  {
    method: 'GET',
    path: '/patients/:id/plain',
    perms: [PERM.PATIENT_PLAIN],
    handler: () => {
      // 演示版仅在库中保留脱敏姓名，没有可解密的明文，直接拒绝而不是返回假数据
      throw new ApiException(ERROR_CODE.FORBIDDEN, '公网演示版不提供患者明文查看（库中只保留脱敏姓名）')
    },
  },
  {
    method: 'GET',
    path: '/patients/:id',
    perms: [PERM.PATIENT_VIEW],
    handler: async (ctx) => {
      const row = await ctx.db.get<PatientRow>(`${SELECT_PATIENT} WHERE p.id = ? AND p.deleted_at IS NULL`, [Number(ctx.params.id)])
      if (!row) throw ApiException.notFound('患者')
      const dicts = await loadDicts(ctx)
      const detail: PatientDetail = { ...toPatientListItem(row, dicts), birthDate: row.birthDate }
      return detail
    },
  },
  {
    method: 'POST',
    path: '/patients',
    perms: [PERM.PATIENT_UPDATE],
    handler: async (ctx) => {
      const name = requireString(ctx.body.name, '姓名', 32)
      const gender = optionalNumber(ctx.body.gender, '性别', 1, 9) ?? 9
      const mrn = optionalString(ctx.body.mrn, '病案号', 32)
      if (mrn) {
        const dup = await ctx.db.get('SELECT id FROM patient WHERE mrn = ? AND deleted_at IS NULL', [mrn])
        if (dup) throw ApiException.conflict(`病案号 ${mrn} 已存在`)
      }
      const id = await ctx.db.insert('patient', {
        mrn,
        // 只落脱敏姓名：公网演示不保存明文
        name_cipher: '',
        name_masked: maskNameOnly(name),
        gender,
        birth_date: optionalDateTime(ctx.body.birthDate, '出生日期')?.slice(0, 10) ?? null,
        id_card_cipher: null,
        id_card_masked: null,
        phone_cipher: null,
        phone_masked: null,
        remark: optionalString(ctx.body.remark, '备注', 200),
        created_at: ctx.nowStr,
        updated_at: ctx.nowStr,
        deleted_at: null,
      })
      await ctx.db.insert('sys_oper_log', {
        user_id: ctx.user?.id ?? null,
        user_name: ctx.user?.username ?? null,
        module: 'patient',
        action: 'CREATE',
        target_type: 'patient',
        target_id: String(id),
        created_at: ctx.nowStr,
      })
      return { id }
    },
  },
  {
    method: 'POST',
    path: '/patients/import',
    perms: [PERM.PATIENT_UPDATE],
    handler: async (ctx) => {
      const rows = (ctx.body.rows ?? []) as PatientImportRow[]
      if (!Array.isArray(rows) || rows.length === 0) throw ApiException.param('导入内容为空')
      if (rows.length > 2000) throw ApiException.param('单次最多导入 2000 行')
      const result: PatientImportResult = { total: rows.length, created: 0, skipped: 0, errors: [] }
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!
        try {
          const name = requireString(row.name, '姓名', 32)
          const mrn = optionalString(row.mrn, '病案号', 32)
          if (mrn) {
            const dup = await ctx.db.get('SELECT id FROM patient WHERE mrn = ? AND deleted_at IS NULL', [mrn])
            if (dup) throw ApiException.conflict(`病案号 ${mrn} 已存在`)
          }
          await ctx.db.insert('patient', {
            mrn,
            name_cipher: '',
            name_masked: maskNameOnly(name),
            gender: parseGender(row.gender),
            birth_date: row.birthDate ? String(row.birthDate).slice(0, 10) : null,
            id_card_cipher: null,
            id_card_masked: null,
            phone_cipher: null,
            phone_masked: null,
            remark: optionalString(row.remark, '备注', 200),
            created_at: ctx.nowStr,
            updated_at: ctx.nowStr,
            deleted_at: null,
          })
          result.created++
        } catch (err) {
          result.skipped++
          if (result.errors.length < 20) {
            result.errors.push({ row: i + 2, message: err instanceof Error ? err.message : String(err) })
          }
        }
      }
      await ctx.db.insert('sys_oper_log', {
        user_id: ctx.user?.id ?? null,
        user_name: ctx.user?.username ?? null,
        module: 'patient',
        action: 'IMPORT',
        target_type: 'patient',
        detail: JSON.stringify({ total: result.total, created: result.created, skipped: result.skipped }),
        created_at: ctx.nowStr,
      })
      return result
    },
  },
  {
    method: 'POST',
    path: '/patients/batch-delete',
    perms: [PERM.PATIENT_UPDATE],
    handler: async (ctx) => {
      const ids = ((ctx.body.ids ?? []) as unknown[]).map((i) => Number(i)).filter((i) => Number.isFinite(i) && i > 0)
      if (ids.length === 0) throw ApiException.param('请选择要删除的患者')
      if (ids.length > 500) throw ApiException.param('单次最多删除 500 条')
      let deleted = 0
      for (const id of ids) {
        const hit = await ctx.db.get('SELECT id FROM patient WHERE id = ? AND deleted_at IS NULL', [id])
        if (!hit) continue
        await ctx.db.update('patient', id, { deleted_at: ctx.nowStr, updated_at: ctx.nowStr })
        await ctx.db.run('UPDATE green_channel_case SET deleted_at = ?, updated_at = ? WHERE patient_id = ? AND deleted_at IS NULL', [
          ctx.nowStr,
          ctx.nowStr,
          id,
        ])
        deleted++
      }
      await ctx.db.insert('sys_oper_log', {
        user_id: ctx.user?.id ?? null,
        user_name: ctx.user?.username ?? null,
        module: 'patient',
        action: 'BATCH_DELETE',
        target_type: 'patient',
        detail: JSON.stringify({ requested: ids.length, deleted }),
        created_at: ctx.nowStr,
      })
      return { deleted }
    },
  },
  {
    method: 'PUT',
    path: '/patients/:id',
    perms: [PERM.PATIENT_UPDATE],
    handler: async (ctx) => {
      const id = Number(ctx.params.id)
      const exists = await ctx.db.get('SELECT id FROM patient WHERE id = ? AND deleted_at IS NULL', [id])
      if (!exists) throw ApiException.notFound('患者')
      const data: Record<string, unknown> = { updated_at: ctx.nowStr }
      if (ctx.body.name !== undefined) data.name_masked = maskNameOnly(requireString(ctx.body.name, '姓名', 32))
      if (ctx.body.gender !== undefined) data.gender = optionalNumber(ctx.body.gender, '性别', 1, 9)
      if (ctx.body.birthDate !== undefined) data.birth_date = optionalDateTime(ctx.body.birthDate, '出生日期')?.slice(0, 10) ?? null
      if (ctx.body.mrn !== undefined) data.mrn = optionalString(ctx.body.mrn, '病案号', 32)
      if (ctx.body.remark !== undefined) data.remark = optionalString(ctx.body.remark, '备注', 200)
      await ctx.db.update('patient', id, data)
      return { id }
    },
  },
  {
    method: 'DELETE',
    path: '/patients/:id',
    perms: [PERM.PATIENT_UPDATE],
    handler: async (ctx) => {
      const id = Number(ctx.params.id)
      const used = (await ctx.db.scalar<number>('SELECT COUNT(*) FROM green_channel_case WHERE patient_id = ? AND deleted_at IS NULL', [id])) ?? 0
      if (used > 0) throw ApiException.conflict(`该患者已关联 ${used} 条绿道病例，无法删除`)
      await ctx.db.update('patient', id, { deleted_at: ctx.nowStr })
      return { id }
    },
  },
]

export { formatDate, toPatientListItem }
