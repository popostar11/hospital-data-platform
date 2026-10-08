import type { AxiosResponse } from 'axios'
import type { KpiResult, ReportResult } from '@hospital/shared'
import { download, get } from './client'

/** 报表统计维度：直接复用 shared 的 ReportResult['groupBy']，不重复定义 */
export type ReportGroupBy = ReportResult['groupBy']

/** 报表查询条件 */
export interface ReportQuery {
  from?: string
  to?: string
  groupBy?: ReportGroupBy
}

/** 绿道报表（表格 + 图表同源数据） */
export function greenChannel(query: ReportQuery): Promise<ReportResult> {
  return get<ReportResult>('/reports/green-channel', query)
}

/** 质控 KPI */
export function kpi(from?: string, to?: string): Promise<KpiResult> {
  return get<KpiResult>('/reports/kpi', { from, to })
}

/** 报表导出 xlsx（二进制） */
export function exportReport(query: ReportQuery): Promise<AxiosResponse<Blob>> {
  return download('/reports/export', query)
}
