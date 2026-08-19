import { resolve } from 'node:path'
import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      server: 'src/server.ts',
      hook: 'src/hook.ts',
    },
    format: ['cjs'],
    target: 'node22',
    outExtension: () => ({ js: '.cjs' }),
    sourcemap: true,
    clean: true,
    splitting: false,
    removeNodeProtocol: false,
    noExternal: [
      /^@diqier\/stratagate(?:\/.*)?$/,
      /^@modelcontextprotocol\/sdk(?:\/.*)?$/,
      /^zod(?:\/.*)?$/,
    ],
    external: ['better-sqlite3'],
    esbuildOptions(options) {
      options.alias = {
        ...options.alias,
        'node:sqlite': resolve('src/node-sqlite-shim.ts'),
      }
    },
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { 'star-widget-client': 'src/star-widget-client.ts' },
    format: ['iife'],
    platform: 'browser',
    target: 'es2022',
    minify: true,
    clean: false,
    splitting: false,
    sourcemap: false,
  },
])
