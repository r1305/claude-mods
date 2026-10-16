import type { On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const A = '2026-10-16T18:00:00.000Z'
const B = '2026-10-16T23:00:00.000Z'

const limit = (kind: string, percentUsed: number, resetsAt: string = A) => ({ kind, percentUsed, resetsAt })

const world = (on: On, toasts: string[], store: Record<string, unknown> = {}, commandError?: string) => {
  mock.store(on, store)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }) as never)
  on('command.register', () => (commandError === undefined ? { value: { command: 'quota' } } : { deny: commandError }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.measure', () => ({ changed: [] }) as never)
  on('ui.render', () => ({ type: 'Box', props: {} }) as never)
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
}

const start = ($: Engine) => $.session.start({ cwd: '/w/proyecto-a', surface: 'terminal', isInteractive: true } as never)

const measure = ($: Engine, rateLimits: ReturnType<typeof limit>[]) =>
  $.session.measure({ context: { window: 200000 }, rateLimits, changed: ['rateLimits'] } as never)

const quota = async ($: Engine, args: string) => (await $.command.run({ command: 'quota', args } as never)).text

const finish = ($: Engine, turnId: string, usage?: Record<string, unknown>) =>
  $.turn.complete({ reason: 'answer', turnId, ...(usage === undefined ? {} : { usage }) } as never)

test('without readings /quota says Sin dato for the windows and the tokens, and invents no figure', async ($, on) => {
  world(on, [])
  await start($)
  const text = await quota($, '')
  expect(text).toContain('Ventana de 5 h: Sin dato')
  expect(text).toContain('Ventana semanal: Sin dato')
  expect(text).toContain('Tokens por modelo en esta sesión: Sin dato')
})

test('5 h: an aviso at 80 % and a crítico at 90 %, once each, and no repeat while the figure stays', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await start($)

  await measure($, [limit('five_hour', 79)])
  expect(toasts).toEqual([])

  await measure($, [limit('five_hour', 80)])
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('Aviso')
  expect(toasts[0]).toContain('Ventana de 5 h')

  await measure($, [limit('five_hour', 85)])
  expect(toasts.length).toBe(1)

  await measure($, [limit('five_hour', 90)])
  expect(toasts.length).toBe(2)
  expect(toasts[1]).toContain('Crítico')

  await measure($, [limit('five_hour', 95)])
  expect(toasts.length).toBe(2)
})

test('semanal: the same thresholds, counted apart from the 5 h window', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await start($)

  await measure($, [limit('five_hour', 50), limit('seven_day', 80)])
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('Ventana semanal')

  await measure($, [limit('five_hour', 50), limit('seven_day', 85)])
  expect(toasts.length).toBe(1)

  await measure($, [limit('five_hour', 50), limit('seven_day', 91)])
  expect(toasts.length).toBe(2)
  expect(toasts[1]).toContain('Crítico')
  expect(toasts[1]).toContain('Ventana semanal')
})

test('a window that resets (new reset time) raises its alerts again', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await start($)

  await measure($, [limit('five_hour', 85, A)])
  expect(toasts.length).toBe(1)

  await measure($, [limit('five_hour', 85, B)])
  expect(toasts.length).toBe(2)
  expect(toasts[1]).toContain('Aviso')

  await measure($, [limit('five_hour', 85, B)])
  expect(toasts.length).toBe(2)
})

test('a drop in the figure (window reset) lets the same threshold alert again', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await start($)

  await measure($, [limit('seven_day', 92)])
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('Crítico')

  await measure($, [limit('seven_day', 5)])
  await measure($, [limit('seven_day', 81)])
  expect(toasts.length).toBe(2)
  expect(toasts[1]).toContain('Aviso')
})

test('/quota alerts off hides the toasts; turning them back on does not repeat a threshold already passed', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await start($)

  expect(await quota($, 'alerts off')).toContain('ocultas')
  await measure($, [limit('five_hour', 85)])
  expect(toasts).toEqual([])

  expect(await quota($, 'alerts on')).toContain('activadas')
  await measure($, [limit('five_hour', 86)])
  expect(toasts).toEqual([])
})

