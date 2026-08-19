import { describe, expect, it } from 'vitest'
import { foldLatestTurn, parseJsonLines } from '../src/transcript.js'

describe('WorkBuddy transcript folding', () => {
  it('folds the latest human turn and tool trace while excluding StrataGate tools', () => {
    const entries = [
      { type: 'user', timestamp: '2026-08-19T01:00:00.000Z', message: { content: 'old prompt' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'old answer' }] } },
      { type: 'user', timestamp: '2026-08-19T02:00:00.000Z', message: { content: [{ type: 'text', text: 'run tests' }] } },
      { type: 'assistant', message: { content: [
        { type: 'tool_use', id: 'm1', name: 'memory_assess', input: { verdict: 'sufficient' } },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } },
      ] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'passed' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'All tests passed.' }] } },
    ]

    expect(foldLatestTurn(entries, 'run tests')).toEqual({
      user: 'run tests',
      assistant: 'All tests passed.',
      createdAt: '2026-08-19T02:00:00.000Z',
      assistantToolCalls: [{ name: 'Bash', arguments: { command: 'npm test' }, result: 'passed' }],
    })
  })

  it('does not consume a partial trailing JSON line', () => {
    const complete = '{"type":"user","message":{"content":"hello"}}\n'
    const partial = '{"type":"assistant"'
    const parsed = parseJsonLines(Buffer.from(complete + partial))
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.consumedBytes).toBe(Buffer.byteLength(complete))
  })
})
