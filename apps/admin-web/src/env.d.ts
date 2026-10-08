/// <reference types="vite/client" />

/** 单文件组件模块声明，让 tsc / 编辑器能识别 .vue 导入 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
