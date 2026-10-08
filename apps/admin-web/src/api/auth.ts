import type { LoginRequest, LoginResponse, UserInfo } from '@hospital/shared'
import { get, post } from './client'

/** 验证码状态：shared 未定义该出入参，按后端契约在此补充 */
export interface CaptchaResult {
  enabled: boolean
  captchaId?: string
  svg?: string
}

/** 自助修改密码入参：shared 未定义，按后端契约在此补充 */
export interface ChangePasswordRequest {
  oldPassword: string
  newPassword: string
}

/** 登录 */
export function login(payload: LoginRequest): Promise<LoginResponse> {
  return post<LoginResponse>('/auth/login', payload)
}

/** 刷新令牌 */
export function refresh(refreshToken: string): Promise<LoginResponse> {
  return post<LoginResponse>('/auth/refresh', { refreshToken })
}

/** 退出登录 */
export function logout(): Promise<void> {
  return post<void>('/auth/logout')
}

/** 当前登录用户信息 */
export function me(): Promise<UserInfo> {
  return get<UserInfo>('/auth/me')
}

/** 验证码开关（默认 enabled=false，登录页不显示验证码） */
export function captcha(): Promise<CaptchaResult> {
  return get<CaptchaResult>('/auth/captcha')
}

/** 自助修改密码（需校验原密码） */
export function changePassword(payload: ChangePasswordRequest): Promise<void> {
  return post<void>('/auth/change-password', payload)
}
