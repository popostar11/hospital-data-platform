/**
 * 绿道病例路由。SQL 与本地版 `case.service.ts` 一致。
 *
 * 云版差异（已在 docs/DEPLOY-CLOUDFLARE.md 中说明）：
 *   - 附件上传依赖磁盘/R2，公网演示未启用（返回明确提示而非静默失败）
 *   - 导出由 xlsx 改为 CSV（exceljs 依赖 Node 流，Workers 里跑不动）
 */
import { ERROR_CODE, PERM, SOURCE_TYPE, CASE_STATUS, diffMinutes, formatDate, genderLabel, calcAge, type CaseDetail, type CaseEventItem, type CaseImportResult, type CaseImportRow, type CaseListItem } from '@hospital/shared'
import { now } from '../db'
import { ApiException, optionalDateTime, optionalNumber, optionalString, orderBy, paging, requireString } from '../http'
import { Dicts, SELECT_CASE, SELECT_PATIENT, maskNameOnly, nextCaseNo, toCaseListItem, toPatientListItem, type CaseRow } from '../services'
import type { Ctx, Route } from '../types'

const SORTABLE: Record<string, string> = {
  created_at: 'c.created_at',
  updated_at: 'c.updated_at',
  closed_at: 'c.closed_at',
  id: 'c.id',
  distance_km: 'c.distance_km',
}

function buildFilter(query: URLSearchParams): { clause: string; params: unknown[] } {
  const where: string[] = ['c.deleted_at IS NULL']
  const params: unknown[] = []
  const keyword = query.get('keyword')
  if (keyword) {
    where.push('(c.case_no LIKE ? OR p.name_masked LIKE ? OR p.mrn LIKE ?)')
    const kw = `%${keyword}%`
    params.push(kw, kw, kw)
  }
  for (const [param, column] of [
    ['diseaseCode', 'c.disease_code'],
    ['sourceType', 'c.source_type'],
    ['statusCode', 'c.status_code'],
  ] as const) {
    const v = query.get(param)
    if (v) {
      where.push(`${column} = ?`)
      params.push(v)
    }
  }
  const deptId = query.get('deptId')
  if (deptId) {
    where.push('c.dept_id = ?')
    params.push(Number(deptId))
  }
  const isClosed = query.get('isClosed')
  if (isClosed !== null && isClosed !== '') {
    where.push('c.is_closed = ?')
    params.push(isClosed === 'true' || isClosed === '1' ? 1 : 0)
  }
  const from = query.get('from')
  if (from) {
    where.push('c.created_at >= ?')
    params.push(`${from} 00:00:00`)
  }
  const to = query.get('to')
  if (to) {
    where.push('c.created_at <= ?')
    params.push(`${to} 23:59:59`)
  }
  return { clause: where.join(' AND '), params }
}

async function listEvents(ctx: Ctx, caseId: number): Promise<CaseEventItem[]> {
  const rows = await ctx.db.all<{ id: number; eventCode: string; eventAt: string; remark: string | null; operatorName: string | null }>(
    `SELECT e.id, e.event_code AS eventCode, e.event_at AS eventAt, e.remark, u.real_name AS operatorName
       FROM case_event e LEFT JOIN sys_user u ON u.id = e.operator_id
      WHERE e.case_id = ? ORDER BY e.event_at ASC, e.id ASC`,
    [caseId],
  )
  const eventDict = await new Dicts(ctx.db).mapOf('eventType')
  let prev: string | null = null
  return rows.map((r) => {
    const gap = prev ? diffMinutes(prev, r.eventAt) : null
    prev = r.eventAt
    return {
      id: r.id,
      eventCode: r.eventCode as CaseEventItem['eventCode'],
      eventName: eventDict.get(r.eventCode)?.name ?? r.eventCode,
      eventAt: formatDate(r.eventAt),
      operatorName: r.operatorName,
      remark: r.remark,
      gapMinutes: gap,
      overtime: false,
    }
  })
}

