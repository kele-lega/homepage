import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  // 相对路径，兼容 GitHub Pages 子路径与任意静态托管
  base: './',
  plugins: [vue()],
})
