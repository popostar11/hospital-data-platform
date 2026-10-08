<template>
  <PanelFrame :title="table.title">
    <div class="case-table">
      <div class="case-table__head">
        <div v-for="col in columns" :key="col.key" class="case-table__cell" :style="cellStyle(col)">
          {{ col.label }}
        </div>
      </div>

      <div class="case-table__viewport" :style="{ height: viewportHeight + 'px' }">
        <div v-if="!rows.length" class="empty-hint">24 小时内暂无急救绿道患者</div>
        <!--
          无缝滚动：渲染两份数据，CSS 动画把轨道整体上移「一份高度」后瞬间回位，
          视觉上完全连续。用 CSS 动画而非 requestAnimationFrame：
            - 走 GPU 合成层，主线程零开销（工控机 7×24 常驻更稳）；
            - 不依赖帧回调，窗口被遮挡/远程桌面等场景下依然推进。
          :key 变化时组件重新挂载，动画从头开始，保证新数据到达后从第一条看起。
        -->
        <div
          v-else
          :key="trackKey"
          class="case-table__track"
          :class="{ 'is-scrolling': needScroll }"
          :style="trackStyle"
        >
          <div
            v-for="(row, index) in loopRows"
            :key="`${row.id}-${index}`"
            class="case-table__row"
            :class="{ 'is-new': freshSet.has(row.id) }"
          >
            <div class="case-table__cell case-table__cell--name" :style="cellStyle(columns[0])">{{ row.name }}</div>
            <div class="case-table__cell" :style="cellStyle(columns[1])">{{ row.gender }}</div>
            <div class="case-table__cell" :style="cellStyle(columns[2])">{{ row.age ?? '—' }}</div>
            <div class="case-table__cell" :style="cellStyle(columns[3])">
              <span class="disease-chip" :style="{ background: row.diseaseColor }">{{ row.diseaseName }}</span>
            </div>
            <div class="case-table__cell case-table__cell--time" :style="cellStyle(columns[4])">{{ row.time }}</div>
            <div class="case-table__cell" :style="cellStyle(columns[5])">{{ row.sourceTypeName }}</div>
            <div class="case-table__cell" :style="cellStyle(columns[6])">{{ row.distance ?? '—' }}</div>
            <div class="case-table__cell case-table__cell--status" :style="cellStyle(columns[7])">{{ row.statusName }}</div>
          </div>
        </div>
      </div>
    </div>
  </PanelFrame>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ScreenTable, ScreenTableColumn, ScreenTableRow } from '@hospital/shared'
import PanelFrame from './PanelFrame.vue'

const props = defineProps<{
  table: ScreenTable
  visibleRows: number
  speed: number
  freshIds: number[]
}>()

/** 行高与 .case-table__row 的 CSS 高度保持一致（无缝滚动依赖固定行高） */
const ROW_HEIGHT = 70

const columns = computed<ScreenTableColumn[]>(() => props.table.columns)
const rows = computed<ScreenTableRow[]>(() => props.table.rows)
const freshSet = computed(() => new Set(props.freshIds))

/** 可见行数由后端配置下发，至少 3 行以免面板塌陷 */
const rowsToShow = computed(() => Math.max(3, props.visibleRows))
const viewportHeight = computed(() => rowsToShow.value * ROW_HEIGHT)
/** 数据不足一屏时不滚动，避免空转抖动 */
const needScroll = computed(() => rows.value.length > rowsToShow.value)
/** 无缝：数据渲染两份 */
const loopRows = computed(() => (needScroll.value ? [...rows.value, ...rows.value] : rows.value))
const unitHeight = computed(() => rows.value.length * ROW_HEIGHT)

/** 滚动一份数据所需时长：速度来自后端配置（px/s） */
const trackStyle = computed(() => {
  const speed = Math.max(5, props.speed || 40)
  return {
    '--unit-height': `${unitHeight.value}px`,
    animationDuration: `${(unitHeight.value / speed).toFixed(2)}s`,
  } as Record<string, string>
})

/** 数据或可见行数变化 → 重建轨道，动画重新从顶部开始 */
const trackKey = computed(() => `${rows.value.length}-${rows.value[0]?.id ?? 0}-${rowsToShow.value}`)

function cellStyle(col?: ScreenTableColumn): Record<string, string> {
  const width = col?.width ?? 10
  return {
    width: `${width}%`,
    textAlign: col?.align ?? 'center',
  }
}
</script>
