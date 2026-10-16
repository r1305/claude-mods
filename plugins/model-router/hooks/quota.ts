import type {
  ModelRouterAlertMemories,
  ModelRouterAlertMemory,
  ModelRouterModelTokens,
  ModelRouterModels,
  ModelRouterPrefs,
  ModelRouterWindowKind,
} from '../types'

export type Level = 'normal' | 'aviso' | 'critico'

export type Thresholds = { warn: number; critical: number }

export type Alert = { level: Exclude<Level, 'normal'>; threshold: number }

export type QuotaWindow = { percentUsed: number; resetsAt: string | null }

export type QuotaWindows = Record<ModelRouterWindowKind, QuotaWindow | null>

export type LimitRow = { kind: string; percentUsed: number; resetsAt?: string }

export type UsageCounts = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export type ModelRouterCommand =
  | { kind: 'show' }
  | { kind: 'toggle'; on: boolean }
  | { kind: 'usage' }
  | { kind: 'alerts'; on: boolean }
  | { kind: 'thresholds'; warn: number; critical: number }
  | { kind: 'error'; message: string }

export const WINDOWS: readonly ModelRouterWindowKind[] = ['five_hour', 'seven_day']

export const LABELS: Record<ModelRouterWindowKind, string> = {
  five_hour: 'Ventana de 5 h',
  seven_day: 'Ventana semanal',
}

export const DEFAULT_PREFS: ModelRouterPrefs = { alerts: true, warn: 80, critical: 90 }

export const PREFS_KEY = 'prefs'

export const NO_DATA = 'Sin dato'

export const LEVEL_MARK: Record<Level, string> = { normal: '●', aviso: '▲', critico: '■' }

export const LEVEL_NAME: Record<Level, string> = { normal: 'normal', aviso: 'aviso', critico: 'crítico' }

export const COMMAND_USAGE =
  '/model-router usage | /model-router alerts on|off | /model-router umbrales <aviso> <crítico> | /quota (alias de usage)'

const isWindowKind = (kind: string): kind is ModelRouterWindowKind => kind === 'five_hour' || kind === 'seven_day'

const isThreshold = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100

export const emptyWindows = (): QuotaWindows => ({ five_hour: null, seven_day: null })

export const emptyMemory = (): ModelRouterAlertMemory => ({ resetsAt: null, lastPercent: 0, fired: [] })

export const emptyMemories = (): ModelRouterAlertMemories => ({ five_hour: emptyMemory(), seven_day: emptyMemory() })

export function windowsOf(rows: readonly LimitRow[]): QuotaWindows {
  const out = emptyWindows()
  for (const row of rows) {
    if (!isWindowKind(row.kind)) continue
    if (typeof row.percentUsed !== 'number' || !Number.isFinite(row.percentUsed)) continue
    out[row.kind] = { percentUsed: row.percentUsed, resetsAt: typeof row.resetsAt === 'string' ? row.resetsAt : null }
  }
  return out
}

