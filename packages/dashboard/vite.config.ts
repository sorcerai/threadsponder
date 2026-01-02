import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173, // Same port as eliza-threads
    proxy: {
      '/api': {
        target: process.env.API_URL || 'http://localhost:3008',
        changeOrigin: true,
      },
      '/socket.io': {
        target: process.env.API_URL || 'http://localhost:3008',
        ws: true,
      }
    }
  }
})
