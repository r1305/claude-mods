/** Ventana de cuota del plan que el motor informa: la de 5 h o la semanal. */
export type QuotaWindowKind = 'five_hour' | 'seven_day'

/** Una ventana con dato real: porcentaje usado (0 a 100) y hora de reinicio ISO, o null si el motor no la da. */
export type QuotaWindow = {
  percentUsed: number
  resetsAt: string | null
}

/** Las dos ventanas; null cuando el motor no tiene lectura (se muestra «Sin dato»). */
export type QuotaWindows = Record<QuotaWindowKind, QuotaWindow | null>

/** Preferencias: alertas visibles o no, y los dos umbrales en porcentaje. */
export type QuotaPrefs = {
  alerts: boolean
  warn: number
  critical: number
}

/** Memoria de alertas de una ventana: umbrales ya avisados en su ciclo y último porcentaje visto. */
export type QuotaAlertMemory = {
  resetsAt: string | null
  lastPercent: number
  fired: number[]
}

export type QuotaAlertMemories = Record<QuotaWindowKind, QuotaAlertMemory>

/** Tokens acumulados de un modelo en la sesión; entrada no cacheada, salida y caché aparte. */
export type QuotaModelTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** Tokens por nombre de modelo, según lo que informa cada turn.complete. */
export type QuotaModels = Record<string, QuotaModelTokens>

declare module 'claude-code' {
  interface PluginState {
    'quota-watch': {
      windows: QuotaWindows
      prefs: QuotaPrefs
      memories: QuotaAlertMemories
      models: QuotaModels
    }
  }
}
