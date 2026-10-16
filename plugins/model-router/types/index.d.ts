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

export type ModelRouterSessionTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  byModel: Record<ModelRouterBucket, number>
}

export type ModelRouterContext = { percent?: number; tokens?: number; window: number }

declare module 'claude-code' {
  interface PluginState {
    'model-router': {
      tasks: ModelRouterTask[]
      isEnabled: boolean
      isPaneShown: boolean
      tab: 'resumen' | 'tareas' | 'consumo'
      days: Record<string, ModelRouterDay>
      sessionTokens: ModelRouterSessionTokens
      limits: ModelRouterLimit[]
      cost: number | null
      context: ModelRouterContext | null
    }
  }
}
