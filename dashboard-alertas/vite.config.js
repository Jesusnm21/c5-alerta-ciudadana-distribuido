import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Esto es el equivalente a "0.0.0.0", crucial para Docker
    port: 5173,
    watch: {
      usePolling: true // Ayuda a que los cambios en el código se reflejen al instante en Windows
    }
  }
})