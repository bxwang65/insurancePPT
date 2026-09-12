import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// 2026-08-12: admin-web 集成进 4in1 /training/admin/ iframe, vite dev 仍独立跑 5173,
//   但 build 产物要挂到 /training/admin/ 子路径 → assets 用 '/training/admin/' 前缀
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/training/admin/' : '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
