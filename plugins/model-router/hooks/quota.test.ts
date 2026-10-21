import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { ModelRouterModels } from '../types'
import {
  DEFAULT_PREFS,
  addUsage,
  alertText,
  emptyMemory,
  evaluateAlerts,
  formatClock,
  levelOf,
  modelRowText,
  parseCommand,
  parsePrefs,
  totalsOf,
  windowLine,
  windowsOf,
} from './quota'
import { route } from './route'
import { sessionOf } from './usage'

const A = '2026-10-16T18:00:00.000Z'
const B = '2026-10-16T23:00:00.000Z'
const NOW = new Date(2026, 9, 12, 12, 0, 0).getTime()
const win = (percentUsed: number, resetsAt: string | null = A) => ({ percentUsed, resetsAt })
const limit = (kind: string, percentUsed: number, resetsAt: string = A) => ({ kind, percentUsed, resetsAt })

const PANE = {
  plugin: 'model-router',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'model-router',
  props: { title: 'Model router', isFocused: false, bodyColumns: 80, placement: 'inline' },
} as never

const TALL_PANE = {
  plugin: 'model-router',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'model-router',
  viewport: { columns: 80, rows: 90 },
  props: { title: 'Model router', isFocused: false, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 80 } },
} as never

test('levels follow the configurable thresholds: 80 and 90 by default', () => {
  expect(levelOf(79.9, DEFAULT_PREFS)).toBe('normal')
  expect(levelOf(80, DEFAULT_PREFS)).toBe('aviso')
  expect(levelOf(90, DEFAULT_PREFS)).toBe('critico')
  const custom = { alerts: true, warn: 50, critical: 70 }
  expect(levelOf(55, custom)).toBe('aviso')
  expect(levelOf(70, custom)).toBe('critico')
})

test('the aviso alert fires once; 85 % does not repeat it; the crítico one fires once', () => {
  let memory = emptyMemory()
  let result = evaluateAlerts(memory, win(79), DEFAULT_PREFS)
  expect(result.alert).toBeUndefined()
  memory = result.memory

  result = evaluateAlerts(memory, win(80), DEFAULT_PREFS)
  expect(result.alert).toEqual({ level: 'aviso', threshold: 80 })
  memory = result.memory

  result = evaluateAlerts(memory, win(85), DEFAULT_PREFS)
  expect(result.alert).toBeUndefined()
  memory = result.memory

  result = evaluateAlerts(memory, win(90), DEFAULT_PREFS)
  expect(result.alert).toEqual({ level: 'critico', threshold: 90 })
  memory = result.memory

  expect(evaluateAlerts(memory, win(95), DEFAULT_PREFS).alert).toBeUndefined()
})

test('jumping past both thresholds raises one crítico alert and marks both as fired', () => {
  const result = evaluateAlerts(emptyMemory(), win(93), DEFAULT_PREFS)
  expect(result.alert).toEqual({ level: 'critico', threshold: 90 })
  expect(result.memory.fired.sort()).toEqual([80, 90])
})

test('a new reset time restarts the window cycle, so its alerts come again', () => {
  const first = evaluateAlerts(emptyMemory(), win(85, A), DEFAULT_PREFS)
  expect(first.alert?.threshold).toBe(80)
  const sameWindow = evaluateAlerts(first.memory, win(86, A), DEFAULT_PREFS)
  expect(sameWindow.alert).toBeUndefined()
  const nextWindow = evaluateAlerts(sameWindow.memory, win(85, B), DEFAULT_PREFS)
  expect(nextWindow.alert).toEqual({ level: 'aviso', threshold: 80 })
})

test('a drop in the figure restarts the cycle too', () => {
  const high = evaluateAlerts(emptyMemory(), win(92, null), DEFAULT_PREFS)
  expect(high.alert?.threshold).toBe(90)
  const dropped = evaluateAlerts(high.memory, win(10, null), DEFAULT_PREFS)
  expect(dropped.alert).toBeUndefined()
  const again = evaluateAlerts(dropped.memory, win(81, null), DEFAULT_PREFS)
  expect(again.alert).toEqual({ level: 'aviso', threshold: 80 })
})

