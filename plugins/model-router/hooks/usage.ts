import type {
  ModelRouterBucket,
  ModelRouterDay,
  ModelRouterLimit,
  ModelRouterLevel,
  ModelRouterModels,
  ModelRouterPrefs,
  ModelRouterTask,
  ModelRouterSessionTokens,
  ModelRouterUsageFile,
} from '../types'
import {
  DEFAULT_PREFS,
  LABELS,
  LEVEL_MARK,
  LEVEL_NAME,
  NO_DATA,
  WINDOWS,
  alertsLine,
  levelOf,
  modelRowText,
  totalTokensOf,
  totalsOf as totalsOfModels,
} from './quota'
import type { Thresholds } from './quota'

export const BUCKETS: ModelRouterBucket[] = ['haiku', 'sonnet', 'opus', 'other']
export const KEEP_DAYS = 30
export const WEEK_DAYS = 7
export const FLUSH_MS = 30_000

export const emptyDay = (): ModelRouterDay => ({ haiku: 0, sonnet: 0, opus: 0, other: 0, total: 0 })

export const emptyTokens = (): ModelRouterSessionTokens => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  byModel: { haiku: 0, sonnet: 0, opus: 0, other: 0 },
})

const pad = (n: number) => String(n).padStart(2, '0')

/** Local calendar day, YYYY-MM-DD. */
export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const shiftDays = (ms: number, k: number) => {
  const d = new Date(ms)
  d.setDate(d.getDate() + k)
  return d.getTime()
}

/** The last `n` local day keys, oldest first, ending today. */
export const lastDayKeys = (now: number, n: number) =>
  Array.from({ length: n }, (_, i) => dayKey(shiftDays(now, i - (n - 1))))

export const bucketOf = (model: string | undefined): ModelRouterBucket => {
  const m = (model ?? '').toLowerCase()
  const level: ModelRouterLevel | undefined = (['haiku', 'sonnet', 'opus'] as const).find(l => m.includes(l))
  return level ?? 'other'
}

/** Drops every day older than the last KEEP_DAYS (today included). */
export const trimDays = (days: Record<string, ModelRouterDay>, now: number) => {
  const oldest = lastDayKeys(now, KEEP_DAYS)[0] ?? ''
  const out: Record<string, ModelRouterDay> = {}
  for (const [k, v] of Object.entries(days)) if (k >= oldest) out[k] = v
  return out
}

export const addTokens = (
  days: Record<string, ModelRouterDay>,
  now: number,
  bucket: ModelRouterBucket,
  n: number,
) => {
  if (!(n > 0)) return days
  const key = dayKey(now)
  const cur = days[key] ?? emptyDay()
  return trimDays({ ...days, [key]: { ...cur, [bucket]: cur[bucket] + n, total: cur.total + n } }, now)
}