async function resolvePatient(ctx: Ctx, body: Record<string, unknown>): Promise<number> {
  if (body.patientId) {
    const id = Number(body.patientId)
    const exists = await ctx.db.get('SELECT id FROM patient WHERE id = ? AND deleted_at IS NULL', [id])
    if (!exists) throw ApiException.param('指定的患者不存在')
    return id
  }
  const patient = body.patient as Record<string, unknown> | undefined
  if (!patient) throw ApiException.param('必须选择或新建患者')
  const name = requireString(patient.name, '姓名', 32)
  const gender = optionalNumber(patient.gender, '性别', 1, 9) ?? 9
  // 云版不保存明文：姓名只落脱敏字段，id_card/phone 同样只记录脱敏形式
  const masked = maskNameOnly(name)
  return ctx.db.insert('patient', {
    mrn: optionalString(patient.mrn, '病案号', 32),
    name_cipher: '',
    name_masked: masked,
    gender,
    birth_date: optionalDateTime(patient.birthDate, '出生日期')?.slice(0, 10) ?? null,
    id_card_cipher: null,
    id_card_masked: null,
    phone_cipher: null,
    phone_masked: null,
    remark: optionalString(patient.remark, '备注', 200),
    created_at: ctx.nowStr,
    updated_at: ctx.nowStr,
    deleted_at: null,
  })
}

