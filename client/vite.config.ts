import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'path'

export default defineConfig({
  plugins: [
    // Opcional: HTTPS local para desarrollo
    basicSsl()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  optimizeDeps: {
    // Excluir Rapier3D WASM de optimización (necesario para M3)
    exclude: ['@dimforge/rapier3d-compat']
  },
  assetsInclude: [
    // Incluir formatos de assets del juego
    '**/*.gltf',
    '**/*.glb',
    '**/*.wasm'
  ],
  server: {
    port: 5173,
    host: true,
    open: true
  }
})