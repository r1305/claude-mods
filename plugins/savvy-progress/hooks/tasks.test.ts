import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'savvy-progress'
const PROGRESS = 'mcp__savvy-progress__progress'
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

const spawn = async ($: Engine, description: string, n: number) =>
  $.agent.spawn({ tool_use_id: `t${n}`, prompt: 'p', description, subagentType: 'general-purpose', provider: 'engine', parentModel: 'claude-haiku-5-5', background: false, fork: false } as never)

const shows = async ($: Engine, text: RegExp) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: pane })
  const found = await ui.find({ type: 'Text', text })
  await ui.unmount()
  return found
}

// Two planned tasks share a title, and a third is different: each run claims one of the same-titled tasks.
test('tasks: repeated titles are matched one run each', async ($, on: On) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `w${++n}` }))

  await $.tool.call({
    tool: PROGRESS,
    title: 'Repeats',
    phase: 'delegate',
    tasks: [
      { title: 'Fix bug', tier: 'light' },
      { title: 'Fix bug', tier: 'light' },
      { title: 'Other', tier: 'medium' },
    ],
  } as never)

  await spawn($, 'Fix bug', 1)
  expect(await shows($, /Planned · 2/)).toBeDefined()

  await spawn($, 'Fix bug', 2)
  expect(await shows($, /Planned · 1/)).toBeDefined()
  expect(await shows($, /Running · 2/)).toBeDefined()
})