export function parsePrefs(raw: unknown): ModelRouterPrefs {
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

/** The one traffic light: normal below the aviso threshold, aviso from it, crítico from the critical one. */
export function levelOf(percent: number, th: Thresholds): Level {
  const shown = shownPercent(percent)
  if (shown >= th.critical) return 'critico'
  if (shown >= th.warn) return 'aviso'
  return 'normal'
}

/**
 * One alert per threshold and per window cycle. The cycle restarts when the reset time
 * changes or the figure drops. A threshold passed while alerts are hidden is still marked.
 */
export function evaluateAlerts(
  memory: ModelRouterAlertMemory,
  window: QuotaWindow | null,
  prefs: ModelRouterPrefs,
): { memory: ModelRouterAlertMemory; alert?: Alert } {
  if (window === null) return { memory }
  const windowChanged = memory.resetsAt !== window.resetsAt || window.percentUsed < memory.lastPercent
  const base: ModelRouterAlertMemory = windowChanged
    ? { resetsAt: window.resetsAt, lastPercent: window.percentUsed, fired: [] }
    : { ...memory, lastPercent: window.percentUsed }
  const shown = shownPercent(window.percentUsed)
  const crossed = [prefs.warn, prefs.critical].filter(threshold => shown >= threshold && !base.fired.includes(threshold))
  if (crossed.length === 0) return { memory: base }
  const next: ModelRouterAlertMemory = { ...base, fired: [...base.fired, ...crossed] }
  if (!prefs.alerts) return { memory: next }
  const top = Math.max(...crossed)
  return { memory: next, alert: { level: top === prefs.critical ? 'critico' : 'aviso', threshold: top } }
}

export function formatPercent(percent: number): string {
  return `${shownPercent(percent)} %`
}

/** Local clock of a reset time: HH:MM, or dd/mm HH:MM for the weekly window. */
export function formatClock(iso: string | null, withDate = false): string {
  if (iso === null) return NO_DATA
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return NO_DATA
  const pad = (n: number) => String(n).padStart(2, '0')
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  return withDate ? `${pad(at.getDate())}/${pad(at.getMonth() + 1)} ${clock}` : clock
}

export const resetHasDate = (kind: ModelRouterWindowKind): boolean => kind === 'seven_day'

export function alertsLine(prefs: ModelRouterPrefs): string {
  return `Alertas: ${prefs.alerts ? 'activadas' : 'ocultas'} · aviso ${prefs.warn} % · crítico ${prefs.critical} %`
}

export function alertText(kind: ModelRouterWindowKind, alert: Alert, window: QuotaWindow): string {
  const word = alert.level === 'critico' ? 'Crítico' : 'Aviso'
  const reset = window.resetsAt === null ? '' : `. Reinicia ${formatClock(window.resetsAt, resetHasDate(kind))}`
  return `${word}: ${LABELS[kind]} al ${formatPercent(window.percentUsed)} (umbral ${alert.threshold} %)${reset}`
}

export function windowLine(kind: ModelRouterWindowKind, window: QuotaWindow | null, th: Thresholds): string {
  if (window === null) return `${LABELS[kind]}: ${NO_DATA}`
  const reset = window.resetsAt === null ? '' : ` · reinicia ${formatClock(window.resetsAt, resetHasDate(kind))}`
  const level = levelOf(window.percentUsed, th)
  const tag = level === 'normal' ? '' : ` · ${LEVEL_NAME[level]}`
  return `${LABELS[kind]}: ${formatPercent(window.percentUsed)}${reset}${tag}`
}

export function formatCount(count: number): string {
  return String(Math.round(count)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export const totalTokensOf = (row: ModelRouterModelTokens): number => row.input + row.output + row.cacheRead + row.cacheWrite

/** Exact model name, breakdown kept: input, output, cache read and cache write apart. */
export function modelRowText(row: ModelRouterModelTokens): string {
  return `entrada ${formatCount(row.input)} · salida ${formatCount(row.output)} · caché lectura ${formatCount(row.cacheRead)} · caché escritura ${formatCount(row.cacheWrite)}`
}

export function addUsage(models: ModelRouterModels, model: string, usage: UsageCounts): ModelRouterModels {
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

export function totalsOf(models: ModelRouterModels): ModelRouterModelTokens {
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

export function parseCommand(args: string): ModelRouterCommand {
  const words = args.trim().toLowerCase().split(/\s+/).filter(word => word !== '')
  const [head, ...rest] = words
  if (head === undefined) return { kind: 'show' }
  if ((head === 'on' || head === 'off') && rest.length === 0) return { kind: 'toggle', on: head === 'on' }
  if (head === 'usage') return { kind: 'usage' }
  if (head === 'alerts') {
    if (rest.length === 1 && (rest[0] === 'on' || rest[0] === 'off')) return { kind: 'alerts', on: rest[0] === 'on' }
    return { kind: 'error', message: `Uso: ${COMMAND_USAGE}` }
  }
  if (head === 'umbrales') {
    const warn = Number(rest[0])
    const critical = Number(rest[1])
    if (rest.length === 2 && isThreshold(warn) && isThreshold(critical) && warn < critical) {
      return { kind: 'thresholds', warn, critical }
    }
    return { kind: 'error', message: `Uso: ${COMMAND_USAGE}. Enteros de 1 a 100, aviso menor que crítico.` }
  }
  return { kind: 'show' }
}
