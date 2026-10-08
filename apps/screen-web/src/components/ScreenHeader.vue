<template>
  <header class="hud-header">
    <div class="hud-brand">
      <span class="hud-brand__bars"><i /><i /><i /></span>
      <span class="hud-brand__text">{{ systemName }}</span>
    </div>

    <div class="hud-hospital">
      <div class="hud-hospital__band">{{ hospitalName }}</div>
    </div>

    <div class="hud-clock">
      <div class="hud-clock__plate">
        <span class="hud-clock__time">{{ clock.time.value }}</span>
        <span class="hud-clock__sep" />
        <span class="hud-clock__date">
          <b>{{ clock.date.value }}</b>
          <span>{{ clock.week.value }}</span>
        </span>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useClock } from '../composables/useClock'

const props = defineProps<{ hospitalName: string; systemName: string }>()

const clock = useClock()
const systemName = computed(() => props.systemName || '动态速览')
const hospitalName = computed(() => props.hospitalName || '—')
</script>
