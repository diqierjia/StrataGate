import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { TurnFolder } from '../src/fold.js'

const session = {
  id: 'session-1',
  header: { id: 'session-1', version: 0, createdAt: 0, cwd: 'C:\\repo' },
} as unknown as Session

function event(type: string, data: unknown, seq: number): SessionEvent {
  return { type, data, seq, time: Date.UTC(2026, 7, 16, 1, 2, seq) } as SessionEvent
}

function content(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}

describe('DSH turn folding', () => {
  it('folds a multi-step DSH turn and ignores injected plugin messages', () => {
    const folder = new TurnFolder()
    expect(folder.accept(session, event('turn/start', { turn: 7 }, 1))).toBeNull()
    folder.accept(session, event('user/message', {
      id: 'plugin-message', role: 'user', content: content('hidden instructions'),
      source: { kind: 'plugin', plugin: 'workspace-context' },
    }, 2))
    folder.accept(session, event('user/message', {
      id: 'user-message', role: 'user', content: content('Fix login'), source: { kind: 'user' },
    }, 3))
    folder.accept(session, event('tool/call', {
      turn: 7, step: 1, callId: 'memory-call', name: 'memory_search_events', arguments: '{"query":"login"}',
    }, 3))
    folder.accept(session, event('tool/result', {
      turn: 7, step: 1,
      message: {
        id: 'memory-result', role: 'user', source: { kind: 'tool', callId: 'memory-call' },
        content: [{ type: 'tool-result', toolCallId: 'memory-call', content: content('old recalled evidence') }],
      },
    }, 3))
    folder.accept(session, event('assistant/message', {
      turn: 7, step: 1,
      message: { id: 'assistant-1', role: 'assistant', content: content('I will inspect it.'), source: { kind: 'model', provider: 'p', model: 'm' } },
    }, 4))
    folder.accept(session, event('tool/call', {
      turn: 7, step: 1, callId: 'call-1', name: 'read_file', arguments: '{"path":"src/login.ts"}',
    }, 5))
    folder.accept(session, event('tool/result', {
      turn: 7, step: 1,
      message: {
        id: 'tool-message', role: 'user', source: { kind: 'tool', callId: 'call-1' },
        content: [{ type: 'tool-result', toolCallId: 'call-1', content: content('file contents') }],
      },
    }, 6))
    folder.accept(session, event('assistant/message', {
      turn: 7, step: 2,
      message: { id: 'assistant-2', role: 'assistant', content: content('Fixed and tested.'), source: { kind: 'model', provider: 'p', model: 'm' } },
    }, 7))
    const folded = folder.accept(session, event('turn/end', { turn: 7, reason: { kind: 'completed' } }, 8))

    expect(folded).toMatchObject({
      user: 'Fix login',
      assistant: 'I will inspect it.\n\nFixed and tested.',
      receiptId: 'dsh:session-1:turn:7',
      assistantToolCalls: [{ name: 'read_file', arguments: { path: 'src/login.ts' }, result: 'file contents' }],
    })
  })

  it('does not store a turn without a direct human message', () => {
    const folder = new TurnFolder()
    folder.accept(session, event('turn/start', { turn: 8 }, 1))
    folder.accept(session, event('user/message', {
      id: 'plugin-message', role: 'user', content: content('notice'), source: { kind: 'plugin', plugin: 'notice' },
    }, 2))
    expect(folder.accept(session, event('turn/end', { turn: 8, reason: { kind: 'completed' } }, 3))).toBeNull()
  })
})
