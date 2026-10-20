import axios from 'axios'
import type { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import { ElMessage } from 'element-plus'
import { ERROR_CODE, ERROR_MESSAGES } from '@hospital/shared'
import type { ApiResponse } from '@hospital/shared'

/* =====================================================================
 * 统一请求层
 *   - 请求：注入 Authorization: Bearer <token>
 *   - 响应：按 { code, message, data, traceId } 解包，code===0 直接返回 data
 *   - 40100 / 40101：清 token 并跳登录页
 *   - 导出接口（二进制）走 download()，绕过统一包装
 * ===================================================================== */

const ACCESS_TOKEN_KEY = 'hospital_access_token'
const REFRESH_TOKEN_KEY = 'hospital_refresh_token'

export function getAccessToken(): string {
  return localStorage.getItem(ACCESS_TOKEN_KEY) ?? ''
}

export function getRefreshToken(): string {
  return localStorage.getItem(REFRESH_TOKEN_KEY) ?? ''
}

export function setToken(accessToken: string, refreshToken?: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function clearToken(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

/**
 * 登录失效处理：清 token + 回登录页。
 * 路由是 hash 模式且生产 base 为 /admin/，因此拼 BASE_URL + '#/login'
 * （不引 router，避免与 store 形成循环依赖）。
 */
function redirectToLogin(): void {
  clearToken()
  if (window.location.hash === '#/login') return
  window.location.href = `${import.meta.env.BASE_URL}#/login`
}

/** 同一批并发请求只提示一次同样的错误 */
let lastNotifyAt = 0
let lastNotifyText = ''
function notifyError(message: string): void {
  const now = Date.now()
  if (message === lastNotifyText && now - lastNotifyAt < 1500) return
  lastNotifyAt = now
  lastNotifyText = message
  ElMessage.error(message)
}

function isAuthError(code: number | undefined): boolean {
  return code === ERROR_CODE.UNAUTHORIZED || code === ERROR_CODE.TOKEN_EXPIRED
}

export const http: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  timeout: 20000,
})

http.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.set('Authorization', `Bearer ${token}`)
  return config
})

/**
 * 响应解包：code===0 时返回 data。
 * 返回值类型对 axios 而言仍是 AxiosResponse（类型系统无法表达「已被解包」），
 * 因此这里断言一次，业务侧统一通过 request()/get()/post() 拿到 data。
 */
function unwrapResponse(response: AxiosResponse<ApiResponse<unknown>>): unknown {
  // 二进制流（导出 xlsx）后端直接返回文件，跳过统一包装
  if (response.config.responseType === 'blob') return response

  const body = response.data
  // 非标准响应体（例如静态资源）原样返回，交给调用方判断
  if (!body || typeof body.code !== 'number') return body

  if (body.code === ERROR_CODE.OK) return body.data

  const message = body.message || ERROR_MESSAGES[body.code] || '请求失败'
  notifyError(message)
  if (isAuthError(body.code)) redirectToLogin()
  return Promise.reject(new Error(message))
}

http.interceptors.response.use(
  unwrapResponse as unknown as (response: AxiosResponse) => AxiosResponse,
  (error: AxiosError<ApiResponse<unknown>>) => {
    const status = error.response?.status
    const body = error.response?.data
    const code = body && typeof body.code === 'number' ? body.code : undefined

    if (status === 401 || isAuthError(code)) {
      notifyError(body?.message || ERROR_MESSAGES[ERROR_CODE.TOKEN_EXPIRED] || '登录已失效，请重新登录')
      redirectToLogin()
      return Promise.reject(error)
    }

    let message = body?.message
    if (!message) {
      if (error.code === 'ECONNABORTED') message = '请求超时，请稍后重试'
      else if (!error.response) message = '网络异常，无法连接服务端'
      else message = (code !== undefined ? ERROR_MESSAGES[code] : undefined) ?? `请求失败（HTTP ${status ?? 0}）`
    }
    notifyError(message)
    return Promise.reject(error)
  },
)

/**
 * 静态演示模式（GitHub Pages 无后端时启用）：
 * 构建时用 VITE_DEMO=1 打开，所有请求改由 src/api/demo.ts 用导出的快照回答。
 * 用动态 import 引入，正常构建里这个分支是死代码，不会把 mock 打进产物。
 */
export const DEMO_MODE = import.meta.env.VITE_DEMO === '1'

/** 统一请求：响应拦截器已把 { code, message, data } 解包为 data */
export function request<T>(config: AxiosRequestConfig): Promise<T> {
  if (DEMO_MODE) {
    return import('./demo').then((demo) =>
      demo.demoRequest(
        config.method ?? 'GET',
        String(config.url ?? ''),
        config.params as Record<string, unknown> | undefined,
        config.data,
      ),
    ) as Promise<T>
  }
  return http.request(config) as unknown as Promise<T>
}

export function get<T>(url: string, params?: object): Promise<T> {
  return request<T>({ url, method: 'GET', params })
}

export function post<T>(url: string, data?: unknown): Promise<T> {
  return request<T>({ url, method: 'POST', data })
}

export function put<T>(url: string, data?: unknown): Promise<T> {
  return request<T>({ url, method: 'PUT', data })
}

export function del<T>(url: string, params?: object): Promise<T> {
  return request<T>({ url, method: 'DELETE', params })
}

/** 文件导出：返回原始响应（含 headers），由调用方解析文件名并保存 */
export function download(url: string, params?: object): Promise<AxiosResponse<Blob>> {
  if (DEMO_MODE) {
    // 演示模式没有后端生成文件，明确提示而不是给一个空文件
    return import('./demo').then((demo) => demo.demoDownload()) as Promise<AxiosResponse<Blob>>
  }
  return http.request<Blob, AxiosResponse<Blob>>({ url, method: 'GET', params, responseType: 'blob' })
}
