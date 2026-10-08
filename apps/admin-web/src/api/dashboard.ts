import type { DashboardOverview } from '@hospital/shared'
import { get } from './client'

/** 工作台总览：卡片指标 + 近 7 日趋势 + 疾病分布 + 最新病例 */
export function overview(): Promise<DashboardOverview> {
  return get<DashboardOverview>('/dashboard/overview')
}
