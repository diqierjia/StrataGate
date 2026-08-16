import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'

describe('DeepSeek Harness plugin config', () => {
  it('resolves safe defaults', () => {
    expect(resolveConfig({ database: ' ./memory.db ' })).toEqual({
      database: './memory.db',
      namespaceMode: 'project',
      namespacePrefix: 'dsh',
      globalNamespace: 'global',
      blockTurnSize: 4,
      ingestSubagents: false,
      maxOutputTokens: 2048,
    })
  })

  it('requires an explicit model pair', () => {
    expect(() => resolveConfig({ database: 'memory.db', provider: 'deepseek' }))
      .toThrow('provider and model must be configured together')
  })
})
