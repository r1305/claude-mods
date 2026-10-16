import { test, expect } from 'claude-code/testing'

import type { QuotaPrefs, QuotaWindow } from '../types'
import {
  DEFAULT_PREFS,
  addUsage,
  alertText,
  emptyMemory,
  formatPercent,
  evaluateAlerts,
  formatReset,
  levelOf,
  modelsLine,
  parseCommand,
  parsePrefs,
  quotaReport,
  totalsOf,
  windowLine,
  windowsOf,
  emptyWindows,
} from './logic'

const A = '2026-10-16T18:00:00.000Z'
const B = '2026-10-16T23:00:00.000Z'
const win = (percentUsed: number, resetsAt: string | null = A): QuotaWindow => ({ percentUsed, resetsAt })

test('windowsOf reads only the two windows and never invents a reading', () => {
  expect(windowsOf([])).toEqual({ five_hour: null, seven_day: null })
  expect(windowsOf([{ kind: 'spend_limit', percentUsed: 120 }])).toEqual({ five_hour: null, seven_day: null })
  expect(windowsOf([{ kind: 'five_hour', percentUsed: 42.5, resetsAt: A }])).toEqual({
    five_hour: { percentUsed: 42.5, resetsAt: A },
    seven_day: null,
  })
  expect(windowsOf([{ kind: 'seven_day', percentUsed: Number.NaN }])).toEqual(emptyWindows())
})

test('levels: under 80 is normal, 80 is aviso, 90 is crítico (defaults)', () => {
  expect(levelOf(79.9, DEFAULT_PREFS)).toBe('normal')
  expect(levelOf(80, DEFAULT_PREFS)).toBe('aviso')
  expect(levelOf(90, DEFAULT_PREFS)).toBe('critico')
})

test('the 80 % alert fires once; 85 % does not repeat it; 90 % fires the critical one once', () => {
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

  result = evaluateAlerts(memory, win(95), DEFAULT_PREFS)
  expect(result.alert).toBeUndefined()
})

test('jumping straight past both thresholds raises one critical alert and marks both as fired', () => {
  const result = evaluateAlerts(emptyMemory(), win(93), DEFAULT_PREFS)
  expect(result.alert).toEqual({ level: 'critico', threshold: 90 })
  expect(result.memory.fired.sort()).toEqual([80, 90])
  expect(evaluateAlerts(result.memory, win(95), DEFAULT_PREFS).alert).toBeUndefined()
})

test('a new reset time starts the window over, so the alerts come again', () => {
  const first = evaluateAlerts(emptyMemory(), win(85, A), DEFAULT_PREFS)
  expect(first.alert?.threshold).toBe(80)
  const sameWindow = evaluateAlerts(first.memory, win(86, A), DEFAULT_PREFS)
  expect(sameWindow.alert).toBeUndefined()
  const nextWindow = evaluateAlerts(sameWindow.memory, win(85, B), DEFAULT_PREFS)
  expect(nextWindow.alert).toEqual({ level: 'aviso', threshold: 80 })
})

test('a usage drop below the last reading also starts the window over', () => {
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
  const hidden: QuotaPrefs = { ...DEFAULT_PREFS, alerts: false }
  const quiet = evaluateAlerts(emptyMemory(), win(85), hidden)
  expect(quiet.alert).toBeUndefined()
  expect(quiet.memory.fired).toEqual([80])
  expect(evaluateAlerts(quiet.memory, win(86), DEFAULT_PREFS).alert).toBeUndefined()
})

test('custom thresholds from the preferences replace the defaults', () => {
  const custom: QuotaPrefs = { alerts: true, warn: 50, critical: 70 }
  expect(evaluateAlerts(emptyMemory(), win(55), custom).alert).toEqual({ level: 'aviso', threshold: 50 })
  expect(evaluateAlerts(emptyMemory(), win(75), custom).alert).toEqual({ level: 'critico', threshold: 70 })
})

