import { copyFileSync, mkdirSync } from 'node:fs'

const root = new URL('../', import.meta.url)
mkdirSync(new URL('dist/', root), { recursive: true })
copyFileSync(new URL('src/client.js', root), new URL('dist/client.js', root))
copyFileSync(new URL('src/client.d.ts', root), new URL('dist/client.d.ts', root))
