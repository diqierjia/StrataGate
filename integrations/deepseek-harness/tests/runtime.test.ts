import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { StrataGate } from '@diqier/stratagate'
import { describe, expect, it } from 'vitest'
import type { DshModelBridge } from '../src/llm.js'
import { StrataGateRuntime } from '../src/runtime.js'

const fakeModels = {
  run: async <T>(_session: Session, operation: () => Promise<T>): Promise<T> => operation(),
  summarizer: async () => ({
    l0Title: 'turns', l0Tags: [], l1Summary: 'turns', l2Keypoints: [], shouldExtract: false,
  }),
  extractor: async () => ({ shouldExtract: false, reason: 'none', events: [] }),
  projector: async () => ({ reason: 'none', changes: [] }),
} as unknown as DshModelBridge

const session = {
  id: 'session-runtime',
  header: { id: 'session-runtime', version: 0, createdAt: 0, cwd: 'C:\\work\\project' },
} as unknown as Session

function turnEvents(): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    {
      type: 'user/message', seq: 1, time: 2,
      data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'remember pnpm' }], source: { kind: 'user' } },
    },
    {
      type: 'assistant/message', seq: 2, time: 3,
      data: {
        turn: 1, step: 1,
        message: {
          id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Understood.' }],
          source: { kind: 'model', provider: 'test', model: 'test' },
        },
      },
    },
    { type: 'turn/end', seq: 3, time: 4, data: { turn: 1, reason: { kind: 'completed' } } },
  ] as SessionEvent[]
}

describe('DSH runtime ingestion', () => {
  it('persists a folded DSH turn once even if the event bracket is delivered twice', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stratagate-dsh-runtime-'))
    const database = join(directory, 'memory.db')
    const runtime = new StrataGateRuntime({
      database,
      namespaceMode: 'project',
      namespacePrefix: 'dsh',
      globalNamespace: 'global',
      blockTurnSize: 4,
      ingestSubagents: false,
      maxOutputTokens: 2048,
    }, fakeModels)
    const namespace = runtime.namespaceFor(session)
    try {
      for (const event of turnEvents()) runtime.acceptEvent(session, event)
      for (const event of turnEvents()) runtime.acceptEvent(session, event)
      await runtime.close()

      const memory = await StrataGate.open({ database, namespace })
      expect(memory.turn).toBe(1)
      expect(memory.listOpenTail().map(({ content }) => content)).toEqual(['remember pnpm', 'Understood.'])
      expect(memory.hasIngestionReceipt('dsh:session-runtime:turn:1')).toBe(true)
      await memory.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('persists the retrieval assessment as an answer-to-source usage audit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stratagate-dsh-audit-'))
    const database = join(directory, 'memory.db')
    const runtime = new StrataGateRuntime({
      database,
      namespaceMode: 'project',
      namespacePrefix: 'dsh',
      globalNamespace: 'global',
      blockTurnSize: 1,
      ingestSubagents: false,
      maxOutputTokens: 2048,
    }, fakeModels)
    const activeSession = {
      ...session,
      events: [{ type: 'turn/start', seq: 0, time: 1, data: { turn: 9 } }],
    } as unknown as Session
    const namespace = runtime.namespaceFor(activeSession)
    try {
      const seed = await StrataGate.open({
        database,
        namespace,
        blockTurnSize: 1,
        summarizer: async () => ({
          l0Title: 'package manager', l0Tags: ['pnpm'], l1Summary: 'Use pnpm.', l2Keypoints: ['pnpm'], shouldExtract: true,
        }),
        extractor: async ({ target }) => ({
          shouldExtract: true,
          reason: 'durable project decision',
          events: [{
            title: 'Use pnpm',
            summary: 'The project uses pnpm.',
            sourceMessageIds: [target.l5Raw[0]?.id ?? 'missing'],
            sourceBlockId: target.id,
          }],
        }),
      })
      await seed.appendTurn({ user: 'Use pnpm.', assistant: 'Okay.' })
      await seed.appendTurn({ user: 'Continue.', assistant: 'Okay.' })
      await seed.close()

      const batch = await runtime.searchEvents(activeSession, 'pnpm') as { batchId: string; evidenceRefs: string[] }
      expect(batch.evidenceRefs).toHaveLength(1)
      await runtime.assess(activeSession, {
        verdict: 'sufficient',
        evidence_refs: batch.evidenceRefs,
        fit: 'The event records the package-manager decision.',
        missing: '',
        next_strategy: 'answer',
      })
      await runtime.recordUse(activeSession, 'call-audit-1')

      const audit = (await runtime.adminSnapshot(namespace))?.usageReceipts[0]
      expect(audit).toMatchObject({
        id: 'dsh:session-runtime:tool:call-audit-1',
        audit: {
          sessionId: 'session-runtime',
          turn: 9,
          batchId: batch.batchId,
          evidenceRefs: batch.evidenceRefs,
          verdict: 'sufficient',
          nextStrategy: 'answer',
        },
      })
    } finally {
      await runtime.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
