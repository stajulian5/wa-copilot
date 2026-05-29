import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve('electron/main.ts'),
        output: {
          entryFileNames: 'index.js'
        }
      }
    },
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@server': resolve('src/server')
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('electron/preload.ts')
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve('src/app'),
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/app/index.html')
        }
      }
    },
    resolve: {
      alias: {
        '@app': resolve('src/app'),
        '@renderer': resolve('src/app')
      }
    },
    plugins: [react()]
  }
})
