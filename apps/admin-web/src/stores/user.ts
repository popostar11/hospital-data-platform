import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { LoginRequest, PermCode, UserInfo } from '@hospital/shared'
import * as authApi from '@/api/auth'
import { clearToken, getAccessToken, setToken } from '@/api/client'

/**
 * 登录态：token + 用户信息 + 权限点。
 * 权限点约定：perms 含 '*' 时视为超管，全部通过。
 */
export const useUserStore = defineStore('user', () => {
  const token = ref<string>(getAccessToken())
  const user = ref<UserInfo | null>(null)
  /** 是否已拉取过 /auth/me，路由守卫据此决定是否需要请求 */
  const loaded = ref(false)

  const perms = computed<PermCode[]>(() => user.value?.perms ?? [])
  const isSuper = computed<boolean>(() => (perms.value as string[]).includes('*'))

  function hasPerm(code: PermCode | PermCode[]): boolean {
    if (isSuper.value) return true
    const list = Array.isArray(code) ? code : [code]
    const owned = perms.value as string[]
    return list.some((item) => owned.includes(item))
  }

  async function login(payload: LoginRequest): Promise<UserInfo> {
    const res = await authApi.login(payload)
    setToken(res.accessToken, res.refreshToken)
    token.value = res.accessToken
    user.value = res.user
    loaded.value = true
    return res.user
  }

  async function fetchMe(force = false): Promise<UserInfo | null> {
    if (!token.value) return null
    if (loaded.value && !force && user.value) return user.value
    const info = await authApi.me()
    user.value = info
    loaded.value = true
    return info
  }

  /** 清空本地登录态（不发请求） */
  function reset(): void {
    clearToken()
    token.value = ''
    user.value = null
    loaded.value = false
  }

  /** 退出登录：接口失败也必须清本地状态 */
  async function logout(): Promise<void> {
    try {
      await authApi.logout()
    } catch {
      // 忽略退出接口异常
    }
    reset()
  }

  return { token, user, loaded, perms, isSuper, hasPerm, login, fetchMe, logout, reset }
})
