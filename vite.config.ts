import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 部署到 GitHub Pages 时用相对路径，避免子目录 404。
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // 剧本 JSON 是唯一的大资产，单独切出来方便缓存与增量更新。
    chunkSizeWarningLimit: 1200,
  },
})
