import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', rewrite: path => path.replace(/^\/api/, '') },
      '/auth': 'http://localhost:3000',
      '/invoices': 'http://localhost:3000',
      '/sync': 'http://localhost:3000',
      '/webhooks': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
})
