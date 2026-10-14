import type { ApiResponse, ScreenBootstrap, ScreenStreamEvent } from '@hospital/shared'

const BASE = '/api/v1'

/** 静态演示模式：后端不可用（例如部署在 GitHub Pages 上）时改用随包发布的快照数据 */
let staticMode = false
export const isStaticMode = (): boolean => staticMode

/** 大屏标识：支持 ?screenCode=xxx 在同一台终端上切换不同科室大屏 */
export function resolveScreenCode(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('screenCode')
  return fromQuery && fromQuery.trim() ? fromQuery.trim() : 'main'
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as ApiResponse<T>
  if (body.code !== 0) throw new Error(body.message || '接口返回异常')
  return body.data
}

/**
 * 读取随包发布的静态快照。
 * 用相对地址解析，因此无论部署在域名根目录还是 /<仓库名>/ 子路径下都能取到。
 */
async function getStaticSnapshot(signal?: AbortSignal): Promise<ScreenBootstrap> {
  const url = new URL('demo-screen.json', window.location.href)
  const res = await fetch(url.toString(), { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`静态演示数据不可用（HTTP ${res.status}）`)
  const body = (await res.json()) as ApiResponse<ScreenBootstrap> | ScreenBootstrap
  const data = 'data' in body && body.data ? body.data : (body as ScreenBootstrap)
  // 快照里的时间戳是导出那一刻的，这里替换为当前时间，避免页面显示过期时间
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
  return { ...data, header: { ...data.header, serverTime: stamp, generatedAt: stamp, stale: true } }
}

/**
 * 整屏聚合数据（大屏首屏与刷新共用）。
 * 优先走后端；后端不可用时自动降级为静态快照，用于 GitHub Pages 这类纯静态托管。
 */
export async function fetchBootstrap(screenCode: string, force = false): Promise<ScreenBootstrap> {
  if (!staticMode) {
    try {
      const qs = new URLSearchParams({ screenCode })
      if (force) qs.set('force', '1')
      return await getJson<ScreenBootstrap>(`/screen/bootstrap?${qs.toString()}`)
    } catch (err) {
      staticMode = true
      console.warn('[大屏] 后端不可用，已切换为静态演示数据', err)
    }
  }
  return getStaticSnapshot()
}

export interface StreamHandlers {
  onEvent: (event: ScreenStreamEvent) => void
  onStateChange?: (state: 'open' | 'closed' | 'error') => void
}

/**
 * SSE 订阅：服务端只推「数据变了」的信号，收到后由调用方拉取聚合数据。
 * 静态演示模式下没有后端，调用方会跳过订阅（见 useScreenData）。
 */
export function subscribeScreenStream(screenCode: string, handlers: StreamHandlers): () => void {
  if (staticMode) return () => undefined
  let source: EventSource | null = null
  try {
    source = new EventSource(`${BASE}/screen/stream?screenCode=${encodeURIComponent(screenCode)}`)
  } catch {
    handlers.onStateChange?.('error')
    return () => undefined
  }
  source.onopen = () => handlers.onStateChange?.('open')
  source.onmessage = (ev: MessageEvent<string>) => {
    try {
      handlers.onEvent(JSON.parse(ev.data) as ScreenStreamEvent)
    } catch {
      /* 忽略无法解析的心跳 */
    }
  }
  source.onerror = () => handlers.onStateChange?.('error')
  return () => {
    source?.close()
    handlers.onStateChange?.('closed')
  }
}
