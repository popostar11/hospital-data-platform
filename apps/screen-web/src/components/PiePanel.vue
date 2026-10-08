<template>
  <PanelFrame :title="pie.title">
    <div ref="chartEl" class="pie-chart" />
    <div class="pie-center" :style="centerStyle">
      <span class="pie-center__label">{{ pie.centerLabel }}</span>
    </div>
    <ul class="pie-legend">
      <li v-for="item in pie.items" :key="item.code">
        <i :style="{ background: dotColor(item) }" />
        <span class="pie-legend__name">{{ item.name }}</span>
        <span class="pie-legend__value">{{ item.value }}</span>
      </li>
    </ul>
    <div class="hud-floor" />
  </PanelFrame>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import type { ScreenPie, ScreenPieItem } from '@hospital/shared'
import PanelFrame from './PanelFrame.vue'
import { PIE_GRADIENT } from '@hospital/shared'

const props = defineProps<{ pie: ScreenPie }>()

const chartEl = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

/** 与素材一致：单病种时用「黄 → 粉」渐变；多病种时按字典颜色区分 */
const singleMode = computed(() => props.pie.items.length <= 1)

function sliceColor(item: ScreenPieItem, index: number): string | echarts.graphic.LinearGradient {
  if (singleMode.value) {
    return new echarts.graphic.LinearGradient(0, 0, 1, 1, [
      { offset: 0, color: PIE_GRADIENT[0] },
      { offset: 1, color: PIE_GRADIENT[1] },
    ])
  }
  return item.color || '#3FA9FF'
}

function dotColor(item: ScreenPieItem): string {
  // 单病种时图例圆点取渐变的中间色，与照片观感一致
  return singleMode.value ? '#FFBE97' : item.color
}

const centerStyle = computed(() => ({ left: '43%', top: '52%' }))

function render() {
  if (!chart) return
  const items = props.pie.items.length ? props.pie.items : [{ code: 'EMPTY', name: '暂无数据', value: 0, color: '#25476f' }]
  chart.setOption(
    {
      backgroundColor: 'transparent',
      animationDuration: 700,
      tooltip: { show: false },
      series: [
        {
          type: 'pie',
          radius: ['46%', '64%'],
          center: ['43%', '52%'],
          startAngle: 90,
          avoidLabelOverlap: true,
          itemStyle: {
            borderColor: 'rgba(4,18,43,0.55)',
            borderWidth: 2,
          },
          label: {
            show: true,
            position: 'outside',
            formatter: (params: { value?: unknown }) => String(Math.round(Number(params.value ?? 0))),
            color: '#d6ecff',
            fontSize: 20,
            fontWeight: 700,
          },
          labelLine: {
            show: true,
            length: 14,
            length2: 18,
            lineStyle: { color: 'rgba(130,205,255,0.75)', width: 1 },
          },
          data: items.map((item, index) => ({
            name: item.name,
            value: item.value,
            itemStyle: { color: sliceColor(item, index) },
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

watch(() => props.pie, render, { deep: true })

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.pie-chart {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.pie-center {
  position: absolute;
  z-index: 3;
  transform: translate(-50%, -50%);
  width: 120px;
  height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.pie-center__label {
  font-size: 25px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #ffffff;
  text-shadow: 0 0 12px rgba(255, 220, 160, 0.85);
}

.pie-legend {
  position: absolute;
  left: 66%;
  top: 44%;
  z-index: 3;
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 32%;
}

.pie-legend li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 21px;
  color: #e2f2ff;
  white-space: nowrap;
}

.pie-legend i {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  box-shadow: 0 0 10px rgba(255, 190, 150, 0.8);
  flex: 0 0 auto;
}

.pie-legend__value {
  color: #ffffff;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
</style>
