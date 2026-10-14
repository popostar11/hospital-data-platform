import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => ({
  /**
   * 部署基路径，三种场景：
   *   - 本地部署：由后端托管在 /screen/ 下
   *   - GitHub Pages 项目页：托管在 /<仓库名>/ 下，用环境变量 PAGES_BASE 覆盖
   *   - 开发：根路径
   */
  base: process.env.PAGES_BASE ?? (mode === 'production' ? '/screen/' : '/'),
  plugins: [vue()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
}))
