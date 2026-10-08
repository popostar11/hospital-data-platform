import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'

/**
 * ECharts 生命周期封装：挂载即渲染、option 变化增量更新、随窗口自适应、卸载销毁。
 * 用法：const { chartEl } = useChart(computed(() => ({ ... })))
 */
export function useChart(option: Ref<EChartsOption>) {
  const chartEl = ref<HTMLDivElement | null>(null)
  let chart: echarts.ECharts | null = null

  const resize = (): void => {
    chart?.resize()
  }

  onMounted(() => {
    if (!chartEl.value) return
    chart = echarts.init(chartEl.value)
    chart.setOption(option.value)
    window.addEventListener('resize', resize)
  })

  watch(option, (next) => {
    // notMerge：切换筛选维度后不残留上一次的系列
    chart?.setOption(next, true)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', resize)
    chart?.dispose()
    chart = null
  })

  return { chartEl, resize }
}
