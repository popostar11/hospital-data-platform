<template>
  <!--
    结构说明：标题必须放在 clip-path 之外。
    .panel / .panel__inner 都用 clip-path 切角，若标题作为其子元素会被裁掉上半部分。
  -->
  <div class="panel-wrap">
    <div class="panel">
      <div class="panel__inner">
        <span class="panel__corner panel__corner--tl" />
        <span class="panel__corner panel__corner--tr" />
        <span class="panel__corner panel__corner--bl" />
        <span class="panel__corner panel__corner--br" />
        <div class="panel__body">
          <slot />
        </div>
        <div class="panel__ruler" />
      </div>
    </div>
    <div class="panel__title">{{ title }}</div>
  </div>
</template>

<script setup lang="ts">
/** HUD 面板外框：斜切四角 + 发光描边 + 居中铭牌标题 */
defineProps<{ title: string }>()
</script>

<style scoped>
.panel-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.panel {
  width: 100%;
  height: 100%;
}
</style>
