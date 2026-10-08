/**
 * 患者路由。
 *
 * 云版脱敏差异（重要）：
 *   公网演示版**不保存任何明文身份信息**，入库时只写脱敏姓名；
 *   `/patients/:id/plain` 直接拒绝（本地院内版才有该能力，且每次调用写审计）。
 */
import { ERROR_CODE, PERM, formatDate, type PatientDetail, type PatientListItem } from '@hospital/shared'
import { ApiException, optionalDateTime, optionalNumber, optionalString, orderBy, paging, requireString } from '../http'
import { SELECT_PATIENT, maskNameOnly, toPatientListItem } from '../services'
import type { Route } from '../types'

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
}

const SORTABLE: Record<string, string> = {
  created_at: 'p.created_at',
  id: 'p.id',
  name_masked: 'p.name_masked',
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
      return rows.map(toPatientListItem)
    },
  },
  {
    method: 'GET',
    path: '/patients',
    perms: [PERM.PATIENT_VIEW],
    handler: async (ctx) => {
      const { page, pageSize, offset } = paging(ctx.query)
      const kw = ctx.query.get('keyword')
      const params: unknown[] = []
      let clause = 'p.deleted_at IS NULL'
      if (kw) {
        clause += ' AND (p.name_masked LIKE ? OR p.mrn LIKE ?)'
        params.push(`%${kw}%`, `%${kw}%`)
      }
      const total = (await ctx.db.scalar<number>(`SELECT COUNT(*) FROM patient p WHERE ${clause}`, params)) ?? 0
      const order = orderBy(ctx.query.get('sort'), SORTABLE, 'p.created_at DESC')
      const rows = await ctx.db.all<PatientRow>(`${SELECT_PATIENT} WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, pageSize, offset])
      return { list: rows.map(toPatientListItem), total, page, pageSize }
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
      const detail: PatientDetail = { ...toPatientListItem(row), birthDate: row.birthDate, remark: row.remark }
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
