import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'savvy-progress'
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

const shows = async ($: Engine, text: RegExp) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: pane })
  const found = await ui.find({ type: 'Text', text })
  await ui.unmount()
  return found
}

// 201 finished runs of 1M input tokens each on Haiku 4.5 ($1 per run): the list keeps 200, the header still counts all 201.
test('history: the totals keep the runs that left the list', async ($, on: On) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: `w${++n}` }))
  on('turn.complete', () => ({ text: '' }) as never)
  const usage = { model: 'claude-haiku-4-5', input_tokens: 1e6, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

  for (let i = 1; i <= 201; i++) {
    await $.agent.spawn({ tool_use_id: `t${i}`, prompt: 'p', description: `Job ${i}`, subagentType: 'general-purpose', provider: 'engine', parentModel: 'claude-haiku-4-5', background: false, fork: false } as never)
    await ($.turn.complete as (e: unknown) => Promise<unknown>)({ agentId: `w${i}`, reason: 'answer', answer: 'ok', usage })
  }

  expect(await shows($, /≈\$201\.0 · 201\.0M/)).toBeDefined()
  expect(await shows($, /Job 1$/)).toBeFalsy()
  expect(await shows($, /Job 201$/)).toBeDefined()
})
