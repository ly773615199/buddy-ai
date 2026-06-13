import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { vitePluginI18n } from './src/plugins/vite-plugin-i18n'

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    // i18n 插件：dev 和 build 都启用，确保 E2E 测试中语言切换正常
    vitePluginI18n({
      devMode: true,
      dryRun: false,
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:8765',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:8765',
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
}))
