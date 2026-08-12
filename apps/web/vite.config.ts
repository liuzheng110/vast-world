import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// M0 Web 客户端构建配置。
// - 开发：vite（默认 5173）
// - 预览/部署：vite preview（4173，strictPort）
// 不引入 Three.js / Babylon.js；仅 Phaser 作为唯一渲染引擎。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
})
