import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * 开发期把 /api 代理到本地后端（Nest，默认 3000）。
 * 生产由后端在 /admin/ 下同源托管 dist，因此 base 按 mode 切换；
 * 发布到 GitHub Pages 时用环境变量 PAGES_BASE 覆盖为 /<仓库名>/admin/。
 * 路由用 hash 模式（见 src/router/index.ts），深链接刷新不会 404。
 * 说明：alias 用 root 相对写法（'/src'），避免在未安装 @types/node 的情况下依赖 node:path。
 */
export default defineConfig(({ mode }) => ({
  base: process.env.PAGES_BASE ?? (mode === 'production' ? '/admin/' : '/'),
  plugins: [vue()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
}))
