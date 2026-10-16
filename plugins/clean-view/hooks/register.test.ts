import type { On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

let seq = 0
const id = () => `c${++seq}`

const above = () => ({ plugin: 'clean-view', surface: 'terminal', component: 'AbovePrompt', requestId: id(), props: { hasSurvey: false, isWorking: true, maxRows: 20 } }) as never

const row = (component: string, props: Record<string, unknown>) => {
  const rid = id()
  return {
    plugin: 'clean-view',
    surface: 'terminal',
    component,
    requestId: rid,
    props: { tool_use_id: rid, tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false, ...props },
  } as never
}

const world = (on: On, store: Record<string, unknown> = {}) => {
  mock.store(on, store)
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: { command: 'simple' } }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.render', () => ({ type: 'Box', props: {} }) as never)
  return clock
}

const start = ($: Engine) => $.session.start({ cwd: '/w/proyecto-a', surface: 'terminal', isInteractive: true } as never)

const simple = ($: Engine, args: string) => $.command.run({ command: 'simple', args } as never)

test('/simple on and off answer in the transcript and an empty argument shows the usage', async ($, on) => {
  world(on)
  await start($)

  expect((await simple($, 'on')).text).toContain('activada')
  expect((await simple($, 'off')).text).toContain('desactivada')
  expect((await simple($, '')).text).toContain('Uso')
})

test('a stored preference of on is restored in a new session', async ($, on) => {
  world(on, { enabled: true })
  await start($)
  const tool = await $.ui.mount(row('ToolUse', {}))
  expect(await tool.drawn()).toMatchObject({ type: 'Box', props: { display: 'none' } })
})

test('with simple on, tool rows hide; errors and interruptions stay', async ($, on) => {
  world(on)
  await start($)
  await simple($, 'on')

  const plain = await $.ui.mount(row('ToolUse', {}))
  expect(await plain.drawn()).toMatchObject({ type: 'Box', props: { display: 'none' } })

  const result = await $.ui.mount(row('ToolResult', { isErrored: false }))
  expect(await result.drawn()).toMatchObject({ type: 'Box', props: { display: 'none' } })

  const failed = await $.ui.mount(row('ToolUse', { isErrored: true }))
  expect(await failed.drawn()).not.toMatchObject({ props: { display: 'none' } })

  const cut = await $.ui.mount(row('ToolUse', { isInterrupted: true }))
  expect(await cut.drawn()).not.toMatchObject({ props: { display: 'none' } })
})

test('turning simple off restores every hidden tool row', async ($, on) => {
  world(on)
  await start($)
  await simple($, 'on')
  await simple($, 'off')

  const tool = await $.ui.mount(row('ToolUse', {}))
  expect(await tool.drawn()).not.toMatchObject({ props: { display: 'none' } })
})

test('the panel is absent while idle and with no turn, and shows en curso and pendiente during a turn', async ($, on) => {
  world(on)
  on('tool.check', () => ({ decision: 'ask' }) as never)
  await start($)

  const idle = await $.ui.mount(above())
  expect(await idle.find({ type: 'Text', text: /Estado/ })).toBeUndefined()

  await $.turn.start({ text: 'hola', turnId: 't1' } as never)
  const running = await $.ui.mount(above())
  expect(await running.find({ type: 'Text', text: /En curso/ })).toBeDefined()

  await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'c1' } as never)
  const waiting = await $.ui.mount(above())
  expect(await waiting.find({ type: 'Text', text: /Pendiente de mi respuesta/ })).toBeDefined()
})

test('sin turno ni pasos no se dibuja el panel', async ($, on) => {
  world(on)
  await start($)

  const panel = await $.ui.mount(above())
  expect(await panel.find({ type: 'Text', text: /Estado/ })).toBeUndefined()
  expect(await panel.find({ type: 'Text', text: /Tiempo/ })).toBeUndefined()
})

test('turno activo se dibuja con estado y tiempo, sin el texto de plan ausente', async ($, on) => {
  world(on)
  await start($)

  await $.turn.start({ text: 'hola', turnId: 'a1' } as never)
  const panel = await $.ui.mount(above())
  expect(await panel.find({ type: 'Text', text: /En curso/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /Tiempo: 00:00/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /Sin plan emitido por la sesión/ })).toBeUndefined()
})

test('pasos reales se dibujan aunque el turno haya terminado', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: {} }) as never)
  await start($)

  await $.turn.start({ text: 'hola', turnId: 'a2' } as never)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [{ content: 'Leer el código', status: 'completed', activeForm: 'Leyendo el código' }],
  } as never)
  await $.turn.complete({ reason: 'answer', turnId: 'a2' } as never)

  const panel = await $.ui.mount(above())
  expect(await panel.find({ type: 'Text', text: /Terminado/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /\[x\] Leer el código/ })).toBeDefined()
})

test('un turno terminado con error se dibuja como detenido', async ($, on) => {
  world(on)
  await start($)

  await $.turn.start({ text: 'hola', turnId: 'a3' } as never)
  await $.turn.complete({ reason: 'error', turnId: 'a3' } as never)
  const panel = await $.ui.mount(above())
  expect(await panel.find({ type: 'Text', text: /Detenido/ })).toBeDefined()
})

test('un turno terminado normal sin nada que destacar no deja panel', async ($, on) => {
  world(on)
  await start($)

  await $.turn.start({ text: 'hola', turnId: 'a4' } as never)
  await $.turn.complete({ reason: 'answer', turnId: 'a4' } as never)
  const panel = await $.ui.mount(above())
  expect(await panel.find({ type: 'Text', text: /Estado/ })).toBeUndefined()
  expect(await panel.find({ type: 'Text', text: /Terminado/ })).toBeUndefined()
})