export const caseRoutes: Route[] = [
  {
    method: 'GET',
    path: '/cases/meta',
    perms: [PERM.CASE_VIEW],
    handler: async (ctx) => {
      const dicts = await new Dicts(ctx.db).all()
      const departments = await ctx.db.all(
        'SELECT id, parent_id AS parentId, code, name FROM department WHERE enabled = 1 ORDER BY sort_no ASC, id ASC',
      )
      return {
        diseases: dicts.disease ?? [],
        sourceTypes: dicts.sourceType ?? [],
        caseStatuses: dicts.caseStatus ?? [],
        eventTypes: dicts.eventType ?? [],
        departments,
      }
    },
  },
  {
    method: 'GET',
    path: '/cases/export',
    perms: [PERM.CASE_EXPORT],
    handler: async (ctx) => {
      const { clause, params } = buildFilter(ctx.query)
      const rows = await ctx.db.all<CaseRow>(`${SELECT_CASE} WHERE ${clause} ORDER BY c.created_at DESC LIMIT 20000`, params)
      const dicts = new Dicts(ctx.db)
      const items = await Promise.all(rows.map((r) => toCaseListItem(dicts, r)))
      const header = ['绿道编号', '姓名', '性别', '年龄', '疾病', '推送方式', '距离(km)', '科室', '状态', '创建时间', '闭环时间', '备注']
      const lines = [header.join(',')]
      for (const r of items) {
        lines.push(
          [r.caseNo, r.patientName, r.genderName, r.age ?? '', r.diseaseName, r.sourceTypeName, r.distanceKm ?? '', r.deptName ?? '', r.statusName, r.createdAt, r.closedAt ?? '', r.remark ?? '']
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(','),
        )
      }
      await ctx.db.insert('sys_oper_log', {
        user_id: ctx.user?.id ?? null,
        user_name: ctx.user?.username ?? null,
        module: 'case',
        action: 'EXPORT',
        target_type: 'green_channel_case',
        detail: JSON.stringify({ count: items.length }),
        created_at: ctx.nowStr,
      })
      // BOM 让 Excel 正确识别 UTF-8
      return new Response(`\uFEFF${lines.join('\r\n')}`, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="cases_${ctx.nowStr.slice(0, 10)}.csv"`,
          'access-control-allow-origin': '*',
        },
      })
    },
  },
  {
    method: 'GET',
    path: '/cases',
    perms: [PERM.CASE_VIEW],
    handler: async (ctx) => {
      const { page, pageSize, offset } = paging(ctx.query)
      const { clause, params } = buildFilter(ctx.query)
      const total = (await ctx.db.scalar<number>(`SELECT COUNT(*) FROM green_channel_case c JOIN patient p ON p.id = c.patient_id WHERE ${clause}`, params)) ?? 0
      const order = orderBy(ctx.query.get('sort'), SORTABLE, 'c.created_at DESC')
      const rows = await ctx.db.all<CaseRow>(`${SELECT_CASE} WHERE ${clause} ORDER BY ${order}, c.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset])
      const dicts = new Dicts(ctx.db)
      const list: CaseListItem[] = await Promise.all(rows.map((r) => toCaseListItem(dicts, r)))
      return { list, total, page, pageSize }
    },
  },
  {
    method: 'POST',
    path: '/cases/import',
    perms: [PERM.CASE_CREATE],
    handler: async (ctx) => {
      const rows = (ctx.body.rows ?? []) as CaseImportRow[]
      if (!Array.isArray(rows) || rows.length === 0) throw ApiException.param('导入内容为空')
      if (rows.length > 1000) throw ApiException.param('单次最多导入 1000 行')
      const dicts = new Dicts(ctx.db)
      const [diseaseMap, sourceMap] = await Promise.all([dicts.mapOf('disease'), dicts.mapOf('sourceType')])
      /** 既接受编码也接受中文名 */
      const toCode = (map: Map<string, { name: string }>, value: unknown): string | null => {
        const text = String(value ?? '').trim()
        if (!text) return null
        if (map.has(text)) return text
        for (const [code, item] of map) if (item.name === text) return code
        return null
      }
      const result: CaseImportResult = { total: rows.length, created: 0, skipped: 0, errors: [] }
      for (let i = 0; i < rows.length; i++) {
        const line = i + 2
        const row = rows[i]!
        try {
          const name = requireString(row.patientName, '姓名', 32)
          const diseaseCode = toCode(diseaseMap, row.disease)
          if (!diseaseCode) throw ApiException.param(`疾病「${row.disease ?? ''}」不在字典中`)
          const sourceType = toCode(sourceMap, row.sourceType)
          if (!sourceType) throw ApiException.param(`推送方式「${row.sourceType ?? ''}」不在字典中`)
          const createdAt = row.createdAt ? String(row.createdAt) : ctx.nowStr
          const patientId = await ctx.db.insert('patient', {
            mrn: null,
            name_cipher: '',
            name_masked: maskNameOnly(name),
            gender: 9,
            birth_date: row.birthDate ? String(row.birthDate).slice(0, 10) : null,
            id_card_cipher: null,
            id_card_masked: null,
            phone_cipher: null,
            phone_masked: null,
            remark: null,
            created_at: ctx.nowStr,
            updated_at: ctx.nowStr,
            deleted_at: null,
          })
          const id = await ctx.db.insert('green_channel_case', {
            case_no: await nextCaseNo(ctx.db, createdAt),
            patient_id: patientId,
            dept_id: null,
            disease_code: diseaseCode,
            source_type: sourceType,
            status_code: 'CREATED',
            distance_km: null,
            onset_at: null,
            arrive_at: null,
            created_at: createdAt,
            updated_at: createdAt,
            closed_at: null,
            is_closed: 0,
            creator_id: ctx.user?.id ?? null,
            remark: row.remark ?? null,
            deleted_at: null,
          })
          await ctx.db.run(
            `INSERT OR IGNORE INTO case_event (case_id, event_code, event_at, operator_id, remark, created_at)
             VALUES (?, 'CALL', ?, ?, NULL, ?)`,
            [id, createdAt, ctx.user?.id ?? null, ctx.nowStr],
          )
          result.created++
        } catch (err) {
          result.skipped++
          if (result.errors.length < 20) {
            result.errors.push({ row: line, message: err instanceof Error ? err.message : String(err) })
          }
        }
      }
      await ctx.db.insert('sys_oper_log', {
        user_id: ctx.user?.id ?? null,
        user_name: ctx.user?.username ?? null,
        module: 'case',
        action: 'IMPORT',
        target_type: 'green_channel_case',
        detail: JSON.stringify({ total: result.total, created: result.created, skipped: result.skipped }),
        created_at: ctx.nowStr,
      })
      return result
    },
  },
  {
    method: 'POST',
    path: '/cases/batch-delete',
    perms: [PERM.CASE_DELETE],
    handler: async (ctx) => {
      const ids = ((ctx.body.ids ?? []) as unknown[]).map((i) => Number(i)).filter((i) => Number.isFinite(i) && i > 0)
      if (ids.length === 0) throw ApiException.param('请选择要删除的病例')
      if (ids.length > 500) throw ApiException.param('单次最多删除 500 条')
      let deleted = 0
      for (const id of ids) {
        const hit = await ctx.db.get('SELECT id FROM green_channel_case WHERE id = ? AND deleted_at IS NULL', [id])
        if (!hit) continue
        await ctx.db.update('green_channel_case', id, { deleted_at: ctx.nowStr, updated_at: ctx.nowStr })
        deleted++
      }
      await ctx.db.insert('sys_oper_log', {
        user_id: ctx.user?.id ?? null,
        user_name: ctx.user?.username ?? null,
        module: 'case',
        action: 'BATCH_DELETE',
        target_type: 'green_channel_case',
        detail: JSON.stringify({ requested: ids.length, deleted }),
        created_at: ctx.nowStr,
      })
      return { deleted }
    },
  },
  {
    method: 'GET',
    path: '/cases/:id',
    perms: [PERM.CASE_VIEW],
    handler: async (ctx) => {
      const id = Number(ctx.params.id)
      const row = await ctx.db.get<CaseRow>(`${SELECT_CASE} WHERE c.id = ? AND c.deleted_at IS NULL`, [id])
      if (!row) throw ApiException.notFound('绿道病例')
      const dicts = new Dicts(ctx.db)
      const base = await toCaseListItem(dicts, row)
      const events = await listEvents(ctx, id)
      const detail: CaseDetail = {
        ...base,
        patient: {
          id: row.patientId,
          mrn: row.mrn,
          nameMasked: row.patientName,
          gender: row.gender as CaseDetail['patient']['gender'],
          genderName: genderLabel(row.gender),
          age: calcAge(row.birthDate),
          phoneMasked: row.phoneMasked,
          idCardMasked: row.idCardMasked,
          visitCount: 0,
          createdAt: formatDate(row.createdAt),
          // 病例详情里患者是从本病例反查出来的，不带「最近一条病例」的信息
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
        responseMinutes: null,
        attachments: [],
      }
      // 呼救 → 到院/分诊 的响应时长
      if (events.length >= 2) {
        const sorted = [...events].sort((a, b) => a.eventAt.localeCompare(b.eventAt))
        const end =
          sorted.find((e) => e.eventCode === 'ARRIVE_HOSPITAL') ??
          sorted.find((e) => e.eventCode === 'TRIAGE') ??
          sorted.find((e) => e.eventCode === 'FIRST_CONTACT')
        if (end) detail.responseMinutes = diffMinutes(sorted[0]!.eventAt, end.eventAt)
      }
      return detail
    },
  },
  {
    method: 'POST',
    path: '/cases',
    perms: [PERM.CASE_CREATE],
    handler: async (ctx) => {
      const diseaseCode = requireString(ctx.body.diseaseCode, '疾病类型', 32)
      const sourceType = requireString(ctx.body.sourceType, '推送方式', 32)
      if (!Object.values(SOURCE_TYPE).includes(sourceType as never)) throw ApiException.param('推送方式取值不合法')
      const statusCode = ctx.body.statusCode ? requireString(ctx.body.statusCode, '病例状态', 32) : CASE_STATUS.CREATED
      if (!Object.values(CASE_STATUS).includes(statusCode as never)) throw ApiException.param('病例状态取值不合法')
      const patientId = await resolvePatient(ctx, ctx.body)
      const createdAt = optionalDateTime(ctx.body.createdAt, '创建时间') ?? ctx.nowStr
      const isClosed = statusCode === CASE_STATUS.CLOSED ? 1 : 0
      const id = await ctx.db.insert('green_channel_case', {
        case_no: await nextCaseNo(ctx.db, createdAt),
        patient_id: patientId,
        dept_id: optionalNumber(ctx.body.deptId, '科室'),
        disease_code: diseaseCode,
        source_type: sourceType,
        status_code: statusCode,
        distance_km: optionalNumber(ctx.body.distanceKm, '距离', 0, 9999),
        onset_at: optionalDateTime(ctx.body.onsetAt, '发病时间'),
        arrive_at: null,
        created_at: createdAt,
        updated_at: createdAt,
        closed_at: isClosed ? ctx.nowStr : null,
        is_closed: isClosed,
        creator_id: ctx.user?.id ?? null,
        remark: optionalString(ctx.body.remark, '备注', 500),
        deleted_at: null,
      })
      await ctx.db.run(
        `INSERT OR IGNORE INTO case_event (case_id, event_code, event_at, operator_id, remark, created_at) VALUES (?, 'CALL', ?, ?, NULL, ?)`,
        [id, createdAt, ctx.user?.id ?? null, ctx.nowStr],
      )
      await ctx.db.insert('sys_oper_log', {
        user_id: ctx.user?.id ?? null,
        user_name: ctx.user?.username ?? null,
        module: 'case',
        action: 'CREATE',
        target_type: 'green_channel_case',
        target_id: String(id),
        detail: JSON.stringify({ diseaseCode, sourceType }),
        created_at: ctx.nowStr,
      })
      return { id }
    },
  },
  {
    method: 'PUT',
    path: '/cases/:id',
    perms: [PERM.CASE_UPDATE],
    handler: async (ctx) => {
      const id = Number(ctx.params.id)
      const current = await ctx.db.get<{ id: number; is_closed: number }>(
        'SELECT id, is_closed FROM green_channel_case WHERE id = ? AND deleted_at IS NULL',
        [id],
      )
      if (!current) throw ApiException.notFound('绿道病例')
      const data: Record<string, unknown> = { updated_at: now(ctx.timeZone) }
      if (ctx.body.diseaseCode !== undefined) data.disease_code = requireString(ctx.body.diseaseCode, '疾病类型', 32)
      if (ctx.body.sourceType !== undefined) data.source_type = requireString(ctx.body.sourceType, '推送方式', 32)
      if (ctx.body.deptId !== undefined) data.dept_id = optionalNumber(ctx.body.deptId, '科室')
      if (ctx.body.distanceKm !== undefined) data.distance_km = optionalNumber(ctx.body.distanceKm, '距离', 0, 9999)
      if (ctx.body.onsetAt !== undefined) data.onset_at = optionalDateTime(ctx.body.onsetAt, '发病时间')
      if (ctx.body.remark !== undefined) data.remark = optionalString(ctx.body.remark, '备注', 500)
      if (ctx.body.patient !== undefined) data.patient_id = await resolvePatient(ctx, ctx.body)
      else if (ctx.body.patientId !== undefined && ctx.body.patientId !== null) data.patient_id = Number(ctx.body.patientId)
      if (ctx.body.statusCode !== undefined) {
        const status = requireString(ctx.body.statusCode, '病例状态', 32)
        data.status_code = status
        if (status === CASE_STATUS.CLOSED) {
          data.is_closed = 1
          data.closed_at = ctx.nowStr
        } else if (current.is_closed) {
          data.is_closed = 0
          data.closed_at = null
        }
      }
      await ctx.db.update('green_channel_case', id, data)
      await ctx.db.insert('sys_oper_log', {
        user_id: ctx.user?.id ?? null,
        user_name: ctx.user?.username ?? null,
        module: 'case',
        action: 'UPDATE',
        target_type: 'green_channel_case',
        target_id: String(id),
        detail: JSON.stringify({ changed: Object.keys(ctx.body) }),
        created_at: ctx.nowStr,
      })
      return { id }
    },
  },
  {
    method: 'DELETE',
    path: '/cases/:id',
    perms: [PERM.CASE_DELETE],
    handler: async (ctx) => {
      const id = Number(ctx.params.id)
      const exists = await ctx.db.get('SELECT id FROM green_channel_case WHERE id = ? AND deleted_at IS NULL', [id])
      if (!exists) throw ApiException.notFound('绿道病例')
      await ctx.db.update('green_channel_case', id, { deleted_at: ctx.nowStr, updated_at: ctx.nowStr })
      await ctx.db.insert('sys_oper_log', {
        user_id: ctx.user?.id ?? null,
        user_name: ctx.user?.username ?? null,
        module: 'case',
        action: 'DELETE',
        target_type: 'green_channel_case',
        target_id: String(id),
        created_at: ctx.nowStr,
      })
      return { id }
    },
  },
  {
    method: 'POST',
    path: '/cases/:id/events',
    perms: [PERM.CASE_EVENT],
    handler: async (ctx) => {
      const id = Number(ctx.params.id)
      const exists = await ctx.db.get('SELECT id FROM green_channel_case WHERE id = ? AND deleted_at IS NULL', [id])
      if (!exists) throw ApiException.notFound('绿道病例')
      const eventCode = requireString(ctx.body.eventCode, '节点类型', 32)
      const eventAt = optionalDateTime(ctx.body.eventAt, '节点时间')
      if (!eventAt) throw ApiException.param('节点时间不能为空')
      await ctx.db.run(
        `INSERT INTO case_event (case_id, event_code, event_at, operator_id, remark, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(case_id, event_code) DO UPDATE SET event_at = excluded.event_at,
           operator_id = excluded.operator_id, remark = excluded.remark`,
        [id, eventCode, eventAt, ctx.user?.id ?? null, optionalString(ctx.body.remark, '备注', 200), ctx.nowStr],
      )
      await ctx.db.update('green_channel_case', id, { updated_at: ctx.nowStr })
      return listEvents(ctx, id)
    },
  },
  {
    method: 'POST',
    path: '/cases/:id/close',
    perms: [PERM.CASE_UPDATE],
    handler: async (ctx) => {
      const id = Number(ctx.params.id)
      const current = await ctx.db.get<{ id: number; is_closed: number }>(
        'SELECT id, is_closed FROM green_channel_case WHERE id = ? AND deleted_at IS NULL',
        [id],
      )
      if (!current) throw ApiException.notFound('绿道病例')
      if (current.is_closed) throw ApiException.conflict('该病例已闭环')
      const at = optionalDateTime(ctx.body?.closedAt, '闭环时间') ?? ctx.nowStr
      const remark = optionalString(ctx.body?.remark, '闭环说明', 200)
      const data: Record<string, unknown> = { status_code: CASE_STATUS.CLOSED, is_closed: 1, closed_at: at, updated_at: ctx.nowStr }
      if (remark) data.remark = remark
      await ctx.db.update('green_channel_case', id, data)
      await ctx.db.run(
        `INSERT OR IGNORE INTO case_event (case_id, event_code, event_at, operator_id, remark, created_at) VALUES (?, 'FINISH', ?, ?, ?, ?)`,
        [id, at, ctx.user?.id ?? null, remark, ctx.nowStr],
      )
      return { id }
    },
  },
  {
    method: 'POST',
    path: '/cases/:id/attachments',
    perms: [PERM.CASE_UPDATE],
    handler: () => {
      throw new ApiException(
        ERROR_CODE.NOT_FOUND,
        '公网演示版未启用附件上传（Workers 无本地磁盘；生产可接入 R2 对象存储后开启）',
      )
    },
  },
]

export { SELECT_PATIENT, toPatientListItem }
