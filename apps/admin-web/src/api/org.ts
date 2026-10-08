import type { DepartmentNode, PageQuery, Paginated, UserListItem, UserSaveRequest } from '@hospital/shared'
import { del, get, post, put } from './client'

/** 角色列表项：契约里的 /roles 返回体（shared 只定义了 UserInfo.roles 的精简形态，故在此补充） */
export interface RoleItem {
  code: string
  name: string
  perms: string[]
  remark: string
}

/** 科室保存入参：由 shared 的 DepartmentNode 派生，避免重复定义同名字段 */
export type DepartmentSaveRequest = Omit<DepartmentNode, 'id' | 'children'>

/** 用户列表查询条件 */
export interface UserQuery extends PageQuery {
  keyword?: string
  deptId?: number
  enabled?: boolean
}

/** 科室树 */
export function listDepartments(): Promise<DepartmentNode[]> {
  return get<DepartmentNode[]>('/departments')
}

/** 新增科室 */
export function createDepartment(payload: DepartmentSaveRequest): Promise<{ id: number }> {
  return post<{ id: number }>('/departments', payload)
}

/** 编辑科室 */
export function updateDepartment(id: number, payload: DepartmentSaveRequest): Promise<void> {
  return put<void>(`/departments/${id}`, payload)
}

/** 删除科室 */
export function removeDepartment(id: number): Promise<void> {
  return del<void>(`/departments/${id}`)
}

/** 用户分页列表 */
export function listUsers(query: UserQuery): Promise<Paginated<UserListItem>> {
  return get<Paginated<UserListItem>>('/users', query)
}

/** 新增用户 */
export function createUser(payload: UserSaveRequest): Promise<{ id: number }> {
  return post<{ id: number }>('/users', payload)
}

/** 编辑用户 */
export function updateUser(id: number, payload: UserSaveRequest): Promise<void> {
  return put<void>(`/users/${id}`, payload)
}

/** 删除用户 */
export function removeUser(id: number): Promise<void> {
  return del<void>(`/users/${id}`)
}

/** 重置密码 */
export function resetPassword(id: number, password: string): Promise<void> {
  return post<void>(`/users/${id}/reset-password`, { password })
}

/** 角色列表（用于用户表单的角色多选） */
export function listRoles(): Promise<RoleItem[]> {
  return get<RoleItem[]>('/roles')
}