test('an interrupted turn shows detenido, never terminado', async ($, on) => {
  world(on)
  await start($)

  await $.turn.start({ text: 'hola', turnId: 't2' } as never)
  await $.turn.complete({ reason: 'aborted', turnId: 't2' } as never)
  const panel = await $.ui.mount(above())
  expect(await panel.find({ type: 'Text', text: /Detenido/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /Terminado/ })).toBeUndefined()
})

test('the plan shows only the steps the session emitted, with the active one marked', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: {} }) as never)
  await start($)

  await $.turn.start({ text: 'hola', turnId: 't3' } as never)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Leer el código', status: 'completed', activeForm: 'Leyendo el código' },
      { content: 'Escribir tests', status: 'in_progress', activeForm: 'Escribiendo tests' },
    ],
  } as never)

  const panel = await $.ui.mount(above())
  expect(await panel.find({ type: 'Text', text: /\[>\] Escribiendo tests/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /\[x\] Leer el código/ })).toBeDefined()
})

test('two calls waiting at once: finishing one keeps the panel pending for the other', async ($, on) => {
  world(on)
  on('tool.check', () => ({ decision: 'ask' }) as never)
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} }) as never)
  await start($)

  await $.turn.start({ text: 'hola', turnId: 't4' } as never)
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'c1' } as never)
  await $.tool.check({ tool: 'Bash', input: { command: 'pwd' }, tool_use_id: 'c2' } as never)
  await $.tool.call({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'c1' } as never)

  const partly = await $.ui.mount(above())
  expect(await partly.find({ type: 'Text', text: /Pendiente de mi respuesta/ })).toBeDefined()

  await $.tool.call({ tool: 'Bash', input: { command: 'pwd' }, tool_use_id: 'c2' } as never)
  const cleared = await $.ui.mount(above())
  expect(await cleared.find({ type: 'Text', text: /En curso/ })).toBeDefined()
})

test('an AskUserQuestion dialog that is still open shows pendiente until it is answered', async ($, on) => {
  const clock = world(on)
  let opened = false
  let answer: (value: unknown) => void = () => undefined
  on('tool.call', { tool: 'AskUserQuestion' }, () => {
    opened = true
    return new Promise(resolve => {
      answer = resolve
    }) as never
  })
  await start($)

  await $.turn.start({ text: 'hola', turnId: 't5' } as never)
  const call = $.tool.call({ tool: 'AskUserQuestion', input: { questions: [] }, tool_use_id: 'q1' } as never)
  await clock.settle()
  expect(opened).toBe(true)

  const asking = await $.ui.mount(above())
  expect(await asking.find({ type: 'Text', text: /Pendiente de mi respuesta/ })).toBeDefined()

  answer({ result: {} })
  await call
  const answered = await $.ui.mount(above())
  expect(await answered.find({ type: 'Text', text: /Pendiente de mi respuesta/ })).toBeUndefined()
  expect(await answered.find({ type: 'Text', text: /En curso/ })).toBeDefined()
})

test('an interrupted turn with a permission still pending shows detenido', async ($, on) => {
  world(on)
  on('tool.check', () => ({ decision: 'ask' }) as never)
  await start($)

  await $.turn.start({ text: 'hola', turnId: 't6' } as never)
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'p1' } as never)
  await $.turn.complete({ reason: 'aborted', turnId: 't6' } as never)

  const panel = await $.ui.mount(above())
  expect(await panel.find({ type: 'Text', text: /Detenido/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /Pendiente de mi respuesta/ })).toBeUndefined()
})

test('a running turn without plan shows estado and tiempo, never the old no-plan text', async ($, on) => {
  world(on)
  await start($)

  await $.turn.start({ text: 'hola', turnId: 't7' } as never)
  const panel = await $.ui.mount(above())
  expect(await panel.find({ type: 'Text', text: /Sin plan emitido por la sesión/ })).toBeUndefined()
  expect(await panel.find({ type: 'Text', text: /En curso/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /Tiempo/ })).toBeDefined()
})

test('the elapsed time stops growing when the turn ends and when the session ends', async ($, on) => {
  const clock = world(on)
  on('session.end', () => ({ sessionId: 's1' }) as never)
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: {} }) as never)
  await start($)

  await $.turn.start({ text: 'hola', turnId: 't8' } as never)
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Paso', status: 'in_progress', activeForm: 'Dando un paso' }] } as never)
  await clock.advance(3000)
  await $.turn.complete({ reason: 'answer', turnId: 't8' } as never)
  await clock.advance(5000)
  const done = await $.ui.mount(above())
  expect(await done.find({ type: 'Text', text: /Tiempo: 00:03/ })).toBeDefined()

  await $.turn.start({ text: 'otra', turnId: 't9' } as never)
  await clock.advance(2000)
  await $.session.end({ reason: 'exit' } as never)
  await clock.advance(5000)
  const ended = await $.ui.mount(above())
  expect(await ended.find({ type: 'Text', text: /Tiempo: 00:02/ })).toBeDefined()
})

test('a failing store write does not break /simple', async ($, on) => {
  let refused = 0
  on('store.set', { key: 'enabled' }, () => {
    refused += 1
    return { deny: 'disco lleno' } as never
  })
  world(on)
  await start($)

  expect((await simple($, 'on')).text).toContain('activada')
  expect(refused).toBeGreaterThan(0)

  const tool = await $.ui.mount(row('ToolUse', {}))
  expect(await tool.drawn()).toMatchObject({ type: 'Box', props: { display: 'none' } })
})
