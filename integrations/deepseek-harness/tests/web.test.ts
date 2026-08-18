import { describe, expect, it } from 'vitest'
import type { StrataGateSnapshot } from '@diqier/stratagate'
import type { StrataGateRuntime } from '../src/runtime.js'
import { handleAdminRequest, type WebResponse } from '../src/web.js'

const snapshot: StrataGateSnapshot = {
  schemaVersion: 4,
  currentTurn: 8,
  blockTurnSize: 4,
  openTail: [],
  blocks: [{
    id: 'blk_1',
    sequence: 1,
    startTurn: 1,
    endTurn: 4,
    createdAt: '2026-08-18T00:00:00.000Z',
    shouldExtract: true,
    l0Title: 'Package manager',
    l0Tags: ['pnpm'],
    l1Summary: 'Use pnpm for this project.',
    l2Keypoints: ['pnpm'],
    l3Condensed: 'Use pnpm.',
    l4Readable: 'Use pnpm.',
    l5Raw: [{
      id: 'msg_1',
      role: 'user',
      content: 'Use pnpm. api_key=super-secret-value',
      createdAt: '2026-08-18T00:00:00.000Z',
      toolCalls: [{ name: 'fetch', arguments: { authorization: 'Bearer abcdefghijklmnop' } }],
    }],
    pointerCurrentLevel: 5,
    pointerAnchorLevel: 5,
    pointerAnchorTurn: 4,
    lastLiftedAt: null,
  }],
  events: [{
    id: 'evt_1',
    title: 'Use pnpm',
    summary: 'The project uses pnpm.',
    narrative: 'The user selected pnpm.',
    tags: ['pnpm'],
    quotes: ['Use pnpm.'],
    sourceMessageIds: ['msg_1'],
    sourceBlockId: 'blk_1',
    temporal: {},
    scope: 'project',
    criticality: 'routine',
    confidence: 0.95,
    status: 'active',
    supersededBy: null,
    weight: { mentionCount: 1, lastAdoptedTurn: 8, lastRetrievedAt: null, pinned: false, floorWeight: 0, forcedCap: null },
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  }],
  elements: [],
  extractionJobs: [],
  elementProjectionJobs: [],
  usageReceipts: [{
    id: 'dsh:s1:tool:c1',
    eventIds: ['evt_1'],
    elementIds: [],
    audit: {
      sessionId: 's1',
      turn: 8,
      batchId: 'batch_4',
      evidenceRefs: ['event:evt_1'],
      verdict: 'sufficient',
      fit: 'Direct project decision.',
      missing: '',
      nextStrategy: 'answer',
    },
    createdAt: '2026-08-18T00:01:00.000Z',
  }],
  ingestionReceipts: [],
}

const runtime = {
  adminNamespaces: async () => ['dsh:project:test'],
  adminSnapshot: async (namespace: string) => namespace === 'dsh:project:test' ? snapshot : null,
} as unknown as StrataGateRuntime

async function request(url: string, method = 'GET'): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  const headers: Record<string, string> = {}
  let text = ''
  const response: WebResponse = {
    statusCode: 0,
    setHeader: (name, value) => { headers[name] = value },
    end: (body) => { text = body },
  }
  await handleAdminRequest(runtime, { method, url }, response)
  return { status: response.statusCode, body: JSON.parse(text), headers }
}

describe('StrataGate read-only admin routes', () => {
  it('summarizes namespaces and returns paginated memories', async () => {
    const overview = await request('/api/stratagate/overview')
    expect(overview.status).toBe(200)
    expect(overview.body).toMatchObject({ readonly: true, namespaces: [{ events: 1, usageReceipts: 1 }] })
    expect(overview.headers['Cache-Control']).toBe('no-store')

    const memories = await request('/api/stratagate/memories?namespace=dsh%3Aproject%3Atest&kind=events&q=pnpm')
    expect(memories.body).toMatchObject({ total: 1, items: [{ id: 'evt_1', title: 'Use pnpm' }] })
  })

  it('expands source evidence with server-side secret redaction', async () => {
    const result = await request('/api/stratagate/sources?namespace=dsh%3Aproject%3Atest&eventId=evt_1')
    expect(result.status).toBe(200)
    expect(result.body.messages[0].content).toBe('Use pnpm. api_key=[REDACTED]')
    expect(result.body.messages[0].toolCalls[0].arguments.authorization).toBe('Bearer [REDACTED]')
  })

  it('links answer audit records to events and original messages', async () => {
    const result = await request('/api/stratagate/audit?namespace=dsh%3Aproject%3Atest')
    expect(result.body.items[0]).toMatchObject({
      audit: { sessionId: 's1', turn: 8, batchId: 'batch_4', evidenceRefs: ['event:evt_1'] },
      events: [{ id: 'evt_1' }],
      sourceMessages: [{ id: 'msg_1' }],
    })
  })

  it('rejects every browser write method', async () => {
    const result = await request('/api/stratagate/memories', 'POST')
    expect(result).toMatchObject({ status: 405, body: { error: expect.stringContaining('read-only') } })
  })
})
