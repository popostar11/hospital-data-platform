import type { ScreenConfigItem, ScreenConfigSaveRequest } from '@hospital/shared'
import { get, put } from './client'

/** 大屏配置列表（每个 screenCode 一条） */
export function listScreenConfigs(): Promise<ScreenConfigItem[]> {
  return get<ScreenConfigItem[]>('/screen-configs')
}

/** 保存大屏配置 */
export function saveScreenConfig(
  screenCode: string,
  payload: ScreenConfigSaveRequest,
): Promise<ScreenConfigItem> {
  return put<ScreenConfigItem>(`/screen-configs/${screenCode}`, payload)
}