/** Per-day, per-field max: how a session reloads its own file without losing counts. */
export const mergeDays = (a: Record<string, ModelRouterDay>, b: Record<string, ModelRouterDay>) => {
  const out: Record<string, ModelRouterDay> = { ...a }
  for (const [k, v] of Object.entries(b)) {
    const o = out[k]
    out[k] = o
      ? {
          haiku: Math.max(o.haiku, v.haiku),
          sonnet: Math.max(o.sonnet, v.sonnet),
          opus: Math.max(o.opus, v.opus),
          other: Math.max(o.other, v.other),
          total: Math.max(o.total, v.total),
        }
      : v
  }
  return out
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

export const parseJson = (text: string): unknown => {
  try {
    return text.trim() === '' ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}

export const asUsageFile = (v: unknown): ModelRouterUsageFile | undefined => {
  if (typeof v !== 'object' || v === null) return undefined
  const o = v as Record<string, unknown>
  if (typeof o.days !== 'object' || o.days === null) return undefined
  const days: Record<string, ModelRouterDay> = {}
  for (const [k, raw] of Object.entries(o.days as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || typeof raw !== 'object' || raw === null) continue
    const d = raw as Record<string, unknown>
    const day = { haiku: num(d.haiku), sonnet: num(d.sonnet), opus: num(d.opus), other: num(d.other), total: 0 }
    day.total = Math.max(num(d.total), day.haiku + day.sonnet + day.opus + day.other)
    days[k] = day
  }
  return {
    name: typeof o.name === 'string' ? o.name : '',
    project: typeof o.project === 'string' ? o.project : '',
    days,
  }
}

export type SessionRow = { id: string; name: string; today: number; week: number; pct: number }
export type DayRow = ModelRouterDay & { key: string }
export type Aggregate = {
  perDay: DayRow[]
  today: ModelRouterDay
  week: ModelRouterDay
  sessions: SessionRow[]
}

const sumDays = (rows: ModelRouterDay[]) => {
  const out = emptyDay()
  for (const r of rows) {
    for (const b of BUCKETS) out[b] += r[b]
    out.total += r.total
  }
  return out
}

export type SessionFile = { id: string; file: ModelRouterUsageFile }

/** Sums every session's file: the last 7 days by day and model, today, and per session. */
export const aggregate = (files: SessionFile[], now: number): Aggregate => {
  const keys = lastDayKeys(now, WEEK_DAYS)
  const today = keys[keys.length - 1] ?? dayKey(now)
  const perDay: DayRow[] = keys.map(key => ({
    key,
    ...sumDays(files.map(f => f.file.days[key]).filter((d): d is ModelRouterDay => d !== undefined)),
  }))
  const weekTotal = perDay.reduce((s, d) => s + d.total, 0)
  const raw = files
    .map(f => ({
      id: f.id,
      name: f.file.name || f.file.project || f.id.slice(0, 6),
      today: f.file.days[today]?.total ?? 0,
      week: keys.reduce((s, k) => s + (f.file.days[k]?.total ?? 0), 0),
    }))
    .filter(r => r.week > 0)
    .sort((a, b) => b.week - a.week)
  const counts = new Map<string, number>()
  for (const r of raw) counts.set(r.name, (counts.get(r.name) ?? 0) + 1)
  const sessions = raw.map(r => ({
    ...r,
    name: (counts.get(r.name) ?? 0) > 1 ? `${r.name} #${r.id.slice(0, 4)}` : r.name,
    pct: pct(r.week, weekTotal),
  }))
  return { perDay, today: perDay[perDay.length - 1] ?? emptyDay(), week: sumDays(perDay), sessions }
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export const pct = (part: number, whole: number) => (whole > 0 ? clamp(Math.round((part / whole) * 100), 0, 100) : 0)

/** The traffic light colour of a figure: green normal, yellow aviso, red crítico. */
export const levelColor = (p: number, th: Thresholds) => {
  const lvl = levelOf(p, th)
  return lvl === 'critico' ? 'red' : lvl === 'aviso' ? 'yellow' : 'green'
}

export const bar = (p: number, width: number, fill = '█', empty = '░') => {
  const w = Math.max(1, Math.floor(width))
  const v = clamp(p, 0, 100)
  const filled = v > 0 ? clamp(Math.round((v / 100) * w), 1, w) : 0
  return fill.repeat(filled) + empty.repeat(w - filled)
}

/** Spanish decimal: one decimal at most, comma separator, no trailing ",0". */
export const es = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',')

/** "850", "3,5 k", "48 k", "1,2 M". */
export const fmtTokens = (n: number) => {
  if (n >= 999_500) return `${es(n / 1_000_000)} M`
  if (n >= 10_000) return `${Math.round(n / 1000)} k`
  if (n >= 1000) return `${es(n / 1000)} k`
  return String(Math.round(n))
}

export const fmtTokensLong = (n: number) => `${fmtTokens(n)} tokens`

export const fmtPct = (p: number) => `${Math.round(p)} %`

export const fmtUsd = (usd: number) => `$${usd.toFixed(2).replace('.', ',')}`

/** "1,5 s", "2 min 05 s", "1 h 20 min". */
export const fmtDur = (ms: number) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${es(ms / 1000)} s`
  if (s < 3600) return `${Math.floor(s / 60)} min ${pad(s % 60)} s`
  return `${Math.floor(s / 3600)} h ${pad(Math.floor((s % 3600) / 60))} min`
}

/** Time until `resetsAt` ("45 min", "2 h 10 min", "3 d 4 h"); '' when absent, unparsable or past. */
export const fmtReset = (resetsAt: string | undefined, now: number) => {
  const t = resetsAt === undefined ? NaN : Date.parse(resetsAt)
  if (!Number.isFinite(t) || t <= now) return ''
  const min = Math.max(1, Math.round((t - now) / 60000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return min % 60 === 0 ? `${h} h` : `${h} h ${min % 60} min`
  return h % 24 === 0 ? `${Math.floor(h / 24)} d` : `${Math.floor(h / 24)} d ${h % 24} h`
}

/** "45m", "2h10", "3d4h": compact time until `resetsAt`; '' when absent, unparsable or past. */
export const fmtResetTiny = (resetsAt: string | undefined, now: number) => {
  const t = resetsAt === undefined ? NaN : Date.parse(resetsAt)
  if (!Number.isFinite(t) || t <= now) return ''
  const min = Math.max(1, Math.round((t - now) / 60000))
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return min % 60 === 0 ? `${h}h` : `${h}h${pad(min % 60)}`
  return h % 24 === 0 ? `${Math.floor(h / 24)}d` : `${Math.floor(h / 24)}d${h % 24}h`
}

/** "850", "3,5k", "48k", "1,2M": tokens for very narrow rows. */
export const fmtTokensTiny = (n: number) => {
  if (n >= 999_500) return `${es(n / 1_000_000)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${es(n / 1000)}k`
  return String(Math.round(n))
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const PLAN_KINDS = ['five_hour', 'seven_day', 'spend_limit']

export const limitLabel = (kind: string) =>
  kind === 'five_hour' ? LABELS.five_hour : kind === 'seven_day' ? LABELS.seven_day : kind === 'spend_limit' ? 'Gasto extra' : kind

export const limitShort = (kind: string) =>
  kind === 'five_hour' ? '5 h' : kind === 'seven_day' ? 'Semana' : kind === 'spend_limit' ? 'Gasto extra' : kind

export const limitTiny = (kind: string) =>
  kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind === 'spend_limit' ? 'Extra' : kind

/** The limits the panel shows, in a fixed order. */
export const planLimits = (limits: readonly ModelRouterLimit[]) =>
  PLAN_KINDS.flatMap(k => limits.filter(l => l.kind === k))

export const findLimit = (limits: readonly ModelRouterLimit[], kind: string) => limits.find(l => l.kind === kind)

export const HELP_HIGH = 'Pasa a modelos más baratos o espera al reinicio.'

export type Health = {
  level: 'none' | 'ok' | 'warn' | 'danger'
  color: string
  text: string
  /** the worst limit, when there is one */
  worst?: ModelRouterLimit
}

/** The one traffic light, from the worst plan limit and the configurable thresholds. */
export const health = (limits: readonly ModelRouterLimit[], th: Thresholds): Health => {
  const rel = planLimits(limits)
  const first = rel[0]
  if (first === undefined) return { level: 'none', color: 'gray', text: 'Sin datos de límites' }
  const worst = rel.reduce((a, b) => (b.percentUsed > a.percentUsed ? b : a), first)
  const p = Math.round(worst.percentUsed)
  const name = limitShort(worst.kind)
  const lvl = levelOf(worst.percentUsed, th)
  if (p >= 100) return { level: 'danger', color: 'red', text: `Límite alcanzado: ${name} al ${p} %`, worst }
  if (lvl === 'critico') return { level: 'danger', color: 'red', text: `Límite casi agotado: ${name} al ${p} %`, worst }
  if (lvl === 'aviso') return { level: 'warn', color: 'yellow', text: `Cuidado: ${name} al ${p} %`, worst }
  return { level: 'ok', color: 'green', text: 'Vas bien', worst }
}

/** Very short traffic-light text: "Vas bien", "Cuidado 5h 82%". */
export const healthShort = (h: Health) => {
  if (h.level === 'none') return 'Sin datos de límites'
  const w = h.worst
  if (!w) return h.text
  const p = Math.round(w.percentUsed)
  const n = limitTiny(w.kind)
  if (p >= 100) return `Límite ${n} ${p}%`
  if (h.level === 'danger') return `Casi agotado ${n} ${p}%`
  if (h.level === 'warn') return `Cuidado ${n} ${p}%`
  return 'Vas bien'
}

export const MODEL_LETTER: Record<ModelRouterBucket, string> = { haiku: 'H', sonnet: 'S', opus: 'O', other: 'X' }

export const MODEL_COLOR: Record<ModelRouterBucket, string> = {
  haiku: 'green',
  sonnet: 'blue',
  opus: 'magenta',
  other: 'gray',
}

export const MODEL_NAME: Record<ModelRouterBucket, string> = {
  haiku: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
  other: 'Otros',
}

export const isEmoji = (surface: string | undefined) => surface !== undefined && surface !== 'terminal'

export const icons = (surface: string | undefined) =>
  isEmoji(surface)
    ? {
        haiku: '🟢',
        sonnet: '🔵',
        opus: '🟣',
        other: '⚪',
        running: '⏳',
        done: '✅',
        error: '❌',
        ok: '🟢',
        warn: '🟡',
        danger: '🔴',
        none: '⚪',
      }
    : {
        haiku: '●',
        sonnet: '●',
        opus: '●',
        other: '○',
        running: '»',
        done: '✓',
        error: '✗',
        ok: '●',
        warn: '●',
        danger: '●',
        none: '○',
      }

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

/** "Lun", "Mar"... for a YYYY-MM-DD local day key. */
export const weekdayShort = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return WEEKDAYS[new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay()] ?? key.slice(5)
}

/** Splits `width` cells among `values` (largest remainder); every non-zero value gets at least one. */
export const stackCells = (values: readonly number[], width: number) => {
  const w = Math.max(1, Math.floor(width))
  const total = values.reduce((s, v) => s + Math.max(0, v), 0)
  if (total <= 0) return values.map(() => 0)
  const raw = values.map(v => (Math.max(0, v) / total) * w)
  const cells = raw.map((r, i) => ((values[i] ?? 0) > 0 ? Math.max(1, Math.floor(r)) : 0))
  let diff = w - cells.reduce((s, c) => s + c, 0)
  const order = raw
    .map((r, i) => ({ i, f: r - Math.floor(r) }))
    .filter(x => (values[x.i] ?? 0) > 0)
    .sort((a, b) => b.f - a.f)
  for (let k = 0; diff > 0 && order.length > 0; k++, diff--) {
    const t = order[k % order.length]
    if (t) cells[t.i] = (cells[t.i] ?? 0) + 1
  }
  while (diff < 0) {
    let big = 0
    cells.forEach((c, i) => {
      if (c > (cells[big] ?? 0)) big = i
    })
    if ((cells[big] ?? 0) <= 1) break
    cells[big] = (cells[big] ?? 0) - 1
    diff++
  }
  return cells
}

const SPARK = '▁▂▃▄▅▆▇█'

/** One cell per value, scaled to the largest; '_' for zero. */
export const spark = (values: readonly number[]) => {
  const max = Math.max(1, ...values)
  return values.map(v => (v <= 0 ? '_' : (SPARK[clamp(Math.ceil((v / max) * 8) - 1, 0, 7)] ?? '▁')))
}

/** Status line: `Router ● · 5h 34%`; the router mark is ○ when paused. Running agents are savvy-progress's to show. */
export const statusText = (
  limits: readonly ModelRouterLimit[],
  enabled = true,
  th: Thresholds = DEFAULT_PREFS,
) => {
  const parts: string[] = [enabled ? 'Router ●' : 'Router ○ pausado']
  const five = findLimit(limits, 'five_hour')
  if (five) {
    const p = Math.round(five.percentUsed)
    const lvl = levelOf(five.percentUsed, th)
    parts.push(`5h ${p}%${lvl === 'critico' ? ' (casi agotado)' : lvl === 'aviso' ? ' (alto)' : ''}`)
  }
  return parts.join(' · ')
}

/** Session tokens by model family (for the family split) and totals, from the per-model accumulator. */
export const sessionOf = (models: ModelRouterModels): ModelRouterSessionTokens => {
  const out = emptyTokens()
  for (const [name, row] of Object.entries(models)) {
    out.input += row.input
    out.output += row.output
    out.cacheRead += row.cacheRead
    out.cacheWrite += row.cacheWrite
    out.byModel[bucketOf(name)] += totalTokensOf(row)
  }
  return out
}

/** Session tokens per exact model name, largest first, with its family. */
export const modelRows = (models: ModelRouterModels) =>
  Object.entries(models)
    .map(([name, row]) => ({ name, b: bucketOf(name), total: totalTokensOf(row), ...row }))
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total)

export type TextSummaryInput = {
  agg: Aggregate
  limits: readonly ModelRouterLimit[]
  now: number
  sessionTotal: number
  cost: number | null
  contextPercent?: number
  enabled?: boolean
  running?: readonly ModelRouterTask[]
  sessionByModel?: Record<ModelRouterBucket, number>
  models: ModelRouterModels
  prefs: ModelRouterPrefs
  routeNote?: string
}

const limitRowText = (l: ModelRouterLimit, now: number, th: Thresholds) => {
  const r = fmtReset(l.resetsAt, now)
  const lvl = levelOf(l.percentUsed, th)
  return `  ${limitLabel(l.kind)}: ${fmtPct(l.percentUsed)}${r !== '' ? ` · se reinicia en ${r}` : ''} · ${LEVEL_MARK[lvl]} ${LEVEL_NAME[lvl]}`
}

const split = (d: Record<ModelRouterBucket, number>, total: number) =>
  BUCKETS.filter(b => d[b] > 0)
    .map(b => `${MODEL_NAME[b]} ${fmtPct(pct(d[b], total))}`)
    .join(' · ')

/** Plain-text summary for `/model-router usage`, same order and words as the panel. */
export const textSummary = (i: TextSummaryInput) => {
  const th = i.prefs
  const h = health(i.limits, th)
  const lines: string[] = []
  lines.push(`Router ${i.enabled === false ? '○ Pausado' : '● Activo'} · ${h.text}`)
  if (i.enabled !== false && i.routeNote !== undefined) lines.push(`Enrutado: ${i.routeNote}`)
  lines.push('')
  lines.push('LÍMITES DE TU PLAN')
  for (const kind of WINDOWS) {
    const l = findLimit(i.limits, kind)
    if (l === undefined) {
      lines.push(`  ${LABELS[kind]}: ${NO_DATA}`)
      continue
    }
    lines.push(limitRowText(l, i.now, th))
  }
  for (const l of i.limits.filter(x => x.kind === 'spend_limit')) lines.push(limitRowText(l, i.now, th))
  lines.push(`  ${alertsLine(th)}`)
  if (planLimits(i.limits).some(l => l.percentUsed >= th.warn)) lines.push(`  ${HELP_HIGH}`)
  lines.push('')
  lines.push('AHORA MISMO')
  const running = i.running ?? []
  if (running.length === 0) lines.push('  Nada en curso.')
  for (const t of running.slice(0, 6)) {
    lines.push(`  ${MODEL_NAME[t.model]} · ${t.description || '(sin descripción)'} · ${fmtDur(Math.max(0, i.now - t.startedAt))}`)
  }
  if (running.length > 6) lines.push(`  … y ${running.length - 6} más`)
  lines.push('')
  lines.push('ESTA SESIÓN')
  const by = i.sessionByModel
  lines.push(
    `  ${fmtTokensLong(i.sessionTotal)}${by && i.sessionTotal > 0 ? ` (${split(by, i.sessionTotal)})` : ''}${
      i.cost !== null ? ` · ${fmtUsd(i.cost)}` : ''
    }${i.contextPercent !== undefined ? ` · contexto al ${fmtPct(i.contextPercent)}` : ''}`,
  )
  lines.push('')
  lines.push('TOKENS POR MODELO (esta sesión)')
  const names = Object.keys(i.models).sort()
  if (names.length === 0) lines.push(`  ${NO_DATA}: aún no hay turnos completados en esta sesión.`)
  for (const name of names) {
    const r = i.models[name]
    if (r !== undefined) lines.push(`  ${name}: ${modelRowText(r)}`)
  }
  if (names.length > 0) lines.push(`  Total: ${modelRowText(totalsOfModels(i.models))}`)
  lines.push('')
  lines.push('CONSUMO (todas las sesiones con model-router)')
  const row = (label: string, d: ModelRouterDay) =>
    `  ${label}: ${fmtTokensLong(d.total)}${d.total > 0 ? ` (${split(d, d.total)})` : ''}`
  lines.push(row('Hoy', i.agg.today))
  lines.push(row('Últimos 7 días', i.agg.week))
  const top = i.agg.sessions[0]
  if (top) lines.push(`  Sesión que más gasta: ${top.name} (${fmtPct(top.pct)})`)
  lines.push('')
  lines.push('Los % de límites son los oficiales de tu cuenta; los tokens son los que contó este mod (las sesiones sin model-router no aparecen).')
  return lines.join('\n')
}
