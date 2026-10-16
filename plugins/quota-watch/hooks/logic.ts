import type { QuotaAlertMemories, QuotaAlertMemory, QuotaModels, QuotaPrefs, QuotaWindow, QuotaWindowKind, QuotaWindows } from '../types'

export type Level = 'normal' | 'aviso' | 'critico'

export type Alert = {
  level: Exclude<Level, 'normal'>
  threshold: number
}

export type RateLimitRow = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

export type UsageCounts = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export type QuotaCommand =
  | { kind: 'show' }
  | { kind: 'alerts'; on: boolean }
  | { kind: 'thresholds'; warn: number; critical: number }
  | { kind: 'error'; message: string }

export const WINDOWS: readonly QuotaWindowKind[] = ['five_hour', 'seven_day']

export const LABELS: Record<QuotaWindowKind, string> = {
  five_hour: 'Ventana de 5 h',
  seven_day: 'Ventana semanal',
}

export const DEFAULT_PREFS: QuotaPrefs = { alerts: true, warn: 80, critical: 90 }

export const PREFS_KEY = 'prefs'

export const NO_DATA = 'Sin dato'

export const USAGE = '/quota | /quota alerts on|off | /quota umbrales <aviso> <crítico>'

export const emptyWindows = (): QuotaWindows => ({ five_hour: null, seven_day: null })

export const emptyMemory = (): QuotaAlertMemory => ({ resetsAt: null, lastPercent: 0, fired: [] })

export const emptyMemories = (): QuotaAlertMemories => ({ five_hour: emptyMemory(), seven_day: emptyMemory() })

const isWindowKind = (kind: string): kind is QuotaWindowKind => kind === 'five_hour' || kind === 'seven_day'

const isThreshold = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100

export function windowsOf(rows: readonly RateLimitRow[]): QuotaWindows {
  const out = emptyWindows()
  for (const row of rows) {
    if (!isWindowKind(row.kind)) continue
    if (typeof row.percentUsed !== 'number' || !Number.isFinite(row.percentUsed)) continue
    out[row.kind] = { percentUsed: row.percentUsed, resetsAt: typeof row.resetsAt === 'string' ? row.resetsAt : null }
  }
  return out
}

export function parsePrefs(raw: unknown): QuotaPrefs {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFS
  const row = raw as Record<string, unknown>
  const alerts = typeof row.alerts === 'boolean' ? row.alerts : DEFAULT_PREFS.alerts
  const warn = isThreshold(row.warn) ? row.warn : DEFAULT_PREFS.warn
  const critical = isThreshold(row.critical) ? row.critical : DEFAULT_PREFS.critical
  if (warn >= critical) return { alerts, warn: DEFAULT_PREFS.warn, critical: DEFAULT_PREFS.critical }
  return { alerts, warn, critical }
}

export function shownPercent(percent: number): number {
  return Math.round(percent * 10) / 10
}

export function levelOf(percent: number, prefs: QuotaPrefs): Level {
  const shown = shownPercent(percent)
  if (shown >= prefs.critical) return 'critico'
  if (shown >= prefs.warn) return 'aviso'
  return 'normal'
}

export function evaluateAlerts(
  memory: QuotaAlertMemory,
  window: QuotaWindow | null,
  prefs: QuotaPrefs,
): { memory: QuotaAlertMemory; alert?: Alert } {
  if (window === null) return { memory }
  const windowChanged = memory.resetsAt !== window.resetsAt || window.percentUsed < memory.lastPercent
  const base: QuotaAlertMemory = windowChanged
    ? { resetsAt: window.resetsAt, lastPercent: window.percentUsed, fired: [] }
    : { ...memory, lastPercent: window.percentUsed }
  const shown = shownPercent(window.percentUsed)
  const crossed = [prefs.warn, prefs.critical].filter(threshold => shown >= threshold && !base.fired.includes(threshold))
  if (crossed.length === 0) return { memory: base }
  const next: QuotaAlertMemory = { ...base, fired: [...base.fired, ...crossed] }
  if (!prefs.alerts) return { memory: next }
  const top = Math.max(...crossed)
  return { memory: next, alert: { level: top === prefs.critical ? 'critico' : 'aviso', threshold: top } }
}

export function formatPercent(percent: number): string {
  return `${shownPercent(percent)} %`
}

