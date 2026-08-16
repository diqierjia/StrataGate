import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.js'

describe('DSH plugin composition', () => {
  it('loads into the official Cordis services and registers the complete memory protocol', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stratagate-dsh-plugin-'))
    const ctx = new Context()
    try {
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(SystemPrompt, {})
      await ctx.plugin(ToolRuntime, { mode: 'native' })
      await ctx.plugin(AgentDefaultModelConfig, { provider: 'test', model: 'test' })
      await ctx.plugin(plugin, { database: join(directory, 'memory.db') })

      const names = ctx.tools.schemas().map(({ name }) => name)
      expect(names).toEqual(expect.arrayContaining([
        'memory_search_events',
        'memory_expand_event',
        'memory_search_elements',
        'memory_expand_element',
        'memory_search_raw',
        'memory_get_blocks',
        'memory_expand_block',
        'memory_assess',
        'memory_record_use',
      ]))
      const prompt = await ctx.systemPrompt.assemble()
      expect(prompt.sections).toContainEqual(expect.objectContaining({
        name: 'tool:stratagate-memory',
        text: expect.stringContaining('StrataGate provides durable, evidence-gated memory'),
      }))
    } finally {
      await ctx.fiber.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
