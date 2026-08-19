import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: [
      { find: 'node:sqlite', replacement: fileURLToPath(new URL('./src/node-sqlite-shim.ts', import.meta.url)) },
      { find: '@diqier/stratagate/sqlite', replacement: fileURLToPath(new URL('../../src/sqlite.ts', import.meta.url)) },
      { find: '@diqier/stratagate', replacement: fileURLToPath(new URL('../../src/index.ts', import.meta.url)) },
    ],
  },
  test: { include: ['tests/**/*.test.ts'] },
})