export function formatReset(iso: string | null): string {
  if (iso === null) return NO_DATA
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return NO_DATA
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(at.getDate())}/${pad(at.getMonth() + 1)} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

export function alertText(kind: QuotaWindowKind, alert: Alert, window: QuotaWindow): string {
  const word = alert.level === 'critico' ? 'Crítico' : 'Aviso'
  const reset = window.resetsAt === null ? '' : `. Reinicia ${formatReset(window.resetsAt)}`
  return `${word}: ${LABELS[kind]} al ${formatPercent(window.percentUsed)} (umbral ${alert.threshold} %)${reset}`
}

const levelTag = (level: Level): string => (level === 'aviso' ? ' · aviso' : level === 'critico' ? ' · crítico' : '')

export function windowLine(kind: QuotaWindowKind, window: QuotaWindow | null, prefs: QuotaPrefs): string {
  if (window === null) return `${LABELS[kind]}: ${NO_DATA}`
  const reset = window.resetsAt === null ? '' : ` · reinicia ${formatReset(window.resetsAt)}`
  return `${LABELS[kind]}: ${formatPercent(window.percentUsed)}${reset}${levelTag(levelOf(window.percentUsed, prefs))}`
}

export function formatCount(count: number): string {
  return String(Math.round(count)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function addUsage(models: QuotaModels, model: string, usage: UsageCounts): QuotaModels {
  const key = model === '' ? 'desconocido' : model
  const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const prev = models[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  return {
    ...models,
    [key]: {
      input: prev.input + count(usage.input_tokens),
      output: prev.output + count(usage.output_tokens),
      cacheRead: prev.cacheRead + count(usage.cache_read_input_tokens),
      cacheWrite: prev.cacheWrite + count(usage.cache_creation_input_tokens),
    },
  }
}

export function totalsOf(models: QuotaModels): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  return Object.values(models).reduce(
    (sum, row) => ({
      input: sum.input + row.input,
      output: sum.output + row.output,
      cacheRead: sum.cacheRead + row.cacheRead,
      cacheWrite: sum.cacheWrite + row.cacheWrite,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  )
}

export function modelsLine(models: QuotaModels): string {
  if (Object.keys(models).length === 0) return NO_DATA
  const totals = totalsOf(models)
  return `entrada ${formatCount(totals.input)} · salida ${formatCount(totals.output)}`
}

export function modelsReport(models: QuotaModels): string[] {
  const names = Object.keys(models).sort()
  if (names.length === 0) return [`Tokens por modelo en esta sesión: ${NO_DATA}`]
  const rows = names.map(name => {
    const row = models[name] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    return `${name}: entrada ${formatCount(row.input)} · salida ${formatCount(row.output)} · caché lectura ${formatCount(row.cacheRead)} · caché escritura ${formatCount(row.cacheWrite)}`
  })
  const totals = totalsOf(models)
  return [
    'Tokens por modelo en esta sesión',
    ...rows,
    `Total: entrada ${formatCount(totals.input)} · salida ${formatCount(totals.output)} · caché lectura ${formatCount(totals.cacheRead)} · caché escritura ${formatCount(totals.cacheWrite)}`,
  ]
}

export function quotaReport(windows: QuotaWindows, models: QuotaModels, prefs: QuotaPrefs): string {
  return [
    'Cuotas del plan',
    ...WINDOWS.map(kind => windowLine(kind, windows[kind], prefs)),
    `Alertas: ${prefs.alerts ? 'activadas' : 'ocultas'} (aviso ${prefs.warn} %, crítico ${prefs.critical} %)`,
    '',
    ...modelsReport(models),
    '',
    `Uso: ${USAGE}`,
  ].join('\n')
}

export function parseCommand(args: string): QuotaCommand {
  const words = args.trim().toLowerCase().split(/\s+/).filter(word => word !== '')
  if (words.length === 0) return { kind: 'show' }
  const [head, ...rest] = words
  if (head === 'alerts' && rest.length === 1 && (rest[0] === 'on' || rest[0] === 'off')) {
    return { kind: 'alerts', on: rest[0] === 'on' }
  }
  if (head === 'umbrales' && rest.length === 2) {
    const warn = Number(rest[0])
    const critical = Number(rest[1])
    if (isThreshold(warn) && isThreshold(critical) && warn < critical) return { kind: 'thresholds', warn, critical }
  }
  return { kind: 'error', message: `Uso: ${USAGE}` }
}
