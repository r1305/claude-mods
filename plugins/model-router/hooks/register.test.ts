import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { classify } from './classify'

const PANE = {
  plugin: 'model-router',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'model-router',
  props: { title: 'Model router', isFocused: false, bodyColumns: 80, placement: 'inline' },
} as never

const textOf = (n: unknown): string => {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  if (n && typeof n === 'object') {
    const o = n as { props?: { children?: unknown }; children?: unknown }
    return textOf((o.props as { label?: string; children?: unknown } | undefined)?.label ?? o.props?.children ?? o.children)
  }
  return ''
}

const tareasText = async (ui: { press: (t: { key: string }) => Promise<unknown>; drawn: () => Promise<unknown> }) => {
  await ui.press({ key: 'tab-tareas' })
  return textOf(await ui.drawn())
}

const LONG_CONCURRENCY = `Revisa el flujo de reservas: dos usuarios reservan el mismo horario a la vez. ${'Contexto: transacciones, locks de fila, concurrencia en MySQL, pool compartido. '.repeat(12)}`

const spawnInput = (over: Record<string, unknown>) =>
  ({
    tool_use_id: 'toolu_x',
    prompt: 'busca donde esta el login',
    description: 'Buscar archivos',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
    ...over,
  }) as never

const engineSpawn = (on: On, seen: { model?: unknown }, extra: Record<string, unknown> = {}) =>
  on('agent.spawn', (_$, e) => {
    seen.model = e.model
    return { model: (e.model as string | undefined) ?? 'claude-opus-5-5', agentId: 'agent_1', ...extra } as never
  })

const complete = (agentId: string, reason: string) =>
  ({
    answer: 'ok',
    durationMs: 1500,
    isAborted: reason === 'aborted',
    turnId: 't1',
    agentId,
    reason,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' },
  }) as never

test('classify: simple, medium and complex', () => {
  expect(classify('Buscar archivos', 'busca donde esta el login')).toBe('haiku')
  expect(classify('Rename helper', 'rename foo to bar')).toBe('haiku')
  expect(classify('Cambiar color', 'cambia el color del boton en css')).toBe('haiku')
  expect(classify('Add endpoint', 'implement the new endpoint and its tests')).toBe('sonnet')
  expect(classify('Fix bug', 'corrige el bug del formulario')).toBe('sonnet')
  expect(classify('Integrar pagos', 'integrar Stripe checkout')).toBe('opus')
  expect(classify('Refactor', 'refactor the data layer across modules')).toBe('opus')
  expect(classify('Auth', 'review the oauth security flow')).toBe('opus')
})

test('classify: negatives', () => {
  expect(classify('research', 'research the caching options for the app')).not.toBe('haiku')
  expect(classify('Update handler', 'update global error handler')).not.toBe('haiku')
  expect(classify('Perfil analista', 'actualiza el perfil analista')).not.toBe('haiku')
  expect(classify('Leak', 'debug allocation leak in worker')).not.toBe('haiku')
  expect(classify('Listener', 'wire the listener to the socket')).not.toBe('haiku')
  expect(classify('Actualizar package-lock', 'regenera package-lock.json')).not.toBe('opus')
  expect(classify('Buscar por qué se duplican reservas', LONG_CONCURRENCY)).not.toBe('haiku')
  expect(classify('Cambiar texto', 'cambia el texto del botón de pagos')).not.toBe('opus')
  expect(classify('cambia el texto del botón de pagos', 'cambia el texto del botón de pagos')).not.toBe('opus')
  expect(classify('Backup', 'revisa la copia de seguridad diaria')).not.toBe('opus')
  expect(classify('Buscar uso', `busca donde se usa formatDate. ${'Restricciones: seguridad, pagos/Stripe, cPanel. '.repeat(20)}`)).not.toBe('opus')
})

test('named agents are routed with their base and floor', async ($, on) => {
  mock.clock(on)
  const seen: { model?: unknown } = { model: 'unset' }
  engineSpawn(on, seen)
  await $.agent.spawn(spawnInput({ subagentType: 'review', description: 'Review cambios', prompt: 'revisa el diff' }))
  expect(seen.model).toBe('opus')
  await $.agent.spawn(spawnInput({ subagentType: 'review', description: 'Buscar usos', prompt: 'busca donde se usa el helper' }))
  expect(seen.model).toBe('sonnet')
  await $.agent.spawn(spawnInput({ subagentType: 'qa', description: 'Validar cambios', prompt: 'valida que compila y pasa los tests' }))
  expect(seen.model).toBe('haiku')
  await $.agent.spawn(spawnInput({ subagentType: 'qa', description: 'Validar con BD prod', prompt: 'valida el cambio contra la BD prod' }))
  expect(seen.model).toBe('sonnet')
  await $.agent.spawn(spawnInput({ subagentType: 'dev', description: 'Refactor de pagos multiarchivo', prompt: 'refactoriza el modulo de pagos' }))
  expect(seen.model).toBe('opus')
  await $.agent.spawn(spawnInput({ subagentType: 'some-plugin:writer', description: 'Cambiar color', prompt: 'cambia el color del boton en css' }))
  expect(seen.model).toBe('sonnet')
  const ui = await $.ui.mount(PANE)
  expect(await tareasText(ui)).toMatch(/Cambiar color.*\(auto\)/)
})

