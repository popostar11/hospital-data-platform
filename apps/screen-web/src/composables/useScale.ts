import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 等比缩放适配：设计稿 1920×1080，按屏幕实际尺寸取最小比例整体缩放。
 * 用 scale 而非流式布局，保证任何分辨率下版面比例与设计稿 1:1、不变形。
 */
export function useScale(designWidth = 1920, designHeight = 1080) {
  const scale = ref(1)

  const apply = () => {
    const w = window.innerWidth || designWidth
    const h = window.innerHeight || designHeight
    scale.value = Math.min(w / designWidth, h / designHeight)
  }

  onMounted(() => {
    apply()
    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', apply)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', apply)
    window.removeEventListener('orientationchange', apply)
  })

  return { scale }
}
