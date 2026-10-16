import { expect, test } from 'claude-code/testing'

const PLUGIN = 'savvy-progress'
const PROGRESS = 'mcp__savvy-progress__progress'
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

// Model and effort each savvy worker runs on, as set in the frontmatter of savvy-flow's
// agents/savvy-<tier>.md. A hooks module cannot read another plugin's files, so this table
// is the copy the panel is checked against: change a worker's model or effort and change it here too.
const WORKERS: Record<string, [model: string, effort: string]> = {
  fable: ['Fable', 'high'],
  heavy: ['Opus', 'xhigh'],
  careful: ['Opus', 'high'],
  medium: ['Opus', 'medium'],
  light: ['Opus', 'low'],
}

test('tiers: the panel shows each savvy tier with the model and effort of its worker', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const tiers = Object.keys(WORKERS)

  await $.tool.call({
    tool: PROGRESS,
    title: 'Tiers',
    phase: 'delegate',
    tasks: tiers.map(tier => ({ title: `Task ${tier}`, tier })),
  } as never)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: pane })
  for (const tier of tiers) {
    const [model, effort] = WORKERS[tier]
    expect(await ui.find({ type: 'Text', text: new RegExp(`${tier} · ${model} · ${effort}`) })).toBeDefined()
  }
})
