import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-vite-plugin'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(fileURLToPath(import.meta.url))
const clientDir = resolve(appRoot, 'src/features/control-center/infra/web/client')

export default defineConfig({
  root: appRoot,
  plugins: [
    TanStackRouterVite({
      routesDirectory: resolve(clientDir, 'routes'),
      generatedRouteTree: resolve(clientDir, 'routeTree.gen.ts'),
    }),
    react(),
    tailwindcss(),
  ],
  build: {
    outDir: resolve(appRoot, 'dist/ui'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3120',
      '/events': {
        target: 'http://localhost:3120',
        changeOrigin: true,
        ws: false,
      },
    },
  },
})
