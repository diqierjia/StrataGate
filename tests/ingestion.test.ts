import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StrataGate } from '../src/index.js'

describe('turn ingestion receipts', () => {
  it('does not append the same external turn twice in memory', async () => {
    const memory = StrataGate.inMemory()
    await memory.appendTurn({ user: 'one', assistant: 'answer', receiptId: 'external:1' })
    const duplicate = await memory.appendTurn({ user: 'one', assistant: 'answer', receiptId: 'external:1' })
    expect(memory.turn).toBe(1)
    expect(memory.listOpenTail()).toHaveLength(2)
    expect(memory.hasIngestionReceipt('external:1')).toBe(true)
    expect(duplicate).toEqual({ sealedBlock: null, extractedEvents: [], projectedElements: [] })
  })

  it('keeps ingestion receipts atomic and durable across SQLite restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stratagate-ingestion-'))
    const database = join(directory, 'memory.db')
    try {
      const first = await StrataGate.open({ database, namespace: 'project:test' })
      await first.appendTurn({ user: 'one', assistant: 'answer', receiptId: 'dsh:s1:turn:1' })
      await first.close()

      const restored = await StrataGate.open({ database, namespace: 'project:test' })
      await restored.appendTurn({ user: 'one', assistant: 'answer', receiptId: 'dsh:s1:turn:1' })
      expect(restored.turn).toBe(1)
      expect(restored.listOpenTail()).toHaveLength(2)
      expect(restored.exportSnapshot().ingestionReceipts).toEqual([
        expect.objectContaining({ id: 'dsh:s1:turn:1' }),
      ])
      await restored.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
