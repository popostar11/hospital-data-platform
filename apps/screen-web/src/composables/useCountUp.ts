import { ref, watch, type Ref } from 'vue'

/**
 * 数字滚动动画：大屏累计值变化时平滑过渡，避免数字突兀跳变。
 */
export function useCountUp(source: Ref<number>, duration = 700) {
  const display = ref(source.value)
  let raf = 0

  const animate = (from: number, to: number) => {
    cancelAnimationFrame(raf)
    if (from === to) {
      display.value = to
      return
    }
    const start = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3)
      display.value = Math.round(from + (to - from) * eased)
      if (p < 1) raf = requestAnimationFrame(step)
      else display.value = to
    }
    raf = requestAnimationFrame(step)
  }

  watch(source, (to, from) => animate(from ?? 0, to ?? 0))

  return display
}
