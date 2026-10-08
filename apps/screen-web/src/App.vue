<template>
  <div class="stage-wrap">
    <div class="stage" :style="stageStyle">
      <div class="stage-frame" />

      <ScreenHeader
        :hospital-name="data?.header.hospitalName ?? DEFAULT_HOSPITAL_NAME"
        :system-name="data?.header.systemName ?? DEFAULT_SYSTEM_NAME"
      />

      <section class="panels">
        <PiePanel v-if="data" :pie="data.pie" />
        <BarPanel v-if="data" :bar="data.bar" />
      </section>

      <CaseTablePanel
        v-if="data"
        :table="data.table"
        :visible-rows="data.config.visibleRows"
        :speed="data.config.scrollSpeed"
        :fresh-ids="freshIds"
      />

      <FooterStats v-if="data" :footer="data.footer" />

      <div
        v-if="status === 'reconnecting' || status === 'error'"
        class="offline-badge"
        :class="{ 'offline-badge--error': status === 'error' }"
      >
        {{ status === 'error' ? '数据暂不可用，正在重试…' : '数据重连中…' }}
      </div>

      <div v-if="!data" class="skeleton">数据加载中…</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { DEFAULT_HOSPITAL_NAME, DEFAULT_SYSTEM_NAME } from '@hospital/shared'
import { useScale } from './composables/useScale'
import { useScreenData } from './composables/useScreenData'
import { resolveScreenCode } from './api/screen'
import ScreenHeader from './components/ScreenHeader.vue'
import PiePanel from './components/PiePanel.vue'
import BarPanel from './components/BarPanel.vue'
import CaseTablePanel from './components/CaseTablePanel.vue'
import FooterStats from './components/FooterStats.vue'

const screenCode = resolveScreenCode()
const { data, status, freshIds } = useScreenData(screenCode)
const { scale } = useScale(1920, 1080)

const stageStyle = computed(() => ({ transform: `scale(${scale.value})` }))
</script>

<style scoped>
.panels {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 47.5% 1fr;
  gap: 14px;
  min-height: 0;
}
</style>
