export type ModelRouterLevel = 'haiku' | 'sonnet' | 'opus'

export type ModelRouterTask = {
  /** agentId of the started subagent, or a unique id for a refused spawn */
  id: string
  model: ModelRouterLevel
  description: string
  /** agent type it was spawned as (general-purpose, Explore, a named agent, fork) */
  subagentType: string
  /** 'auto': classified by this mod; 'explícito': the call set `model`; 'agente': the agent's own model */
  source: 'explícito' | 'auto' | 'agente'
  /** the `model` the call asked for, recorded when the router decided instead */
  requested?: string
  /** why the router picked this model (rule, usage downgrades) */
  reason?: string
  status: 'running' | 'done' | 'error'
  /** ms since epoch */
  startedAt: number
  /** summed from the subagent's turn.complete durationMs */
  durationMs?: number
  /** summed from the subagent's turn.complete usage */
  tokens?: number
  /** effort the subagent runs at, from its turn.step (low, medium, high, xhigh, max) */
  effort?: string
  /** sequence number of the user turn that spawned it (turn.start); progress counts per turn */
  run?: number
}

export type ModelRouterBucket = ModelRouterLevel | 'other'

/** tokens counted per model bucket for one local day (input + output + cache) */
export type ModelRouterDay = Record<ModelRouterBucket, number> & { total: number }

/** one session's file under <config>/model-router/usage/<sessionId>.json */
export type ModelRouterUsageFile = {
  name: string
  project: string
  days: Record<string, ModelRouterDay>
}

export type ModelRouterLimit = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

/** Session token totals by model family, derived from `models` for the family split. */
export type ModelRouterSessionTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  byModel: Record<ModelRouterBucket, number>
}

export type ModelRouterContext = { percent?: number; tokens?: number; window: number }

/** The two plan windows that carry alerts. */
export type ModelRouterWindowKind = 'five_hour' | 'seven_day'

/** Preferences in $.store: alerts shown or hidden, and the aviso and crítico thresholds in percent. */
export type ModelRouterPrefs = {
  alerts: boolean
  warn: number
  critical: number
}

/** Alert memory of one window: thresholds already alerted in its cycle and the last figure seen. */
export type ModelRouterAlertMemory = {
  resetsAt: string | null
  lastPercent: number
  fired: number[]
}

export type ModelRouterAlertMemories = Record<ModelRouterWindowKind, ModelRouterAlertMemory>

/** Session tokens of one exact model name, from turn.complete usage. */
export type ModelRouterModelTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type ModelRouterModels = Record<string, ModelRouterModelTokens>

declare module 'claude-code' {
  interface PluginState {
    'model-router': {
      tasks: ModelRouterTask[]
      isEnabled: boolean
      isPaneShown: boolean
      days: Record<string, ModelRouterDay>
      models: ModelRouterModels
      limits: ModelRouterLimit[]
      cost: number | null
      context: ModelRouterContext | null
      prefs: ModelRouterPrefs
      memories: ModelRouterAlertMemories
      runSeq: number
      effort: string | null
    }
  }
}