test('alert and window lines show the real figure, the reset and the level, or Sin dato', () => {
  expect(alertText('five_hour', { level: 'aviso', threshold: 80 }, win(82.4))).toContain('Aviso')
  expect(alertText('seven_day', { level: 'critico', threshold: 90 }, win(91))).toContain('Crítico')
  expect(windowLine('five_hour', null, DEFAULT_PREFS)).toBe('Ventana de 5 h: Sin dato')
  expect(windowLine('seven_day', win(91, null), DEFAULT_PREFS)).toBe('Ventana semanal: 91 % · crítico')
  expect(windowLine('five_hour', win(50), DEFAULT_PREFS)).toMatch(/^Ventana de 5 h: 50 % · reinicia \d{2}\/\d{2} \d{2}:\d{2}$/)
  expect(formatReset(null)).toBe('Sin dato')
  expect(formatReset('no es fecha')).toBe('Sin dato')
})

test('tokens per model add up across two models, and an empty session says Sin dato', () => {
  expect(modelsLine({})).toBe('Sin dato')
  let models = addUsage({}, 'modelo-a', { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 1 })
  models = addUsage(models, 'modelo-b', { input_tokens: 40, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  models = addUsage(models, 'modelo-a', { input_tokens: 60, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 2 })
  expect(models['modelo-a']).toEqual({ input: 160, output: 25, cacheRead: 12, cacheWrite: 3 })
  expect(models['modelo-b']).toEqual({ input: 40, output: 10, cacheRead: 0, cacheWrite: 0 })
  expect(totalsOf(models)).toEqual({ input: 200, output: 35, cacheRead: 12, cacheWrite: 3 })
  expect(modelsLine(models)).toBe('entrada 200 · salida 35')
})

test('a usage row without a model name is kept under a neutral name', () => {
  const models = addUsage({}, '', { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  expect(Object.keys(models)).toEqual(['desconocido'])
})

test('the report lists each window, the alert state and the tokens by model', () => {
  const report = quotaReport(
    { five_hour: win(81), seven_day: null },
    addUsage({}, 'modelo-a', { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    DEFAULT_PREFS,
  )
  expect(report).toContain('Ventana de 5 h: 81 %')
  expect(report).toContain('Ventana semanal: Sin dato')
  expect(report).toContain('modelo-a: entrada 1,000 · salida 200')
  expect(report).toContain('Total: entrada 1,000 · salida 200')
  expect(quotaReport(emptyWindows(), {}, DEFAULT_PREFS)).toContain('Tokens por modelo en esta sesión: Sin dato')
})

test('parsePrefs keeps valid values and falls back to the defaults for anything else', () => {
  expect(parsePrefs(undefined)).toEqual(DEFAULT_PREFS)
  expect(parsePrefs('no')).toEqual(DEFAULT_PREFS)
  expect(parsePrefs({ alerts: false, warn: 60, critical: 85 })).toEqual({ alerts: false, warn: 60, critical: 85 })
  expect(parsePrefs({ alerts: 'si', warn: 60.5, critical: 85 })).toEqual({ alerts: true, warn: 80, critical: 85 })
  expect(parsePrefs({ alerts: true, warn: 95, critical: 10 })).toEqual(DEFAULT_PREFS)
})

test('parseCommand reads /quota arguments and refuses the rest', () => {
  expect(parseCommand('')).toEqual({ kind: 'show' })
  expect(parseCommand(' alerts OFF ')).toEqual({ kind: 'alerts', on: false })
  expect(parseCommand('umbrales 70 85')).toEqual({ kind: 'thresholds', warn: 70, critical: 85 })
  expect(parseCommand('umbrales 85 70').kind).toBe('error')
  expect(parseCommand('umbrales 70').kind).toBe('error')
  expect(parseCommand('alerts maybe').kind).toBe('error')
})

test('the level uses the figure shown: 79.96 shows 80 % and is aviso, 79.94 shows 79.9 % and is normal', () => {
  expect(formatPercent(79.96)).toBe('80 %')
  expect(levelOf(79.96, DEFAULT_PREFS)).toBe('aviso')
  expect(windowLine('five_hour', win(79.96, null), DEFAULT_PREFS)).toBe('Ventana de 5 h: 80 % · aviso')
  expect(evaluateAlerts(emptyMemory(), win(79.96), DEFAULT_PREFS).alert).toEqual({ level: 'aviso', threshold: 80 })
  expect(formatPercent(79.94)).toBe('79.9 %')
  expect(levelOf(79.94, DEFAULT_PREFS)).toBe('normal')
  expect(evaluateAlerts(emptyMemory(), win(79.94), DEFAULT_PREFS).alert).toBeUndefined()
})
