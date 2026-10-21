import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { ModelRouterDay } from '../types'
import { addTokens, aggregate, asUsageFile, bar, dayKey, fmtDur, fmtReset, fmtTokens, health, levelColor, lastDayKeys, pct, stackCells, statusText, trimDays, weekdayShort } from './usage'
import { DEFAULT_PREFS } from './quota'

const TH = { warn: DEFAULT_PREFS.warn, critical: DEFAULT_PREFS.critical }

const NOW = new Date(2026, 9, 12, 12, 0, 0).getTime()
const DAY = 24 * 3600 * 1000

const day = (haiku: number, sonnet = 0, opus = 0): ModelRouterDay => ({ haiku, sonnet, opus, other: 0, total: haiku + sonnet + opus })

const PANE = {
  plugin: 'model-router',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'model-router',
  viewport: { columns: 80, rows: 40 },
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

const linesOf = (n: unknown): string[] => {
  const out: string[] = []
  const walk = (x: unknown) => {
    if (!x || typeof x !== 'object') return
    const o = x as { type?: string; props?: { children?: unknown; flexDirection?: string }; children?: unknown }
    if (o.type === 'Text' || o.type === 'Button') {
      out.push(textOf(x))
      return
    }
    const kids = o.props?.children ?? o.children
    if (o.type === 'Box' && o.props?.flexDirection === 'row') {
      out.push(textOf(kids))
      return
    }
    for (const k of Array.isArray(kids) ? kids : [kids]) walk(k)
  }
  walk(n)
  return out
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

function fakeWorld(on: On, files: Record<string, string>, sessionId = 'sess-a') {
  const dir = '/cfg/model-router/usage'
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg' })
  on('session.id', () => ({ value: sessionId }) as never)
  on('session.cwd', () => ({ value: 'C:/work/proyecto-a' }) as never)
  on('fs.write', (_$, e) => {
    files[norm(e.path)] = e.text
    return { value: undefined } as never
  })
  on('fs.read', (_$, e) => {
    const t = files[norm(e.path)]
    if (t === undefined) throw new Error('ENOENT')
    return { value: t } as never
  })
  on('fs.list', (_$, e) => {
    if (norm(e.path) !== dir) return { value: [] } as never
    return {
      value: Object.keys(files)
        .filter(p => p.startsWith(`${dir}/`))
        .map(p => ({ name: p.slice(dir.length + 1), kind: 'file', size: files[p]?.length ?? 0 })),
    } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  return dir
}

const complete = (tokens: number, model: string) =>
  ({
    answer: 'ok',
    durationMs: 1000,
    isAborted: false,
    turnId: 't',
    reason: 'answer',
    usage: { input_tokens: tokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model },
  }) as never

test('daily aggregation sums two session files by day and model', () => {
  const k = lastDayKeys(NOW, 7)
  const today = k[6] as string
  const yesterday = k[5] as string
  const a = { name: 'proyecto-a', project: 'proyecto-a', days: { [today]: day(100, 50), [yesterday]: day(10) } }
  const b = { name: 'proyecto-b', project: 'proyecto-b', days: { [today]: day(0, 0, 300) } }
  const agg = aggregate([{ id: 'a', file: a }, { id: 'b', file: b }], NOW)
  expect(agg.perDay).toHaveLength(7)
  expect(agg.today).toMatchObject({ haiku: 100, sonnet: 50, opus: 300, total: 450 })
  expect(agg.week.total).toBe(460)
  expect(agg.perDay[5]?.total).toBe(10)
  expect(agg.sessions.map(s => s.name)).toEqual(['proyecto-b', 'proyecto-a'])
  expect(agg.sessions[0]).toMatchObject({ today: 300, week: 300, pct: 65 })
  expect(agg.sessions[1]).toMatchObject({ today: 150, week: 160, pct: 35 })
})

test('days older than 30 are trimmed and old files age out of the week', () => {
  const old = dayKey(NOW - 40 * DAY)
  const edge = dayKey(NOW - 29 * DAY)
  const gone = dayKey(NOW - 30 * DAY)
  const trimmed = trimDays({ [old]: day(1), [gone]: day(2), [edge]: day(3) }, NOW)
  expect(Object.keys(trimmed)).toEqual([edge])
  const added = addTokens({ [old]: day(5) }, NOW, 'opus', 40)
  expect(Object.keys(added)).toEqual([dayKey(NOW)])
  expect(added[dayKey(NOW)]).toMatchObject({ opus: 40, total: 40 })
  expect(addTokens({}, NOW, 'haiku', 0)).toEqual({})
  const agg = aggregate([{ id: 'x', file: { name: 'viejo', project: 'viejo', days: { [edge]: day(9) } } }], NOW)
  expect(agg.week.total).toBe(0)
  expect(agg.sessions).toEqual([])
})

test('percent, bar and threshold colors', () => {
  expect(pct(1, 4)).toBe(25)
  expect(pct(5, 0)).toBe(0)
  expect(pct(9, 4)).toBe(100)
  expect(levelColor(0, TH)).toBe('green')
  expect(levelColor(79.9, TH)).toBe('green')
  expect(levelColor(80, TH)).toBe('yellow')
  expect(levelColor(89, TH)).toBe('yellow')
  expect(levelColor(90, TH)).toBe('red')
  expect(levelColor(100, TH)).toBe('red')
  expect(levelColor(65, { warn: 60, critical: 70 })).toBe('yellow')
  expect(bar(50, 10)).toBe('█████░░░░░')
  expect(bar(0, 4)).toBe('░░░░')
  expect(bar(1, 10)).toBe('█░░░░░░░░░')
  expect(bar(150, 4)).toBe('████')
})

test('status text with and without limits', () => {
  expect(statusText([])).toBe('Router ●')
  expect(statusText([{ kind: 'five_hour', percentUsed: 34.4 }])).toBe('Router ● · 5h 34%')
  expect(statusText([{ kind: 'five_hour', percentUsed: 82 }])).toBe('Router ● · 5h 82% (alto)')
  expect(statusText([{ kind: 'five_hour', percentUsed: 96 }], false)).toBe('Router ○ pausado · 5h 96% (casi agotado)')
})

test('usage file parser rejects junk and sanitizes numbers', () => {
  expect(asUsageFile(undefined)).toBeUndefined()
  expect(asUsageFile({ days: 3 })).toBeUndefined()
  const f = asUsageFile({ name: 'x', project: 'p', days: { '2026-10-12': { haiku: 5, sonnet: -2, opus: 'a', other: 1, total: 0 }, bad: {} } })
  expect(f?.days).toEqual({ '2026-10-12': { haiku: 5, sonnet: 0, opus: 0, other: 1, total: 6 } })
})

test('usage panel with rateLimits, multi-session files and the usage command', async ($, on) => {
  mock.clock(on, { now: NOW })
  const k = lastDayKeys(NOW, 7)
  const files: Record<string, string> = {
    '/cfg/model-router/usage/sess-b.json': JSON.stringify({
      name: 'proyecto-b',
      project: 'proyecto-b',
      days: { [k[6] as string]: day(0, 0, 3000), [k[3] as string]: day(1000) },
    }),
  }
  const dir = fakeWorld(on, files)
  on('session.usage', () =>
    ({
      value: {
        startedAt: 0,
        context: { window: 200000, tokens: 80000, percent: 40 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 34, resetsAt: new Date(NOW + 2 * 3600 * 1000 + 10 * 60000).toISOString() },
          { kind: 'seven_day', percentUsed: 85 },
        ],
        cost: { usd: 1.5 },
      },
    }) as never,
  )
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)

  await $.turn.complete(complete(500, 'claude-haiku-4-5'))
  const own = JSON.parse(files[`${dir}/sess-a.json`] ?? '{}')
  expect(own.name).toBe('proyecto-a')
  expect(own.days[dayKey(NOW)]).toMatchObject({ haiku: 500, total: 500 })

  const out = await $.command.run({ command: 'model-router', args: 'usage' } as never)
  expect(out.text).toContain('Router ● Activo · Cuidado: Semana al 85 %')
  expect(out.text).toContain('Ventana de 5 h: 34 % · se reinicia en 2 h 10 min')
  expect(out.text).toContain('Ventana semanal: 85 % · ▲ aviso')
  expect(out.text).toContain('Alertas: activadas · aviso 80 % · crítico 90 %')
  expect(out.text).toContain('claude-haiku-4-5: entrada 500 · salida 0 · caché lectura 0 · caché escritura 0')
  expect(out.text).toContain('Pasa a modelos más baratos o espera al reinicio.')
  expect(out.text).toContain('Nada en curso.')
  expect(out.text).toContain('Hoy: 3,5 k tokens (Haiku 14 % · Opus 86 %)')
  expect(out.text).toContain('Últimos 7 días: 4,5 k tokens')
  expect(out.text).toContain('$1,50')
  expect(out.text).toContain('contexto al 40 %')
  expect(out.text).toContain('Sesión que más gasta: proyecto-b')

  const ui = await $.ui.mount(PANE)
  const text = linesOf(await ui.drawn()).join('\n')
  expect(text).toContain('Consumo')
  expect(text).toMatch(/Hoy .*3,5 k tokens.*7 días .*4,5 k tokens/)
  expect(text).toMatch(/Ventana de 5 h .*34 %.*se reinicia en 2 h 10 min/)
  expect(text).toMatch(/Ventana semanal .*85 %/)
  expect(text).not.toContain('Sin datos')
})

test('usage panel without rateLimits says there is no data', async ($, on) => {
  mock.clock(on, { now: NOW })
  fakeWorld(on, {})
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }) as never)
  const out = await $.command.run({ command: 'model-router', args: 'usage' } as never)
  expect(out.text).toContain('Ventana de 5 h: Sin dato')
  expect(out.text).toContain('Ventana semanal: Sin dato')
  const ui = await $.ui.mount(PANE)
  const text = linesOf(await ui.drawn()).join('\n')
  expect(text).toContain('Sin datos: los límites aparecen')
})

