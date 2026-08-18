import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  removeNodeProtocol: false,
  noExternal: [/^@diqier\/stratagate(?:\/.*)?$/],
  external: [
    /^@deepseek-ai\//,
  ],
})
