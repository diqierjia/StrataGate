import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

describe('StrataGate Web client contract', () => {
  it('registers a read-only settings section through the DSH module loader', () => {
    const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
    let definition: any
    runInNewContext(source, {
      URLSearchParams,
      window: { __ModuleLoader__: { load: (value: unknown) => { definition = value } } },
    })
    expect(definition.id).toBe('stratagate-dsh')
    const plugin = definition.factory((name: string) => {
      if (name !== 'react') throw new Error(`unexpected client dependency: ${name}`)
      return { createElement: (...args: unknown[]) => args, Fragment: 'fragment', useState: () => [], useEffect: () => {}, useCallback: (fn: unknown) => fn }
    })
    expect(plugin.inject).toEqual(['slots'])

    let registration: any
    const slots = {
      inject: (_name: string, callback: () => void) => callback(),
      register: (metadata: unknown, render: unknown) => { registration = { metadata, render } },
    }
    plugin.apply({ get: (name: string) => name === 'slots' ? slots : undefined })
    expect(registration.metadata).toMatchObject({ name: 'settings.section', id: 'stratagate-memory' })
    expect(typeof registration.render).toBe('function')
    expect(source).not.toContain("method: 'POST'")
  })

  it('offers a one-time GitHub Star link only after demonstrated memory use', () => {
    const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
    expect(source).toContain("const STAR_PROMPT_USAGE_THRESHOLD = 3")
    expect(source).toContain("usageRecords: selected.usageReceipts")
    expect(source).toContain("https://github.com/diqierjia/StrataGate-AgentMemory")
    expect(source).toContain("stratagate.starPrompt.dismissed.v1")
    expect(source).toContain("rel: 'noopener noreferrer'")
    expect(source).not.toContain('window.open(')
  })
})
