/**
 * 业务错误码。
 * 铁律：后端只返回 code，不返回中文文案；文案由前端 i18n 映射（见 ERROR_MESSAGES）。
 */
export const ERROR_CODE = {
  OK: 0,
  PARAM_INVALID: 40001,
  UNAUTHORIZED: 40100,
  TOKEN_EXPIRED: 40101,
  FORBIDDEN: 40300,
  NOT_FOUND: 40400,
  CONFLICT: 40900,
  TOO_MANY_REQUESTS: 42900,
  INTERNAL_ERROR: 50000,
  EXTERNAL_UNAVAILABLE: 50301,
} as const
export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE]

export const ERROR_MESSAGES: Record<number, string> = {
  [ERROR_CODE.OK]: '操作成功',
  [ERROR_CODE.PARAM_INVALID]: '参数校验失败',
  [ERROR_CODE.UNAUTHORIZED]: '未登录或登录状态已失效',
  [ERROR_CODE.TOKEN_EXPIRED]: '登录已过期，请重新登录',
  [ERROR_CODE.FORBIDDEN]: '没有该操作的权限',
  [ERROR_CODE.NOT_FOUND]: '数据不存在或已被删除',
  [ERROR_CODE.CONFLICT]: '数据状态冲突，请刷新后重试',
  [ERROR_CODE.TOO_MANY_REQUESTS]: '操作过于频繁，请稍后再试',
  [ERROR_CODE.INTERNAL_ERROR]: '服务异常，请联系管理员',
  [ERROR_CODE.EXTERNAL_UNAVAILABLE]: '外部系统暂不可用',
}

/** 统一响应体 */
export interface ApiResponse<T> {
  code: number
  message: string
  data: T
  traceId: string
}

/** 分页响应 */
export interface Paginated<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}
