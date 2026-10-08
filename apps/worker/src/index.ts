/**
 * Cloudflare Workers 入口：路由分发 + 鉴权 + 静态资源托管。
 *
 *   /api/v1/*   → JSON 接口（与本地 NestJS 版契约完全一致）
 *   /admin/*    → 管理后台静态产物
 *   /screen/*   → 大屏静态产物
 *   /           → 导航页
 *
 * 鉴权策略与本地版一致：默认全部接口需要登录，@Public / 大屏端点显式放行；
 * 大屏在 DEMO_MODE=true 时允许匿名只读（返回的数据本身已脱敏）。
 */
import { ERROR_CODE, DEFAULT_HOSPITAL_NAME } from '@hospital/shared'
import { Db } from './db'
import { ApiException, fail, newTraceId, ok } from './http'
import { loadSession, hasAnyPerm, authRoutes } from './routes/auth'
import { screenRoutes } from './routes/screen'
import { caseRoutes } from './routes/cases'
import { patientRoutes } from './routes/patients'
import { adminRoutes } from './routes/admin'
import { reportRoutes } from './routes/reports'
import { isDemo, type Ctx, type Env, type Route } from './types'

const API_PREFIX = '/api/v1'

/** 本地时区的当前时间字符串（'YYYY-MM-DD HH:mm:ss'） */
function localNow(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

const healthRoute: Route = {
  method: 'GET',
  path: '/health',
  isPublic: true,
  handler: () => ({ status: 'ok', runtime: 'cloudflare-workers', version: '0.1.0' }),
}

const routes: Route[] = [
  healthRoute,
  ...authRoutes,
  ...screenRoutes,
  ...caseRoutes,
  ...patientRoutes,
  ...adminRoutes,
  ...reportRoutes,
]

/** 极简路由匹配：把 /cases/:id 这类模式编译成正则 */
const compiled = routes.map((route) => {
  const names: string[] = []
  const pattern = route.path
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        names.push(seg.slice(1))
        return '([^/]+)'
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return { route, names, regex: new RegExp(`^${pattern}$`) }
})

function matchRoute(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const item of compiled) {
    if (item.route.method !== method) continue
    const m = pathname.match(item.regex)
    if (!m) continue
    const params: Record<string, string> = {}
    item.names.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1]!)))
    return { route: item.route, params }
  }
  return null
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET' || request.method === 'HEAD') return {}
  const text = await request.text()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    throw ApiException.param('请求体不是合法 JSON')
  }
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type,x-trace-id',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
}

