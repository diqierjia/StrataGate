import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface EvidenceTarget {
  eventIds: string[]
  elementIds: string[]
}

export interface StoredBatch {
  id: string
  namespace: string
  sessionId: string
  projectDir: string
  createdAt: string
  refs: Record<string, EvidenceTarget>
}

export interface StoredAssessment {
  id: string
  batchId: string
  namespace: string
  sessionId: string
  projectDir: string
  createdAt: string
  verdict: 'sufficient' | 'partial' | 'wrong'
  evidenceRefs: string[]
  fit: string
  missing: string
  nextStrategy: string
  eventIds: string[]
  elementIds: string[]
}

export interface TranscriptCursor {
  transcriptPath: string
  offset: number
  updatedAt: string
}

export interface PendingPrompt {
  prompt: string
  transcriptPath: string
  projectDir: string
  receivedAt: string
}

export interface StarPromptState {
  shownAt: string
  usageRecords: number
}

function safeKey(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value)}\n`, 'utf8')
  await rename(temporary, path)
}

export class WorkBuddyState {
  constructor(private readonly dataDir: string) {}

  private sessionPath(kind: 'cursors' | 'pending', sessionId: string): string {
    return join(this.dataDir, 'state', kind, `${safeKey(sessionId)}.json`)
  }

  async readCursor(sessionId: string): Promise<TranscriptCursor | null> {
    return readJson(this.sessionPath('cursors', sessionId))
  }

  async writeCursor(sessionId: string, cursor: TranscriptCursor): Promise<void> {
    await writeJson(this.sessionPath('cursors', sessionId), cursor)
  }

  async readPending(sessionId: string): Promise<PendingPrompt | null> {
    return readJson(this.sessionPath('pending', sessionId))
  }

  async writePending(sessionId: string, prompt: PendingPrompt): Promise<void> {
    await writeJson(this.sessionPath('pending', sessionId), prompt)
  }

  async writeBatch(batch: StoredBatch): Promise<void> {
    await writeJson(join(this.dataDir, 'state', 'batches', `${batch.id}.json`), batch)
  }

  async readBatch(batchId: string): Promise<StoredBatch | null> {
    if (!/^batch_[a-zA-Z0-9-]+$/.test(batchId)) return null
    return readJson(join(this.dataDir, 'state', 'batches', `${batchId}.json`))
  }

  async writeAssessment(assessment: StoredAssessment): Promise<void> {
    await writeJson(join(this.dataDir, 'state', 'assessments', `${assessment.id}.json`), assessment)
  }

  async readAssessment(assessmentId: string): Promise<StoredAssessment | null> {
    if (!/^assessment_[a-zA-Z0-9-]+$/.test(assessmentId)) return null
    return readJson(join(this.dataDir, 'state', 'assessments', `${assessmentId}.json`))
  }

  async claimStarPrompt(usageRecords: number, threshold = 3): Promise<boolean> {
    if (!Number.isSafeInteger(usageRecords) || usageRecords < threshold) return false
    const path = join(this.dataDir, 'state', 'star-prompt-shown.v1.json')
    await mkdir(dirname(path), { recursive: true })
    try {
      await writeFile(path, `${JSON.stringify({
        shownAt: new Date().toISOString(),
        usageRecords,
      } satisfies StarPromptState)}\n`, { encoding: 'utf8', flag: 'wx' })
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw error
    }
  }
}
