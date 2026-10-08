/**
 * 字典、组织人员、审计与开放接口路由。
 * 路径与本地 NestJS 版完全一致，前端无需任何改动。
 */
import { PERM, ROLE_PERMS, SOURCE_TYPE, type RoleCode } from '@hospital/shared'
import { now } from '../db'
import { ApiException, optionalBool, optionalNumber, optionalString, orderBy, paging, requireString } from '../http'
import { hashPassword } from '../security'
import type { Ctx, Route } from '../types'

const DICT_TYPES = ['disease', 'sourceType', 'caseStatus', 'eventType'] as const
const SELECT_DICT = `SELECT id, type, code, name, color, sort_no AS sortNo, enabled, remark FROM dict_item`

interface DictRow {
  id: number
  type: string
  code: string
  name: string
  color: string | null
  sortNo: number
  enabled: number
  remark: string | null
}

/** 引用计数：字典被引用时不允许删除（避免历史病例失去名称） */
async function refCount(ctx: Ctx, type: string, code: string): Promise<number> {
  const table =
    type === 'disease' ? ['green_channel_case', 'disease_code'] :
    type === 'sourceType' ? ['green_channel_case', 'source_type'] :
    type === 'caseStatus' ? ['green_channel_case', 'status_code'] :
    type === 'eventType' ? ['case_event', 'event_code'] : null
  if (!table) return 0
  return (await ctx.db.scalar<number>(`SELECT COUNT(*) FROM ${table[0]} WHERE ${table[1]} = ?`, [code])) ?? 0
}

async function listRoles(ctx: Ctx): Promise<{ code: string; name: string; perms: string[]; remark: string }[]> {
  const rows = await ctx.db.all<{ code: string; name: string; perms: string; remark: string | null }>(
    'SELECT code, name, perms, remark FROM role ORDER BY id ASC',
  )
  return rows.map((r) => {
    let perms: string[] = []
    try {
      perms = JSON.parse(r.perms)
    } catch {
      perms = []
    }
    return { code: r.code, name: r.name, perms, remark: r.remark ?? '' }
  })
}

async function assignRoles(ctx: Ctx, userId: number, roleCodes: string[]): Promise<void> {
  await ctx.db.run('DELETE FROM user_role WHERE user_id = ?', [userId])
  for (const code of roleCodes) {
    let role = await ctx.db.get<{ id: number }>('SELECT id FROM role WHERE code = ?', [code])
    if (!role) {
      // 角色不存在则按默认权限表补建，避免前端传了未初始化的角色导致丢权限
      const fallback = ROLE_PERMS[code as RoleCode]
      const perms = fallback === '*' ? ['*'] : (fallback ?? [])
      const id = await ctx.db.insert('role', {
        code,
        name: code,
        perms: JSON.stringify(perms),
        remark: null,
        created_at: ctx.nowStr,
      })
      role = { id }
    }
    await ctx.db.run('INSERT OR IGNORE INTO user_role (user_id, role_id) VALUES (?, ?)', [userId, role.id])
  }
}

