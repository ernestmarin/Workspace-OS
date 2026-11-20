import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: [
      {
        find: /^electron$/,
        replacement: path.resolve(rootDir, 'config/vitest-electron-stub.ts'),
      },
    ],
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/.cache/reference-repos/**',
    ],
  },
})