test('no reading means no alert and no change to the memory', () => {
  const memory = evaluateAlerts(emptyMemory(), win(85), DEFAULT_PREFS).memory
  const result = evaluateAlerts(memory, null, DEFAULT_PREFS)
  expect(result.alert).toBeUndefined()
  expect(result.memory).toEqual(memory)
})

test('with alerts hidden the threshold is still marked, so showing them later does not repeat it', () => {
  const quiet = evaluateAlerts(emptyMemory(), win(85), { ...DEFAULT_PREFS, alerts: false })
  expect(quiet.alert).toBeUndefined()
  expect(quiet.memory.fired).toEqual([80])
  expect(evaluateAlerts(quiet.memory, win(86), DEFAULT_PREFS).alert).toBeUndefined()
})

test('custom thresholds replace the defaults in the alerts', () => {
  const custom = { alerts: true, warn: 50, critical: 70 }
  expect(evaluateAlerts(emptyMemory(), win(55), custom).alert).toEqual({ level: 'aviso', threshold: 50 })
  expect(evaluateAlerts(emptyMemory(), win(75), custom).alert).toEqual({ level: 'critico', threshold: 70 })
})

test('stored preferences: bad values fall back to 80 and 90, a good pair is kept', () => {
  expect(parsePrefs(undefined)).toEqual(DEFAULT_PREFS)
  expect(parsePrefs({ alerts: true, warn: 95, critical: 10 })).toEqual(DEFAULT_PREFS)
  expect(parsePrefs({ alerts: false, warn: 70, critical: 101 })).toEqual({ alerts: false, warn: 70, critical: 90 })
  expect(parsePrefs({ alerts: true, warn: 'x', critical: 85 })).toEqual({ alerts: true, warn: 80, critical: 85 })
  expect(parsePrefs({ alerts: 'si', warn: 60, critical: 85 })).toEqual({ alerts: true, warn: 60, critical: 85 })
})

test('windows: only the two plan windows are read; a missing one is Sin dato', () => {
  expect(windowsOf([])).toEqual({ five_hour: null, seven_day: null })
  expect(windowsOf([{ kind: 'spend_limit', percentUsed: 120 }])).toEqual({ five_hour: null, seven_day: null })
  expect(windowLine('five_hour', null, DEFAULT_PREFS)).toBe('Ventana de 5 h: Sin dato')
  expect(windowLine('seven_day', win(91, null), DEFAULT_PREFS)).toBe('Ventana semanal: 91 % · crítico')
  expect(windowLine('five_hour', win(50), DEFAULT_PREFS)).toMatch(/^Ventana de 5 h: 50 % · reinicia \d{2}:\d{2}$/)
  expect(windowLine('seven_day', win(50), DEFAULT_PREFS)).toMatch(/^Ventana semanal: 50 % · reinicia \d{2}\/\d{2} \d{2}:\d{2}$/)
  expect(formatClock(null)).toBe('Sin dato')
  expect(formatClock('no es fecha')).toBe('Sin dato')
  expect(alertText('seven_day', { level: 'critico', threshold: 90 }, win(91))).toContain('Crítico: Ventana semanal al 91 %')
})

