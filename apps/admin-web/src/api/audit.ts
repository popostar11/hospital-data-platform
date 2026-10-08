import type { AuditLogItem, LoginLogItem, PageQuery, Paginated, TimeRangeQuery } from '@hospital/shared'
import { get } from './client'

/** 操作日志查询条件 */
export interface AuditLogQuery extends PageQuery, TimeRangeQuery {
  keyword?: string
  module?: string
}

/** 登录日志查询条件 */
export interface LoginLogQuery extends PageQuery, TimeRangeQuery {
  keyword?: string
  success?: boolean
}

/** 操作日志 */
export function listAuditLogs(query: AuditLogQuery): Promise<Paginated<AuditLogItem>> {
  return get<Paginated<AuditLogItem>>('/audit/logs', query)
}

/** 登录日志 */
export function listLoginLogs(query: LoginLogQuery): Promise<Paginated<LoginLogItem>> {
  return get<Paginated<LoginLogItem>>('/audit/logins', query)
}
