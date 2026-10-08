import { onBeforeUnmount, onMounted, ref } from 'vue'
import { WEEK_LABELS } from '@hospital/shared'

/** 顶部时钟：本地逐秒刷新（照片中时钟每秒跳动） */
export function useClock() {
  const time = ref('--:--:--')
  const date = ref('')
  const week = ref('')
  let timer: number | undefined

  const tick = () => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    time.value = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    date.value = `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`
    week.value = WEEK_LABELS[d.getDay()] ?? ''
  }

  onMounted(() => {
    tick()
    timer = window.setInterval(tick, 1000)
  })

  onBeforeUnmount(() => {
    if (timer) window.clearInterval(timer)
  })

  return { time, date, week }
}
