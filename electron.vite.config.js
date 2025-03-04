import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin, bytecodePlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), bytecodePlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin(), bytecodePlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@components': resolve('src/renderer/src/components'),
        '@assets': resolve('src/renderer/src/assets'),
        '@hooks': resolve('src/renderer/src/hooks'),
        '@api': resolve('src/renderer/src/api'),
        '@store': resolve('src/renderer/src/store')
      }
    },
    plugins: [react(), tsconfigPaths()]
  }
})