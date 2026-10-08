import { createApp } from 'vue'
import type { Component } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIcons from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'
import 'element-plus/dist/index.css'
import './styles/index.css'

const app = createApp(App)

// 状态与路由：pinia 必须先于 router 安装，路由守卫里会用到 store
app.use(createPinia())
app.use(router)

// Element Plus 全量引入 + 中文语言包
app.use(ElementPlus, { locale: zhCn })

// 图标全局注册，菜单里可按名称动态渲染
for (const [name, icon] of Object.entries(ElementPlusIcons)) {
  app.component(name, icon as Component)
}

app.mount('#app')
