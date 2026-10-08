import { Injectable } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import type { DepartmentNode, Paginated, PermCode, RoleCode, UserListItem, UserSaveRequest } from '@hospital/shared'
import { ROLE_PERMS } from '@hospital/shared'
import { InjectDb } from '../../db/db.module'
import { now, v, type Db, type SqlValue } from '../../db/sqlite'
import { ApiException, orderBy, paging } from '../../common/api'
import { optionalBool, optionalNumber, optionalString, requiredString } from '../../common/validate'
import { AuthService } from '../auth/auth.service'

interface DeptRow {
  id: number
  parentId: number | null
  code: string
  name: string
  sortNo: number
  enabled: number
  remark: string | null
}

interface UserRow {
  id: number
  username: string
  realName: string
  deptId: number | null
  deptName: string | null
  enabled: number
  lastLoginAt: string | null
  createdAt: string
}

/** 组织与人员：科室树、用户、角色 */
@Injectable()
export class OrgService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  /* ----------------------------------------------------------- 科室 */

  departmentTree(): DepartmentNode[] {
    const rows = this.db.all<DeptRow>(
      `SELECT id, parent_id AS parentId, code, name, sort_no AS sortNo, enabled, remark
         FROM department ORDER BY sort_no ASC, id ASC`,
    )
    const nodes = new Map<number, DepartmentNode>()
    for (const r of rows) {
      nodes.set(r.id, { id: r.id, parentId: r.parentId, code: r.code, name: r.name, sortNo: r.sortNo, enabled: r.enabled === 1, children: [] })
    }
    const roots: DepartmentNode[] = []
    for (const node of nodes.values()) {
      if (node.parentId && nodes.has(node.parentId)) nodes.get(node.parentId)!.children!.push(node)
      else roots.push(node)
    }
    return roots
  }

  departmentFlat(): { id: number; parentId: number | null; code: string; name: string }[] {
    return this.db.all(
      'SELECT id, parent_id AS parentId, code, name FROM department WHERE enabled = 1 ORDER BY sort_no ASC, id ASC',
    )
  }

  createDepartment(body: Record<string, unknown>): number {
    const code = requiredString(body.code, '科室编码', 32)
    const name = requiredString(body.name, '科室名称', 64)
    if (this.db.get('SELECT id FROM department WHERE code = ?', [code])) throw ApiException.conflict(`科室编码 ${code} 已存在`)
    return this.db.insert('department', {
      parent_id: optionalNumber(body.parentId, '上级科室'),
      code,
      name,
      sort_no: optionalNumber(body.sortNo, '排序', 0, 9999) ?? 99,
      enabled: v(optionalBool(body.enabled, '启用状态') ?? true),
      remark: optionalString(body.remark, '备注', 200),
      created_at: now(),
    })
  }

  updateDepartment(id: number, body: Record<string, unknown>): void {
    const exists = this.db.get<{ id: number }>('SELECT id FROM department WHERE id = ?', [id])
    if (!exists) throw ApiException.notFound('科室')
    const data: Record<string, SqlValue> = {}
    if (body.name !== undefined) data.name = requiredString(body.name, '科室名称', 64)
    if (body.parentId !== undefined) data.parent_id = optionalNumber(body.parentId, '上级科室')
    if (body.sortNo !== undefined) data.sort_no = optionalNumber(body.sortNo, '排序', 0, 9999) ?? 99
    if (body.enabled !== undefined) data.enabled = v(optionalBool(body.enabled, '启用状态'))
    if (body.remark !== undefined) data.remark = optionalString(body.remark, '备注', 200)
    if (Object.keys(data).length === 0) return
    this.db.update('department', id, data)
  }

  removeDepartment(id: number): void {
    const children = this.db.scalar<number>('SELECT COUNT(*) FROM department WHERE parent_id = ?', [id]) ?? 0
    if (children > 0) throw ApiException.conflict('请先删除下级科室')
    const users = this.db.scalar<number>('SELECT COUNT(*) FROM sys_user WHERE dept_id = ? AND deleted_at IS NULL', [id]) ?? 0
    if (users > 0) throw ApiException.conflict(`该科室下还有 ${users} 名用户，无法删除`)
    const cases = this.db.scalar<number>('SELECT COUNT(*) FROM green_channel_case WHERE dept_id = ? AND deleted_at IS NULL', [id]) ?? 0
    if (cases > 0) throw ApiException.conflict(`该科室已关联 ${cases} 条病例，无法删除`)
    this.db.run('DELETE FROM department WHERE id = ?', [id])
  }

  /* ----------------------------------------------------------- 用户 */

  pageUsers(query: { page?: unknown; pageSize?: unknown; keyword?: string; deptId?: number; enabled?: boolean; sort?: string }): Paginated<UserListItem> {
    const { page, pageSize, offset } = paging(query)
    const where: string[] = ['u.deleted_at IS NULL']
    const params: SqlValue[] = []
    if (query.keyword) {
      where.push('(u.username LIKE ? OR u.real_name LIKE ?)')
      params.push(`%${query.keyword}%`, `%${query.keyword}%`)
    }
    if (query.deptId) {
      where.push('u.dept_id = ?')
      params.push(Number(query.deptId))
    }
    if (query.enabled !== undefined && query.enabled !== null) {
      where.push('u.enabled = ?')
      params.push(query.enabled ? 1 : 0)
    }
    const clause = where.join(' AND ')
    const total = this.db.scalar<number>(`SELECT COUNT(*) FROM sys_user u WHERE ${clause}`, params) ?? 0
    const order = orderBy(query.sort, { created_at: 'u.created_at', id: 'u.id', username: 'u.username' }, 'u.id ASC')
    const rows = this.db.all<UserRow>(
      `SELECT u.id, u.username, u.real_name AS realName, u.dept_id AS deptId, d.name AS deptName,
              u.enabled, u.last_login_at AS lastLoginAt, u.created_at AS createdAt
         FROM sys_user u LEFT JOIN department d ON d.id = u.dept_id
        WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )
    const list: UserListItem[] = rows.map((r) => ({
      id: r.id,
      username: r.username,
      realName: r.realName,
      deptId: r.deptId,
      deptName: r.deptName,
      roles: this.rolesOf(r.id),
      enabled: r.enabled === 1,
      lastLoginAt: r.lastLoginAt,
      createdAt: r.createdAt,
    }))
    return { list, total, page, pageSize }
  }

  createUser(body: UserSaveRequest): number {
    const username = requiredString(body.username, '登录账号', 32)
    const realName = requiredString(body.realName, '姓名', 32)
    const password = requiredString(body.password, '初始密码', 64)
    this.auth.assertPasswordStrength(password)
    if (this.db.get('SELECT id FROM sys_user WHERE username = ?', [username])) throw ApiException.conflict(`账号 ${username} 已存在`)
    const ts = now()
    const id = this.db.insert('sys_user', {
      username,
      password_hash: bcrypt.hashSync(password, 10),
      real_name: realName,
      dept_id: optionalNumber(body.deptId, '科室'),
      enabled: v(optionalBool(body.enabled, '启用状态') ?? true),
      last_login_at: null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    })
    this.assignRoles(id, body.roleCodes ?? [])
    return id
  }

  updateUser(id: number, body: UserSaveRequest): void {
    const exists = this.db.get<{ id: number }>('SELECT id FROM sys_user WHERE id = ? AND deleted_at IS NULL', [id])
    if (!exists) throw ApiException.notFound('用户')
    const data: Record<string, SqlValue> = { updated_at: now() }
    if (body.realName !== undefined) data.real_name = requiredString(body.realName, '姓名', 32)
    if (body.deptId !== undefined) data.dept_id = optionalNumber(body.deptId, '科室')
    if (body.enabled !== undefined) data.enabled = v(optionalBool(body.enabled, '启用状态'))
    if (body.password) {
      this.auth.assertPasswordStrength(body.password)
      data.password_hash = bcrypt.hashSync(body.password, 10)
    }
    this.db.update('sys_user', id, data)
    if (body.roleCodes) this.assignRoles(id, body.roleCodes)
  }

  removeUser(id: number, operatorId: number | null): void {
    if (id === operatorId) throw ApiException.conflict('不能删除当前登录账号')
    const row = this.db.get<{ username: string }>('SELECT username FROM sys_user WHERE id = ? AND deleted_at IS NULL', [id])
    if (!row) throw ApiException.notFound('用户')
    if (row.username === 'admin') throw ApiException.conflict('内置管理员账号不可删除')
    this.db.update('sys_user', id, { deleted_at: now(), enabled: 0 })
  }

  resetPassword(id: number, password: string): void {
    this.auth.assertPasswordStrength(password)
    const exists = this.db.get<{ id: number }>('SELECT id FROM sys_user WHERE id = ? AND deleted_at IS NULL', [id])
    if (!exists) throw ApiException.notFound('用户')
    this.db.update('sys_user', id, { password_hash: bcrypt.hashSync(password, 10), updated_at: now() })
  }

  listRoles(): { code: string; name: string; perms: string[]; remark: string }[] {
    const rows = this.db.all<{ code: string; name: string; perms: string; remark: string | null }>(
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

  private rolesOf(userId: number): { code: RoleCode; name: string }[] {
    const rows = this.db.all<{ code: string; name: string }>(
      'SELECT r.code, r.name FROM role r JOIN user_role ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.id',
      [userId],
    )
    return rows.map((r) => ({ code: r.code as RoleCode, name: r.name }))
  }

  private assignRoles(userId: number, roleCodes: RoleCode[]): void {
    this.db.run('DELETE FROM user_role WHERE user_id = ?', [userId])
    for (const code of roleCodes) {
      const role = this.db.get<{ id: number }>('SELECT id FROM role WHERE code = ?', [code])
      if (!role) {
        // 角色不存在时按默认权限表自动补建，避免前端传了未初始化的角色导致丢权限
        const fallback = ROLE_PERMS[code]
        const perms = fallback === '*' ? ['*'] : (fallback as PermCode[])
        const id = this.db.insert('role', {
          code,
          name: code,
          perms: JSON.stringify(perms),
          remark: null,
          created_at: now(),
        })
        this.db.run('INSERT OR IGNORE INTO user_role (user_id, role_id) VALUES (?, ?)', [userId, id])
        continue
      }
      this.db.run('INSERT OR IGNORE INTO user_role (user_id, role_id) VALUES (?, ?)', [userId, role.id])
    }
  }
}