test('usage limits lower the routed model', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 96 }] } }) as never)
  const seen: { model?: unknown } = {}
  engineSpawn(on, seen)
  await $.agent.spawn(spawnInput({ subagentType: 'dev', description: 'Refactor de pagos multiarchivo', prompt: 'refactoriza el modulo de pagos' }))
  expect(seen.model).toBe('haiku')
  await $.agent.spawn(spawnInput({ subagentType: 'review', description: 'Review cambios', prompt: 'revisa el diff' }))
  expect(seen.model).toBe('sonnet')
})

test('fork is not rewritten', async ($, on) => {
  mock.clock(on)
  const seen: { model?: unknown } = { model: 'unset' }
  engineSpawn(on, seen)
  await $.agent.spawn(spawnInput({ fork: true, subagentType: 'fork' }))
  expect(seen.model).toBeUndefined()
})

test('general-purpose gets a model; an explicit model is recorded but the router decides', async ($, on) => {
  mock.clock(on)
  const seen: { model?: unknown } = {}
  engineSpawn(on, seen)
  await $.agent.spawn(spawnInput({}))
  expect(seen.model).toBe('haiku')
  await $.agent.spawn(spawnInput({ description: 'Integrar pagos', prompt: 'integrar Stripe', model: 'haiku' }))
  expect(seen.model).toBe('opus')
  await $.agent.spawn(spawnInput({ subagentType: 'Explore', description: 'Integrar pagos', prompt: 'integrar Stripe' }))
  expect(seen.model).toBe('opus')
})

test('background spawn stays running until its turn.complete', async ($, on) => {
  mock.clock(on)
  const statuses: unknown[] = []
  on('ui.status', (_$, e) => {
    statuses.push((e as { text?: string }).text)
    return { value: undefined } as never
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  const seen: { model?: unknown } = {}
  engineSpawn(on, seen, { status: 'async_launched' })
  await $.agent.spawn(spawnInput({ background: true }))
  expect(statuses[statuses.length - 1]).toBe('Router ● · 1 en curso')
  const ui = await $.ui.mount(PANE)
  expect(await tareasText(ui)).toMatch(/1 en curso.*0 hechas.*0 con error/)

  const out = await $.turn.complete(complete('agent_1', 'answer'))
  expect(out.text).toBe('ok')
  expect(statuses[statuses.length - 1]).toBe('Router ●')
  expect(textOf(await ui.drawn())).toMatch(/0 en curso.*1 hecha\b.*0 con error/)
  expect(textOf(await ui.drawn())).toMatch(/Buscar archivos.*\(auto\)/)

  await $.turn.complete(complete('agent_1', 'answer'))
  await $.turn.complete(complete('other', 'answer'))
  expect(textOf(await ui.drawn())).toMatch(/0 en curso.*1 hecha\b.*0 con error/)
})

test('turn.complete with error marks the task error', async ($, on) => {
  mock.clock(on)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  engineSpawn(on, {})
  await $.agent.spawn(spawnInput({}))
  await $.turn.complete(complete('agent_1', 'error'))
  const ui = await $.ui.mount(PANE)
  expect(await tareasText(ui)).toMatch(/0 en curso.*0 hechas.*1 con error/)
})

test('denied spawn is recorded as error', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ deny: 'nope' }) as never)
  const r = await $.agent.spawn(spawnInput({}))
  expect(r.deny).toBe('nope')
  const ui = await $.ui.mount(PANE)
  expect(await tareasText(ui)).toMatch(/0 en curso.*0 hechas.*1 con error/)
})

test('routing off does not rewrite', async ($, on) => {
  mock.clock(on)
  const seen: { model?: unknown } = { model: 'unset' }
  engineSpawn(on, seen)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  await $.command.run({ command: 'model-router', args: 'off' } as never)
  await $.agent.spawn(spawnInput({}))
  expect(seen.model).toBeUndefined()
})

test('policy only when Agent tool is offered', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }) as never)
  const base = { model: 'm', promptModel: 'm', surfaces: [], outputStyle: null, traits: [] }
  const withAgent = await $.prompt.compose({ ...base, tools: ['Agent', 'Read'] } as never)
  expect(withAgent.sections.some(s => s.id === 'model-router:policy')).toBe(true)
  const without = await $.prompt.compose({ ...base, tools: ['Read'] } as never)
  expect(without.sections.some(s => s.id === 'model-router:policy')).toBe(false)
})