test('session.measure feeds the status line with the 5h window', async ($, on) => {
  mock.clock(on, { now: NOW })
  fakeWorld(on, {})
  const statuses: unknown[] = []
  on('ui.status', (_$, e) => {
    statuses.push((e as { text?: string }).text)
    return { value: undefined } as never
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }) as never)
  await $.session.measure({
    context: { window: 200000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 34.4 }],
    changed: ['rateLimits'],
  } as never)
  expect(statuses[statuses.length - 1]).toBe('Router ● · 5h 34%')
})

test('human formats: tokens, durations, resets, weekdays', () => {
  expect(fmtTokens(850)).toBe('850')
  expect(fmtTokens(3500)).toBe('3,5 k')
  expect(fmtTokens(48_200)).toBe('48 k')
  expect(fmtTokens(1_234_567)).toBe('1,2 M')
  expect(fmtTokens(2_000_000)).toBe('2 M')
  expect(fmtDur(1500)).toBe('1,5 s')
  expect(fmtDur(125_000)).toBe('2 min 05 s')
  expect(fmtDur(4_500_000)).toBe('1 h 15 min')
  const at = (ms: number) => new Date(NOW + ms).toISOString()
  expect(fmtReset(at(130 * 60000), NOW)).toBe('2 h 10 min')
  expect(fmtReset(at(45 * 60000), NOW)).toBe('45 min')
  expect(fmtReset(at(2 * 3600000), NOW)).toBe('2 h')
  expect(fmtReset(at(52 * 3600000), NOW)).toBe('2 d 4 h')
  expect(fmtReset(at(-1000), NOW)).toBe('')
  expect(fmtReset(undefined, NOW)).toBe('')
  expect(weekdayShort('2026-10-12')).toBe('Lun')
  expect(weekdayShort('2026-10-18')).toBe('Dom')
})

