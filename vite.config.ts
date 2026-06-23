import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// 後端（muxdesk FastAPI standalone）；dev 透過 proxy 走相對路徑 /api（含 WebSocket）
const backend = process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    host: '127.0.0.1',
    port: 5274,
    strictPort: true,
    proxy: { '/api': { target: backend, changeOrigin: true, ws: true } },
  },
})
