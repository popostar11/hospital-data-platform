<script setup lang="ts">
/**
 * 彩色标签：颜色完全由后端字典下发（diseaseColor / statusColor / color），前端不硬编码。
 */
const props = withDefaults(
  defineProps<{
    color?: string | null
    text?: string | null
  }>(),
  { color: null, text: null },
)
</script>

<template>
  <span class="color-tag" :style="{ backgroundColor: props.color || '#8FA9C9' }">{{ props.text ?? '—' }}</span>
</template>