test('traffic light follows the worst plan limit', () => {
  expect(health([], TH).level).toBe('none')
  expect(health([{ kind: 'five_hour', percentUsed: 20 }], TH)).toMatchObject({ level: 'ok', color: 'green', text: 'Vas bien' })
  expect(health([{ kind: 'five_hour', percentUsed: 79 }], TH)).toMatchObject({ level: 'ok', color: 'green', text: 'Vas bien' })
  expect(health([{ kind: 'five_hour', percentUsed: 82 }, { kind: 'seven_day', percentUsed: 10 }], TH)).toMatchObject({ level: 'warn', color: 'yellow', text: 'Cuidado: 5 h al 82 %' })
  expect(health([{ kind: 'five_hour', percentUsed: 91 }], TH)).toMatchObject({ level: 'danger', color: 'red' })
  expect(health([{ kind: 'seven_day', percentUsed: 96 }], TH).text).toBe('Límite casi agotado: Semana al 96 %')
  expect(health([{ kind: 'seven_day', percentUsed: 100 }], TH).text).toBe('Límite alcanzado: Semana al 100 %')
  expect(health([{ kind: 'other_thing', percentUsed: 99 }], TH).level).toBe('none')
  expect(health([{ kind: 'five_hour', percentUsed: 55 }], { warn: 50, critical: 60 })).toMatchObject({ level: 'warn', text: 'Cuidado: 5 h al 55 %' })
  expect(health([{ kind: 'five_hour', percentUsed: 75 }], { warn: 50, critical: 60 }).level).toBe('danger')
})

test('stacked bar cells add up to the width and keep tiny shares visible', () => {
  expect(stackCells([0, 0, 0], 10)).toEqual([0, 0, 0])
  expect(stackCells([50, 50], 10)).toEqual([5, 5])
  const c = stackCells([1000, 1, 500], 20)
  expect(c.reduce((s, n) => s + n, 0)).toBe(20)
  expect(c[1]).toBeGreaterThanOrEqual(1)
  expect(stackCells([1, 1, 1], 10).reduce((s, n) => s + n, 0)).toBe(10)
})
