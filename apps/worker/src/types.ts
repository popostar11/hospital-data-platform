import type { Db } from './db'

/** Workers 绑定与环境变量（wrangler.toml 的 [vars] 与 secret） */
export interface Env {
  /** D1 数据库绑定 */
  DB: D1Database
  /** 静态资源绑定（两个前端构建产物） */
  ASSETS: Fetcher
  /** 登录令牌签名密钥（wrangler secret put JWT_SECRET） */
  JWT_SECRET: string
  /** 演示模式：true 时大屏允许匿名只读 */
  DEMO_MODE?: string
  /** 大屏聚合缓存秒数 */
  SCREEN_CACHE_TTL?: string
  /** 大屏 24 小时表格条数上限 */
  SCREEN_TABLE_LIMIT?: string
  /** 时区（默认 Asia/Shanghai） */
  DEFAULT_TIMEZONE?: string
}

export interface SessionUser {
  id: number
  username: string
  realName: string
  deptId: number | null
  roles: string[]
  perms: string[]
}

/** 单个请求的上下文 */
export interface Ctx {
  req: Request
  env: Env
  db: Db
  url: URL
  query: URLSearchParams
  params: Record<string, string>
  body: Record<string, unknown>
  user: SessionUser | null
  traceId: string
  timeZone: string
  /** 初始化时算好的“当前时间”（本地时区），避免各处重复计算 */
  nowStr: string
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** 形如 /cases/:id，实际匹配时会自动带上 /api/v1 前缀 */
  path: string
  handler: Handler
  /** 无需登录（登录、验证码、健康检查） */
  isPublic?: boolean
  /** 大屏端点：演示模式下允许匿名只读 */
  isScreen?: boolean
  /** 需要的权限点（任一命中即可） */
  perms?: string[]
}

export const isDemo = (env: Env): boolean => String(env.DEMO_MODE ?? 'true') !== 'false'
export const screenCacheTtl = (env: Env): number => Number(env.SCREEN_CACHE_TTL ?? 5) || 5
export const screenTableLimit = (env: Env): number => Number(env.SCREEN_TABLE_LIMIT ?? 20) || 20
