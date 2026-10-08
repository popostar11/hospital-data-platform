import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { ScreenBootstrap } from '@hospital/shared'
import { fetchBootstrap, subscribeScreenStream } from '../api/screen'

export type ScreenStatus = 'loading' | 'online' | 'reconnecting' | 'error'

/**
 * 大屏数据源。
 *
 * 刷新策略（方案 §3.4）：
 *   1) SSE 收到「数据变了」信号 → 立即拉取（通常 1~3 秒内可见）；
 *   2) 无论 SSE 是否可用，都按配置周期轮询兜底；
 *   3) 连续失败保留上一次成功数据，只提示状态，绝不白屏。
 */
export function useScreenData(screenCode: string) {
  const data = shallowRef<ScreenBootstrap | null>(null)
  const status = ref<ScreenStatus>('loading')
  const failedCount = ref(0)
  const lastSuccessAt = ref('')
  /** 本轮新增的病例 id，用于行高亮 */
  const freshIds = ref<number[]>([])

  let timer: number | undefined
  let stopStream: (() => void) | undefined
  let disposed = false

  const schedule = () => {
    if (timer) window.clearTimeout(timer)
    const interval = (data.value?.config.refreshInterval ?? 30) * 1000
    timer = window.setTimeout(() => void load(true), Math.max(5, interval))
  }

  const load = async (force = false) => {
    if (disposed) return
    try {
      const next = await fetchBootstrap(screenCode, force)
      const prevIds = new Set((data.value?.table.rows ?? []).map((r) => r.id))
      const isFirst = data.value === null
      data.value = next
      freshIds.value = isFirst ? [] : next.table.rows.filter((r) => !prevIds.has(r.id)).map((r) => r.id)
      failedCount.value = 0
      status.value = 'online'
      lastSuccessAt.value = next.header.generatedAt
    } catch {
      failedCount.value += 1
      status.value = failedCount.value >= 3 ? 'error' : 'reconnecting'
    } finally {
      schedule()
    }
  }

  const onStreamEvent = (event: { type: string }) => {
    if (event.type === 'ping') return
    void load(true)
  }

  onMounted(() => {
    void load()
    // 支持 ?stream=0 关闭 SSE（截图/自动化测试时避免长连接阻塞页面加载完成）
    const streamDisabled = new URLSearchParams(window.location.search).get('stream') === '0'
    if (!streamDisabled) {
      stopStream = subscribeScreenStream(screenCode, { onEvent: onStreamEvent })
    }
  })

  onBeforeUnmount(() => {
    disposed = true
    if (timer) window.clearTimeout(timer)
    stopStream?.()
  })

  return { data, status, failedCount, lastSuccessAt, freshIds, reload: load }
}
