import type { ApiResponse, ScreenBootstrap, ScreenStreamEvent } from '@hospital/shared'

const BASE = '/api/v1'

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

/** 整屏聚合数据（大屏首屏与刷新共用） */
export function fetchBootstrap(screenCode: string, force = false): Promise<ScreenBootstrap> {
  const qs = new URLSearchParams({ screenCode })
  if (force) qs.set('force', '1')
  return getJson<ScreenBootstrap>(`/screen/bootstrap?${qs.toString()}`)
}

export interface StreamHandlers {
  onEvent: (event: ScreenStreamEvent) => void
  onStateChange?: (state: 'open' | 'closed' | 'error') => void
}

/**
 * SSE 订阅：服务端只推「数据变了」的信号，收到后由调用方拉取聚合数据。
 * 浏览器原生断线重连，无需自行实现。
 */
export function subscribeScreenStream(screenCode: string, handlers: StreamHandlers): () => void {
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
      const parsed = JSON.parse(ev.data) as ScreenStreamEvent
      handlers.onEvent(parsed)
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
