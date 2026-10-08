<template>
  <div class="footer-stats">
    <div class="footer-stats__item">
      <span>{{ footer.label }}：</span>
      <span class="footer-stats__value">{{ total }}</span>
    </div>
    <div v-for="item in footer.items" :key="item.code" class="footer-stats__item">
      <span>{{ item.name }}：</span>
      <span class="footer-stats__value">{{ item.value }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue'
import type { ScreenFooter } from '@hospital/shared'
import { useCountUp } from '../composables/useCountUp'

const props = defineProps<{ footer: ScreenFooter }>()

const total = useCountUp(toRef(() => props.footer.total))
const footer = computed(() => props.footer)
</script>
