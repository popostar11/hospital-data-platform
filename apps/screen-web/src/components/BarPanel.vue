<template>
  <PanelFrame :title="bar.title">
    <div ref="chartEl" class="bar-chart" />
    <div v-if="hasPartial" class="bar-note">注：末位为本月「至今」累计</div>
  </PanelFrame>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import type { ScreenBar } from '@hospital/shared'
import PanelFrame from './PanelFrame.vue'

const props = defineProps<{ bar: ScreenBar }>()

const chartEl = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

const hasPartial = computed(() => props.bar.months.some((m) => m.partial))

function render() {
  if (!chart) return
  const months = props.bar.months
  const yMax = props.bar.yMax || 100
  const interval = Math.max(1, Math.round(yMax / 4))
  chart.setOption(
    {
      backgroundColor: 'transparent',
      animationDuration: 800,
      grid: { left: 56, right: 22, top: 36, bottom: 30 },
      tooltip: { show: false },
      xAxis: {
        type: 'category',
        data: months.map((m) => m.label),
        axisLine: { lineStyle: { color: 'rgba(90,190,255,0.6)' } },
        axisTick: { show: false },
        axisLabel: { color: '#9fd8ff', fontSize: 16, fontWeight: 600, margin: 12 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: yMax,
        interval,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#9fd8ff', fontSize: 15 },
        splitLine: { lineStyle: { color: 'rgba(80,160,255,0.22)', type: 'dashed' } },
      },
      series: [
        {
          type: 'bar',
          barWidth: 24,
          itemStyle: { borderRadius: [2, 2, 0, 0] },
          label: {
            show: true,
            position: 'top',
            color: '#7fffe0',
            fontSize: 16,
            fontWeight: 700,
            distance: 6,
          },
          data: months.map((m) => ({
            value: m.value,
            // 当月为不完整月：用同色但降低饱和度提示，并加「本月至今」脚注
            itemStyle: { color: m.color, opacity: m.partial ? 0.85 : 1 },
          })),
        },
      ],
    },
    { notMerge: true },
  )
}

const resize = () => chart?.resize()

onMounted(() => {
  if (!chartEl.value) return
  chart = echarts.init(chartEl.value, undefined, { renderer: 'canvas' })
  render()
  window.addEventListener('resize', resize)
})

watch(() => props.bar, render, { deep: true })

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.bar-chart {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.bar-note {
  position: absolute;
  right: 30px;
  top: 8px;
  z-index: 3;
  font-size: 13px;
  color: rgba(150, 200, 240, 0.7);
  letter-spacing: 0.5px;
}
</style>
