import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: { outDir: 'dist', emptyOutDir: true },
  preview: {
    allowedHosts: [
      'dilarion-appk.afribase.dev',
      'dilarion-webplatform.afribase.dev',
      'dilarion.xyz',
      'web.dilarion.xyz',
    ],
  },
})
