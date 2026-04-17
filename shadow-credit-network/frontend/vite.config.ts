import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8545',
    },
  },
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      'fhenixjs': '/node_modules/fhenixjs/dist/fhenix.esm.js',
    },
  },
})