function landingPage(): Response {
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>医院数据管理平台 · 急救绿道</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
       background:radial-gradient(1200px 600px at 50% 0%,#0b2a52 0%,#041226 60%,#020a16 100%);
       color:#dbeaff;font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif}
  h1{font-size:26px;letter-spacing:2px;margin:0 0 6px;color:#7fd9ff;text-shadow:0 0 18px rgba(24,224,255,.45)}
  .sub{color:#7f9dc4;margin-bottom:34px;font-size:14px;letter-spacing:1px}
  .cards{display:flex;gap:22px;flex-wrap:wrap;justify-content:center}
  .card{width:280px;padding:24px 22px;border-radius:14px;text-decoration:none;color:#dbeaff;
        background:linear-gradient(160deg,rgba(20,64,116,.85),rgba(8,26,52,.9));
        border:1px solid rgba(60,170,255,.35);box-shadow:0 10px 30px rgba(0,20,50,.5);transition:.2s}
  .card:hover{transform:translateY(-4px);border-color:rgba(24,224,255,.8)}
  .card h2{margin:0 0 8px;font-size:18px;color:#9fe6ff}
  .card p{margin:0 0 16px;font-size:13px;line-height:1.6;color:#8fb0d6}
  .go{font-size:13px;color:#18e0ff}
  footer{margin-top:38px;font-size:12px;color:#5d7ba3;text-align:center;line-height:1.8}
</style></head>
<body>
  <h1>医院数据管理平台</h1>
  <div class="sub">${DEFAULT_HOSPITAL_NAME} · 急救绿道（演示数据）</div>
  <div class="cards">
    <a class="card" href="/screen/"><h2>急救绿道大屏</h2><p>只读可视化终端，建议 1920×1080 全屏浏览</p><span class="go">进入 →</span></a>
    <a class="card" href="/admin/"><h2>后台管理系统</h2><p>病例管理、字典维护、统计报表、系统设置</p><span class="go">进入 →</span></a>
  </div>
  <footer>
    演示账号：admin / Hospital@123<br/>
    本站为技术演示，全部数据为合成的示例数据，不代表任何真实机构或真实统计结果
  </footer>
</body></html>`
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

async function serveAsset(env: Env, request: Request, url: URL): Promise<Response> {
  // 目录式访问补 index.html：/admin/ → /admin/index.html
  const pathname = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname
  const target = new URL(`${pathname}${url.search}`, url.origin)
  const res = await env.ASSETS.fetch(new Request(target.toString(), request))
  if (res.status !== 404) return res
  // SPA 回退：/admin/** 或 /screen/** 下找不到的资源交给各自的首页（hash 路由不需要，但兜底更稳）
  const app = url.pathname.startsWith('/admin') ? '/admin/index.html' : url.pathname.startsWith('/screen') ? '/screen/index.html' : null
  if (app) {
    const fallback = await env.ASSETS.fetch(new Request(new URL(app, url.origin).toString(), request))
    if (fallback.status !== 404) return fallback
  }
  return new Response('资源不存在', { status: 404 })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const traceId = request.headers.get('x-trace-id') ?? newTraceId()

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // ---------------------------------------------------------- 静态资源
    if (!url.pathname.startsWith('/api/')) {
      if (url.pathname === '/' || url.pathname === '') return landingPage()
      return serveAsset(env, request, url)
    }

    // -------------------------------------------------------------- 接口
    try {
      if (!url.pathname.startsWith(API_PREFIX)) throw ApiException.notFound('接口')
      const apiPath = url.pathname.slice(API_PREFIX.length) || '/'
      const matched = matchRoute(request.method, apiPath)
      if (!matched) throw ApiException.notFound(`接口 ${request.method} ${url.pathname}`)

      const { route, params } = matched
      const token = (() => {
        const header = request.headers.get('authorization')
        if (header?.startsWith('Bearer ')) return header.slice(7).trim()
        return url.searchParams.get('token')
      })()

      const user = await loadSession(env, token)
      if (!route.isPublic) {
        if (!user && !(route.isScreen && isDemo(env))) {
          throw new ApiException(ERROR_CODE.UNAUTHORIZED)
        }
        if (route.perms?.length && user && !hasAnyPerm(user, route.perms)) {
          throw ApiException.forbidden(`缺少权限：${route.perms.join(' / ')}`)
        }
        // 大屏端点要求登录时（DEMO_MODE=false），无令牌同样拒绝
        if (route.isScreen && !user && !isDemo(env)) {
          throw new ApiException(ERROR_CODE.UNAUTHORIZED)
        }
      }

      const ctx: Ctx = {
        req: request,
        env,
        db: new Db(env.DB),
        url,
        query: url.searchParams,
        params,
        body: await readBody(request),
        user,
        traceId,
        timeZone: env.DEFAULT_TIMEZONE ?? 'Asia/Shanghai',
        // 统一按本地时区（默认 UTC+8）算出“当前时间”字符串：
        // 库里 created_at 存的就是本地时间字符串，Worker 运行时区是 UTC，必须显式换算
        nowStr: localNow(env.DEFAULT_TIMEZONE ?? 'Asia/Shanghai'),
      }

      const data = await route.handler(ctx)
      if (data instanceof Response) return data
      return ok(data, traceId)
    } catch (err) {
      return fail(err, traceId)
    }
  },
} satisfies ExportedHandler<Env>