test('custom thresholds stored in the preferences are used', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts, { prefs: { alerts: true, warn: 50, critical: 70 } })
  await start($)
  await measure($, [limit('five_hour', 55)])
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('umbral 50')
})

test('invalid stored thresholds fall back to 80 and 90', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts, { prefs: { alerts: true, warn: 95, critical: 10 } })
  await start($)
  await measure($, [limit('five_hour', 85)])
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('umbral 80')
})

test('/quota umbrales changes the thresholds and refuses an order that does not hold', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await start($)
  expect(await quota($, 'umbrales 70 85')).toContain('aviso 70 %, crítico 85 %')
  expect(await quota($, 'umbrales 90 70')).toContain('Uso')
  await measure($, [limit('five_hour', 72)])
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('umbral 70')
})

test('tokens per model add up over two models in the session, and the panel shows the total', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await start($)

  await finish($, 't1', { model: 'modelo-a', input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  await finish($, 't2', { model: 'modelo-b', input_tokens: 50, output_tokens: 30, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 })
  await finish($, 't3', { model: 'modelo-a', input_tokens: 25, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 4 })

  const text = await quota($, '')
  expect(text).toContain('modelo-a: entrada 125 · salida 25 · caché lectura 0 · caché escritura 4')
  expect(text).toContain('modelo-b: entrada 50 · salida 30 · caché lectura 10 · caché escritura 0')
  expect(text).toContain('Total: entrada 175 · salida 55 · caché lectura 10 · caché escritura 4')

  const panel = await $.ui.mount({ plugin: 'quota-watch', surface: 'terminal', component: 'AbovePrompt', requestId: 'p1', props: { hasSurvey: false, isWorking: false, maxRows: 20 } } as never)
  expect(await panel.find({ type: 'Text', text: /entrada 175 · salida 55/ })).toBeDefined()
})

test('a session without usage reports Sin dato in the panel', async ($, on) => {
  world(on, [])
  await start($)
  const panel = await $.ui.mount({ plugin: 'quota-watch', surface: 'terminal', component: 'AbovePrompt', requestId: 'p2', props: { hasSurvey: false, isWorking: false, maxRows: 20 } } as never)
  expect(await panel.find({ type: 'Text', text: /Tokens de la sesión: Sin dato/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /Ventana de 5 h: Sin dato/ })).toBeDefined()
})

test('the panel yields to a survey and draws nothing of its own then', async ($, on) => {
  world(on, [])
  await start($)
  const panel = await $.ui.mount({ plugin: 'quota-watch', surface: 'terminal', component: 'AbovePrompt', requestId: 'p3', props: { hasSurvey: true, isWorking: false, maxRows: 20 } } as never)
  expect(await panel.find({ type: 'Text', text: /Ventana de 5 h/ })).toBeUndefined()
})

test('a new session starts the tokens per model and the alerts from zero', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await start($)
  await finish($, 't1', { model: 'modelo-a', input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  await measure($, [limit('five_hour', 85)])
  expect(toasts.length).toBe(1)
  expect(await quota($, '')).toContain('modelo-a: entrada 100')

  await start($)
  expect(await quota($, '')).toContain('Tokens por modelo en esta sesión: Sin dato')
  await measure($, [limit('five_hour', 85)])
  expect(toasts.length).toBe(2)
  expect(toasts[1]).toContain('Aviso')
})

test('a failed /quota registration is not fatal: the mod still loads and says so in a toast', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts, {}, 'nombre ocupado')
  await start($)
  expect(toasts.some(text => text.includes('/quota no se pudo registrar') && text.includes('nombre ocupado'))).toBe(true)
  await measure($, [limit('five_hour', 85)])
  expect(toasts[toasts.length - 1]).toContain('Aviso')
  expect(await quota($, '')).toContain('Ventana de 5 h: 85 %')
})