export const adminRoutes: Route[] = [
  /* ------------------------------------------------------------- 字典 */
  {
    method: 'GET',
    path: '/dicts',
    perms: [PERM.DICT_VIEW],
    handler: async (ctx) => {
      const type = ctx.query.get('type')
      const withRef = ctx.query.get('withRef') === '1'
      const rows = await ctx.db.all<DictRow>(
        `${SELECT_DICT}${type ? ' WHERE type = ?' : ''} ORDER BY type ASC, sort_no ASC, id ASC`,
        type ? [type] : [],
      )
      if (!withRef) return rows
      return Promise.all(rows.map(async (r) => ({ ...r, refCount: await refCount(ctx, r.type, r.code) })))
    },
  },
  {
    method: 'POST',
    path: '/dicts',
    perms: [PERM.DICT_UPDATE],
    handler: async (ctx) => {
      const type = requireString(ctx.body.type, '字典类型', 32)
      if (!DICT_TYPES.includes(type as never)) throw ApiException.param('字典类型不合法')
      const code = requireString(ctx.body.code, '字典编码', 32)
      const name = requireString(ctx.body.name, '字典名称', 64)
      if (await ctx.db.get('SELECT id FROM dict_item WHERE type = ? AND code = ?', [type, code])) {
        throw ApiException.conflict(`字典编码 ${code} 已存在`)
      }
      const id = await ctx.db.insert('dict_item', {
        type,
        code,
        name,
        color: optionalString(ctx.body.color, '颜色', 16),
        sort_no: optionalNumber(ctx.body.sortNo, '排序', 0, 9999) ?? 99,
        enabled: optionalBool(ctx.body.enabled) === false ? 0 : 1,
        remark: optionalString(ctx.body.remark, '备注', 200),
        created_at: ctx.nowStr,
        updated_at: ctx.nowStr,
      })
      return ctx.db.get(`${SELECT_DICT} WHERE id = ?`, [id])
    },
  },
  {
    method: 'PUT',
    path: '/dicts/:id',
    perms: [PERM.DICT_UPDATE],
    handler: async (ctx) => {
      const id = Number(ctx.params.id)
      const current = await ctx.db.get<DictRow>(`${SELECT_DICT} WHERE id = ?`, [id])
      if (!current) throw ApiException.notFound('字典项')
      const data: Record<string, unknown> = { updated_at: ctx.nowStr }
      if (ctx.body.name !== undefined) data.name = requireString(ctx.body.name, '字典名称', 64)
      if (ctx.body.color !== undefined) data.color = optionalString(ctx.body.color, '颜色', 16)
      if (ctx.body.sortNo !== undefined) data.sort_no = optionalNumber(ctx.body.sortNo, '排序', 0, 9999) ?? 99
      if (ctx.body.enabled !== undefined) data.enabled = optionalBool(ctx.body.enabled) ? 1 : 0
      if (ctx.body.remark !== undefined) data.remark = optionalString(ctx.body.remark, '备注', 200)
      await ctx.db.update('dict_item', id, data)
      return ctx.db.get(`${SELECT_DICT} WHERE id = ?`, [id])
    },
  },
  {
    method: 'DELETE',
    path: '/dicts/:id',
    perms: [PERM.DICT_UPDATE],
    handler: async (ctx) => {
      const id = Number(ctx.params.id)
      const current = await ctx.db.get<DictRow>(`${SELECT_DICT} WHERE id = ?`, [id])
      if (!current) throw ApiException.notFound('字典项')
      const refs = await refCount(ctx, current.type, current.code)
      if (refs > 0) throw ApiException.conflict(`该字典项已被 ${refs} 条病例引用，无法删除，可改为停用`)
      await ctx.db.run('DELETE FROM dict_item WHERE id = ?', [id])
      return { id }
    },
  },

  /* ------------------------------------------------------------- 科室 */
  {
    method: 'GET',
    path: '/departments',
    perms: [PERM.ORG_VIEW],
    handler: async (ctx) => {
      const rows = await ctx.db.all<{ id: number; parentId: number | null; code: string; name: string; sortNo: number; enabled: number }>(
        'SELECT id, parent_id AS parentId, code, name, sort_no AS sortNo, enabled FROM department ORDER BY sort_no ASC, id ASC',
      )
      const nodes = new Map(rows.map((r) => [r.id, { ...r, enabled: r.enabled === 1, children: [] as unknown[] }]))
      const roots: unknown[] = []
      for (const node of nodes.values()) {
        if (node.parentId && nodes.has(node.parentId)) nodes.get(node.parentId)!.children.push(node)
        else roots.push(node)
      }
      return roots
    },
  },
  {
    method: 'GET',
    path: '/departments/flat',
    perms: [PERM.CASE_VIEW],
    handler: (ctx) =>
      ctx.db.all('SELECT id, parent_id AS parentId, code, name FROM department WHERE enabled = 1 ORDER BY sort_no ASC, id ASC'),
  },
  {
    method: 'POST',
    path: '/departments',
    perms: [PERM.ORG_UPDATE],
    handler: async (ctx) => {
      const code = requireString(ctx.body.code, '科室编码', 32)
      const name = requireString(ctx.body.name, '科室名称', 64)
      if (await ctx.db.get('SELECT id FROM department WHERE code = ?', [code])) throw ApiException.conflict(`科室编码 ${code} 已存在`)
      const id = await ctx.db.insert('department', {
        parent_id: optionalNumber(ctx.body.parentId, '上级科室'),
        code,
        name,
        sort_no: optionalNumber(ctx.body.sortNo, '排序', 0, 9999) ?? 99,
        enabled: optionalBool(ctx.body.enabled) === false ? 0 : 1,
        remark: optionalString(ctx.body.remark, '备注', 200),
        created_at: ctx.nowStr,
      })
      return { id }
    },
  },
  {
    method: 'PUT',
    path: '/departments/:id',
    perms: [PERM.ORG_UPDATE],
    handler: async (ctx) => {
      const id = Number(ctx.params.id)
      if (!(await ctx.db.get('SELECT id FROM department WHERE id = ?', [id]))) throw ApiException.notFound('科室')
      const data: Record<string, unknown> = {}
      if (ctx.body.name !== undefined) data.name = requireString(ctx.body.name, '科室名称', 64)
      if (ctx.body.parentId !== undefined) data.parent_id = optionalNumber(ctx.body.parentId, '上级科室')
      if (ctx.body.sortNo !== undefined) data.sort_no = optionalNumber(ctx.body.sortNo, '排序', 0, 9999) ?? 99
      if (ctx.body.enabled !== undefined) data.enabled = optionalBool(ctx.body.enabled) ? 1 : 0
      if (Object.keys(data).length) await ctx.db.update('department', id, data)
      return { id }
    },
  },
  {
    method: 'DELETE',
    path: '/departments/:id',
    perms: [PERM.ORG_UPDATE],
    handler: async (ctx) => {
      const id = Number(ctx.params.id)
      const children = (await ctx.db.scalar<number>('SELECT COUNT(*) FROM department WHERE parent_id = ?', [id])) ?? 0
      if (children > 0) throw ApiException.conflict('请先删除下级科室')
      const users = (await ctx.db.scalar<number>('SELECT COUNT(*) FROM sys_user WHERE dept_id = ? AND deleted_at IS NULL', [id])) ?? 0
      if (users > 0) throw ApiException.conflict(`该科室下还有 ${users} 名用户，无法删除`)
      const cases = (await ctx.db.scalar<number>('SELECT COUNT(*) FROM green_channel_case WHERE dept_id = ? AND deleted_at IS NULL', [id])) ?? 0
      if (cases > 0) throw ApiException.conflict(`该科室已关联 ${cases} 条病例，无法删除`)
      await ctx.db.run('DELETE FROM department WHERE id = ?', [id])
      return { id }
    },
  },

  /* ------------------------------------------------------------- 用户 */
  {
    method: 'GET',
    path: '/users',
    perms: [PERM.ORG_VIEW],
    handler: async (ctx) => {
      const { page, pageSize, offset } = paging(ctx.query)
      const where: string[] = ['u.deleted_at IS NULL']
      const params: unknown[] = []
      const keyword = ctx.query.get('keyword')
      if (keyword) {
        where.push('(u.username LIKE ? OR u.real_name LIKE ?)')
        params.push(`%${keyword}%`, `%${keyword}%`)
      }
      const deptId = ctx.query.get('deptId')
      if (deptId) {
        where.push('u.dept_id = ?')
        params.push(Number(deptId))
      }
      const enabled = ctx.query.get('enabled')
      if (enabled !== null && enabled !== '') {
        where.push('u.enabled = ?')
        params.push(enabled === 'true' || enabled === '1' ? 1 : 0)
      }
      const clause = where.join(' AND ')
      const total = (await ctx.db.scalar<number>(`SELECT COUNT(*) FROM sys_user u WHERE ${clause}`, params)) ?? 0
      const order = orderBy(ctx.query.get('sort'), { created_at: 'u.created_at', id: 'u.id', username: 'u.username' }, 'u.id ASC')
      const rows = await ctx.db.all<{ id: number; username: string; realName: string; deptId: number | null; deptName: string | null; enabled: number; lastLoginAt: string | null; createdAt: string }>(
        `SELECT u.id, u.username, u.real_name AS realName, u.dept_id AS deptId, d.name AS deptName,
                u.enabled, u.last_login_at AS lastLoginAt, u.created_at AS createdAt
           FROM sys_user u LEFT JOIN department d ON d.id = u.dept_id
          WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
        [...params, pageSize, offset],
      )
      const list = await Promise.all(
        rows.map(async (r) => {
          const roleRows = await ctx.db.all<{ code: string; name: string }>(
            'SELECT r.code, r.name FROM role r JOIN user_role ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.id',
            [r.id],
          )
          return { ...r, enabled: r.enabled === 1, roles: roleRows }
        }),
      )
      return { list, total, page, pageSize }
    },
  },
  {
    method: 'GET',
    path: '/roles',
    perms: [PERM.ORG_VIEW],
    handler: (ctx) => listRoles(ctx),
  },
  {
    method: 'POST',
    path: '/users',
    perms: [PERM.ORG_UPDATE],
    handler: async (ctx) => {
      const username = requireString(ctx.body.username, '登录账号', 32)
      const realName = requireString(ctx.body.realName, '姓名', 32)
      const password = requireString(ctx.body.password, '初始密码', 64)
      if (password.length < 8) throw ApiException.param('密码长度至少 8 位')
      if (await ctx.db.get('SELECT id FROM sys_user WHERE username = ?', [username])) throw ApiException.conflict(`账号 ${username} 已存在`)
      const id = await ctx.db.insert('sys_user', {
        username,
        password_hash: await hashPassword(password),
        real_name: realName,
        dept_id: optionalNumber(ctx.body.deptId, '科室'),
        enabled: optionalBool(ctx.body.enabled) === false ? 0 : 1,
        last_login_at: null,
        created_at: ctx.nowStr,
        updated_at: ctx.nowStr,
        deleted_at: null,
      })
      await assignRoles(ctx, id, (ctx.body.roleCodes as string[]) ?? [])
      return { id }
    },
  },
  {
    method: 'PUT',
    path: '/users/:id',
    perms: [PERM.ORG_UPDATE],
    handler: async (ctx) => {
      const id = Number(ctx.params.id)
      if (!(await ctx.db.get('SELECT id FROM sys_user WHERE id = ? AND deleted_at IS NULL', [id]))) throw ApiException.notFound('用户')
      const data: Record<string, unknown> = { updated_at: now(ctx.timeZone) }
      if (ctx.body.realName !== undefined) data.real_name = requireString(ctx.body.realName, '姓名', 32)
      if (ctx.body.deptId !== undefined) data.dept_id = optionalNumber(ctx.body.deptId, '科室')
      if (ctx.body.enabled !== undefined) data.enabled = optionalBool(ctx.body.enabled) ? 1 : 0
      if (ctx.body.password) {
        const pwd = requireString(ctx.body.password, '密码', 64)
        if (pwd.length < 8) throw ApiException.param('密码长度至少 8 位')
        data.password_hash = await hashPassword(pwd)
      }
      await ctx.db.update('sys_user', id, data)
      if (ctx.body.roleCodes) await assignRoles(ctx, id, ctx.body.roleCodes as string[])
      return { id }
    },
  },
  {
    method: 'DELETE',
    path: '/users/:id',
    perms: [PERM.ORG_UPDATE],
    handler: async (ctx) => {
      const id = Number(ctx.params.id)
      if (id === ctx.user!.id) throw ApiException.conflict('不能删除当前登录账号')
      const row = await ctx.db.get<{ username: string }>('SELECT username FROM sys_user WHERE id = ? AND deleted_at IS NULL', [id])
      if (!row) throw ApiException.notFound('用户')
      if (row.username === 'admin') throw ApiException.conflict('内置管理员账号不可删除')
      await ctx.db.update('sys_user', id, { deleted_at: ctx.nowStr, enabled: 0 })
      return { id }
    },
  },
  {
    method: 'POST',
    path: '/users/:id/reset-password',
    perms: [PERM.ORG_UPDATE],
    handler: async (ctx) => {
      const id = Number(ctx.params.id)
      const password = requireString(ctx.body.password, '新密码', 64)
      if (password.length < 8) throw ApiException.param('密码长度至少 8 位')
      if (!(await ctx.db.get('SELECT id FROM sys_user WHERE id = ? AND deleted_at IS NULL', [id]))) throw ApiException.notFound('用户')
      await ctx.db.update('sys_user', id, { password_hash: await hashPassword(password), updated_at: ctx.nowStr })
      return { id }
    },
  },

  /* ------------------------------------------------------------- 审计 */
  {
    method: 'GET',
    path: '/audit/logs',
    perms: [PERM.AUDIT_VIEW],
    handler: async (ctx) => {
      const { page, pageSize, offset } = paging(ctx.query)
      const where: string[] = ['1=1']
      const params: unknown[] = []
      const keyword = ctx.query.get('keyword')
      if (keyword) {
        where.push('(user_name LIKE ? OR target_id LIKE ? OR detail LIKE ?)')
        params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
      }
      const module = ctx.query.get('module')
      if (module) {
        where.push('module = ?')
        params.push(module)
      }
      const from = ctx.query.get('from')
      if (from) {
        where.push('created_at >= ?')
        params.push(`${from} 00:00:00`)
      }
      const to = ctx.query.get('to')
      if (to) {
        where.push('created_at <= ?')
        params.push(`${to} 23:59:59`)
      }
      const clause = where.join(' AND ')
      const total = (await ctx.db.scalar<number>(`SELECT COUNT(*) FROM sys_oper_log WHERE ${clause}`, params)) ?? 0
      const list = await ctx.db.all(
        `SELECT id, user_id AS userId, user_name AS userName, module, action, target_type AS targetType,
                target_id AS targetId, detail, ip, created_at AS createdAt
           FROM sys_oper_log WHERE ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, offset],
      )
      return { list, total, page, pageSize }
    },
  },
  {
    method: 'GET',
    path: '/audit/logins',
    perms: [PERM.AUDIT_VIEW],
    handler: async (ctx) => {
      const { page, pageSize, offset } = paging(ctx.query)
      const where: string[] = ['1=1']
      const params: unknown[] = []
      const keyword = ctx.query.get('keyword')
      if (keyword) {
        where.push('username LIKE ?')
        params.push(`%${keyword}%`)
      }
      const success = ctx.query.get('success')
      if (success !== null && success !== '') {
        where.push('success = ?')
        params.push(success === 'true' || success === '1' ? 1 : 0)
      }
      const clause = where.join(' AND ')
      const total = (await ctx.db.scalar<number>(`SELECT COUNT(*) FROM sys_login_log WHERE ${clause}`, params)) ?? 0
      const list = await ctx.db.all(
        `SELECT id, username, success, message, ip, user_agent AS userAgent, created_at AS createdAt
           FROM sys_login_log WHERE ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, offset],
      )
      return { list, total, page, pageSize }
    },
  },

  /* --------------------------------------------------------- 对接与开放 */
  {
    method: 'GET',
    path: '/integrations/logs',
    perms: [PERM.INTEGRATION_VIEW],
    handler: async (ctx) => {
      const { page, pageSize, offset } = paging(ctx.query)
      const total = (await ctx.db.scalar<number>('SELECT COUNT(*) FROM integration_log')) ?? 0
      const list = await ctx.db.all(
        `SELECT id, source, direction, endpoint, biz_id AS bizId, success, message, created_at AS createdAt
           FROM integration_log ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        [pageSize, offset],
      )
      return { list, total, page, pageSize }
    },
  },
  {
    method: 'POST',
    path: '/open/cases',
    isPublic: true,
    handler: async (ctx) => {
      const diseaseCode = requireString(ctx.body.diseaseCode, '疾病类型', 32)
      const sourceType = requireString(ctx.body.sourceType, '推送方式', 32)
      if (!Object.values(SOURCE_TYPE).includes(sourceType as never)) throw ApiException.param('推送方式取值不合法')
      const idemKey = ctx.body.idemKey ? String(ctx.body.idemKey) : null
      if (idemKey) {
        const hit = await ctx.db.get<{ caseId: number | null }>('SELECT case_id AS caseId FROM open_api_idempotent WHERE idem_key = ?', [idemKey])
        if (hit) return { id: hit.caseId, idempotent: true }
      }
      const patientName = requireString((ctx.body.patient as Record<string, unknown> | undefined)?.name, '患者姓名', 32)
      const createdAt = ctx.nowStr
      const patientId = await ctx.db.insert('patient', {
        mrn: null,
        name_cipher: '',
        name_masked: (await import('../services')).maskNameOnly(patientName),
        gender: 9,
        birth_date: null,
        id_card_cipher: null,
        id_card_masked: null,
        phone_cipher: null,
        phone_masked: null,
        remark: null,
        created_at: createdAt,
        updated_at: createdAt,
        deleted_at: null,
      })
      const id = await ctx.db.insert('green_channel_case', {
        case_no: await (await import('../services')).nextCaseNo(ctx.db, createdAt),
        patient_id: patientId,
        dept_id: null,
        disease_code: diseaseCode,
        source_type: sourceType,
        status_code: 'CREATED',
        distance_km: optionalNumber(ctx.body.distanceKm, '距离', 0, 9999),
        onset_at: null,
        arrive_at: null,
        created_at: createdAt,
        updated_at: createdAt,
        closed_at: null,
        is_closed: 0,
        creator_id: null,
        remark: optionalString(ctx.body.remark, '备注', 500),
        deleted_at: null,
      })
      if (idemKey) {
        await ctx.db.run('INSERT OR REPLACE INTO open_api_idempotent (idem_key, case_id, created_at) VALUES (?, ?, ?)', [idemKey, id, ctx.nowStr])
      }
      await ctx.db.insert('integration_log', {
        source: 'HIS',
        direction: 'IN',
        endpoint: '/api/v1/open/cases',
        biz_id: String(id),
        success: 1,
        message: '接收成功',
        payload: null,
        created_at: ctx.nowStr,
      })
      return { id }
    },
  },
]