test('tokens per exact model name: cache read and write stay apart and nothing is lost', () => {
  let models: ModelRouterModels = {}
  models = addUsage(models, 'modelo-a', { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 1 })
  models = addUsage(models, 'modelo-b', { input_tokens: 40, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  models = addUsage(models, 'modelo-a', { input_tokens: 60, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 2 })
  expect(models['modelo-a']).toEqual({ input: 160, output: 25, cacheRead: 12, cacheWrite: 3 })
  expect(models['modelo-b']).toEqual({ input: 40, output: 10, cacheRead: 0, cacheWrite: 0 })
  expect(totalsOf(models)).toEqual({ input: 200, output: 35, cacheRead: 12, cacheWrite: 3 })
  expect(modelRowText(models['modelo-a'] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(
    'entrada 160 · salida 25 · caché lectura 12 · caché escritura 3',
  )
})

test('the family split is derived from the same accumulator and keeps the cache too', () => {
  const models = addUsage({}, 'claude-haiku-4-5', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 4 })
  const families = sessionOf(models)
  expect(families.byModel.haiku).toBe(119)
  expect(families.cacheRead).toBe(100)
  expect(families.cacheWrite).toBe(4)
  expect(models['claude-haiku-4-5']?.cacheRead).toBe(100)
})

test('a usage row without a model name is kept under a neutral name', () => {
  const models = addUsage({}, '', { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  expect(Object.keys(models)).toEqual(['desconocido'])
})

test('command parsing: toggle, usage, alerts and umbrales, with errors for bad orders', () => {
  expect(parseCommand('')).toEqual({ kind: 'show' })
  expect(parseCommand('on')).toEqual({ kind: 'toggle', on: true })
  expect(parseCommand('off')).toEqual({ kind: 'toggle', on: false })
  expect(parseCommand('usage')).toEqual({ kind: 'usage' })
  expect(parseCommand('alerts off')).toEqual({ kind: 'alerts', on: false })
  expect(parseCommand('umbrales 70 85')).toEqual({ kind: 'thresholds', warn: 70, critical: 85 })
  expect(parseCommand('umbrales 90 70').kind).toBe('error')
  expect(parseCommand('umbrales 0 70').kind).toBe('error')
  expect(parseCommand('umbrales 70.5 85').kind).toBe('error')
  expect(parseCommand('umbrales 70').kind).toBe('error')
  expect(parseCommand('alerts maybe').kind).toBe('error')
})

test('one traffic light: the configured thresholds drive the routing downgrades', () => {
  const lim = [limit('five_hour', 85)]
  const job = ['dev', 'Refactor de pagos multiarchivo', 'refactoriza el módulo de pagos'] as const
  expect(route(job[0], job[1], job[2], lim, undefined, { warn: 80, critical: 90 }).model).toBe('sonnet')
  expect(route(job[0], job[1], job[2], lim, undefined, { warn: 90, critical: 95 }).model).toBe('opus')
  expect(route(job[0], job[1], job[2], [limit('five_hour', 92)], undefined, { warn: 80, critical: 90 }).model).toBe('haiku')
  expect(route(job[0], job[1], job[2], [limit('seven_day', 85)], undefined, { warn: 80, critical: 90 }).reason).toContain('uso 85 %')
})

const world = (on: On, toasts: string[], store: Record<string, unknown> = {}, counter?: { reads: number }) => {
  mock.clock(on, { now: NOW })
  mock.store(on, store)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.usage', () => {
    if (counter) counter.reads += 1
    return { value: { startedAt: 0, context: { window: 200000, tokens: 80000, percent: 40 }, rateLimits: [], cost: { usd: 1.5 } } } as never
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.measure', () => ({ changed: [] }) as never)
}

const start = ($: Engine) => $.session.start({ cwd: '/w/proyecto-a', surface: 'terminal', isInteractive: true } as never)

const measure = ($: Engine, rateLimits: ReturnType<typeof limit>[]) =>
  $.session.measure({ context: { window: 200000 }, rateLimits, changed: ['rateLimits'] } as never)

const usage = async ($: Engine, args = 'usage') => (await $.command.run({ command: 'model-router', args } as never)).text

const quota = async ($: Engine) => (await $.command.run({ command: 'quota', args: '' } as never)).text

const finish = ($: Engine, turnId: string, u: Record<string, unknown>) =>
  $.turn.complete({ answer: 'ok', durationMs: 1500, isAborted: false, reason: 'answer', turnId, usage: u } as never)

test('the plan limits are read once per refresh: at start and on /model-router usage, never on measure or on drawing', async ($, on) => {
  const toasts: string[] = []
  const counter = { reads: 0 }
  world(on, toasts, {}, counter)
  await start($)
  expect(counter.reads).toBe(1)

  await measure($, [limit('five_hour', 50)])
  expect(counter.reads).toBe(1)

  await usage($)
  expect(counter.reads).toBe(2)

  await quota($)
  expect(counter.reads).toBe(3)

  const ui = await $.ui.mount(PANE)
  await ui.drawn()
  expect(counter.reads).toBe(3)
})

test('alerts: one toast per threshold and window cycle, through the measure events', async ($, on) => {
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

test('alerts: a new reset time raises them again, and so does a drop in the figure', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await start($)

  await measure($, [limit('five_hour', 85, A)])
  expect(toasts.length).toBe(1)

  await measure($, [limit('five_hour', 85, B)])
  expect(toasts.length).toBe(2)

  await measure($, [limit('seven_day', 92)])
  expect(toasts.length).toBe(3)
  expect(toasts[2]).toContain('Crítico')
  await measure($, [limit('seven_day', 5)])
  await measure($, [limit('seven_day', 81)])
  expect(toasts.length).toBe(4)
  expect(toasts[3]).toContain('Aviso')
})

test('/model-router alerts off hides the toasts; a threshold passed meanwhile does not repeat', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await start($)

  expect(await usage($, 'alerts off')).toContain('ocultas')
  await measure($, [limit('five_hour', 85)])
  expect(toasts).toEqual([])

  expect(await usage($, 'alerts on')).toContain('activadas')
  await measure($, [limit('five_hour', 86)])
  expect(toasts).toEqual([])
})

test('/model-router umbrales changes the thresholds, refuses a bad order, and the usage text shows them', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts)
  await start($)

  expect(await usage($, 'umbrales 70 85')).toContain('aviso 70 %, crítico 85 %')
  expect(await usage($, 'umbrales 90 70')).toContain('Uso:')
  expect(await usage($)).toContain('Alertas: activadas · aviso 70 % · crítico 85 %')

  await measure($, [limit('five_hour', 72)])
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('umbral 70')
})

test('stored preferences apply from session start', async ($, on) => {
  const toasts: string[] = []
  world(on, toasts, { prefs: { alerts: true, warn: 50, critical: 70 } })
  await start($)
  await measure($, [limit('five_hour', 55)])
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('umbral 50')
})

test('/quota is an alias of /model-router usage: the same text', async ($, on) => {
  world(on, [])
  await start($)
  await finish($, 't1', { model: 'modelo-a', input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  const a = await usage($)
  const b = await quota($)
  expect(b).toBe(a)
})

test('tokens per model: exact names, cache kept, and the sum in the text', async ($, on) => {
  world(on, [])
  await start($)
  await finish($, 't1', { model: 'modelo-a', input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  await finish($, 't2', { model: 'modelo-b', input_tokens: 50, output_tokens: 30, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 })
  await finish($, 't3', { model: 'modelo-a', input_tokens: 25, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 4 })

  const text = await usage($)
  expect(text).toContain('modelo-a: entrada 125 · salida 25 · caché lectura 0 · caché escritura 4')
  expect(text).toContain('modelo-b: entrada 50 · salida 30 · caché lectura 10 · caché escritura 0')
  expect(text).toContain('Total: entrada 175 · salida 55 · caché lectura 10 · caché escritura 4')

  const ui = await $.ui.mount(TALL_PANE)
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Consumo')
  expect(drawn).toContain('Hoy ')
})

test('without readings the text and the pane say Sin dato', async ($, on) => {
  world(on, [])
  await start($)
  const text = await usage($)
  expect(text).toContain('Ventana de 5 h: Sin dato')
  expect(text).toContain('Ventana semanal: Sin dato')
  expect(text).toContain('Sin dato: aún no hay turnos completados en esta sesión.')
  const ui = await $.ui.mount(TALL_PANE)
  expect(JSON.stringify(await ui.drawn())).toContain('Ventana de 5 h: Sin dato')
})
