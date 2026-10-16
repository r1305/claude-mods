import type { ModelRouterLevel, ModelRouterLimit } from '../types'
import { STRONG, classify, head } from './classify'

export const LEVELS: ModelRouterLevel[] = ['haiku', 'sonnet', 'opus']

const rank = (l: ModelRouterLevel) => LEVELS.indexOf(l)
const at = (i: number): ModelRouterLevel => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))] ?? 'sonnet'
export const clampLevel = (l: ModelRouterLevel, floor: ModelRouterLevel, ceiling: ModelRouterLevel) =>
  at(Math.min(rank(ceiling), Math.max(rank(floor), rank(l))))

const shift = (base: ModelRouterLevel, cls: ModelRouterLevel) => at(rank(base) + rank(cls) - rank('sonnet'))

export const QA_UP =
  /\bbd prod\w*|\bdb prod\w*|\bprod(uction)? (db|database)\b|\bbase de datos de producci[oó]n\b|\b(bd|db|base de datos) (de |en )?producci[oó]n\b|\bconcurren\w*|\btransacci\w*|\btransactions?\b|\blimpieza\b|\blimpia\w* (de )?(datos|registros)\b|\bclean-?up\b|\b(borra|elimina)\w* (de )?(datos|registros)\b|\bdelete (data|records|rows)\b/i

export const UPDATE_ONLY = /\bactualiz\w*|\bupdate\w*|\bmodo actualizaci[oó]n\b/i
export const CREATE = /\bcrea(r|te|do|da)?\b|\bnuev[oa]s?\b|\bnew\b/i

type Pick = (desc: string, prompt: string) => ModelRouterLevel

export type AgentRule = { base: ModelRouterLevel; floor: ModelRouterLevel; ceiling: ModelRouterLevel; pick: Pick }

const byClass = (base: ModelRouterLevel): Pick => (d, p) => shift(base, classify(d, p))
const intro = (d: string, p: string) => `${d}\n${head(p)}`

export const RULES: Record<string, AgentRule> = {
  dev: { base: 'sonnet', floor: 'haiku', ceiling: 'opus', pick: byClass('sonnet') },
  qa: {
    base: 'haiku',
    floor: 'haiku',
    ceiling: 'sonnet',
    pick: (d, p) => (QA_UP.test(intro(d, p)) || classify(d, p) === 'opus' ? 'sonnet' : 'haiku'),
  },
  review: { base: 'opus', floor: 'sonnet', ceiling: 'opus', pick: byClass('opus') },
  explorer: {
    base: 'sonnet',
    floor: 'haiku',
    ceiling: 'sonnet',
    pick: (d, p) => (UPDATE_ONLY.test(intro(d, p)) && !CREATE.test(intro(d, p)) ? 'haiku' : 'sonnet'),
  },
  tooling: {
    base: 'sonnet',
    floor: 'haiku',
    ceiling: 'sonnet',
    pick: (d, p) => (UPDATE_ONLY.test(intro(d, p)) && !CREATE.test(intro(d, p)) && !STRONG.test(`${d}\n${p}`) ? 'haiku' : 'sonnet'),
  },
  plan: { base: 'sonnet', floor: 'haiku', ceiling: 'opus', pick: byClass('sonnet') },
}

export const DEFAULT_RULE: AgentRule = { base: 'sonnet', floor: 'haiku', ceiling: 'opus', pick: (d, p) => classify(d, p) }

export const ruleFor = (subagentType: string) => RULES[subagentType.trim().toLowerCase()] ?? DEFAULT_RULE

export type UsageState = { hasData: boolean; general: number; opusWeekly: number | undefined }

const GENERAL_KINDS = new Set(['five_hour', 'seven_day'])

export function usageState(limits: readonly ModelRouterLimit[] | undefined): UsageState {
  const list = limits ?? []
  const general = list.filter(l => GENERAL_KINDS.has(l.kind))
  const opus = list.filter(l => /opus/i.test(l.kind))
  return {
    hasData: general.length > 0 || opus.length > 0,
    general: general.reduce((m, l) => Math.max(m, l.percentUsed), 0),
    opusWeekly: opus.length > 0 ? opus.reduce((m, l) => Math.max(m, l.percentUsed), 0) : undefined,
  }
}

export const HIGH = 80
export const CRITICAL = 95

export function applyUsage(level: ModelRouterLevel, floor: ModelRouterLevel, u: UsageState) {
  const notes: string[] = []
  let out = level
  if (u.hasData) {
    if (u.general >= CRITICAL) {
      out = floor
      if (out !== level) notes.push(`uso ${Math.round(u.general)} % → haiku/suelo`)
    } else if (u.general >= HIGH) {
      out = at(Math.max(rank(floor), rank(level) - 1))
      if (out !== level) notes.push(`uso ${Math.round(u.general)} % → un escalón menos`)
    }
    if (u.opusWeekly !== undefined && u.opusWeekly >= HIGH && out === 'opus') {
      out = 'sonnet'
      notes.push(`opus semanal ${Math.round(u.opusWeekly)} % → sin opus`)
    }
  } else {
    notes.push('sin datos de uso')
  }
  return { level: out, notes }
}

export type RouteDecision = {
  model: ModelRouterLevel
  base: ModelRouterLevel
  floor: ModelRouterLevel
  picked: ModelRouterLevel
  reason: string
}

export function route(
  subagentType: string,
  description: string,
  prompt: string,
  limits: readonly ModelRouterLimit[] | undefined,
  requested?: string,
): RouteDecision {
  const rule = ruleFor(subagentType)
  const picked = clampLevel(rule.pick(description, prompt), rule.floor, rule.ceiling)
  const used = applyUsage(picked, rule.floor, usageState(limits))
  const reason = [
    `${subagentType || 'general-purpose'}: base ${rule.base}, suelo ${rule.floor}, tarea ${picked}`,
    ...(requested !== undefined && requested !== '' ? [`pedido ${requested} (ignorado)`] : []),
    ...used.notes,
  ].join(' · ')
  return { model: used.level, base: rule.base, floor: rule.floor, picked, reason }
}

export function routeNote(limits: readonly ModelRouterLimit[] | undefined) {
  const u = usageState(limits)
  if (!u.hasData) return { text: 'sin datos de uso: no baja de modelo por límites', level: 'none' as const }
  const parts: string[] = []
  let level: 'ok' | 'high' | 'critical' = 'ok'
  if (u.general >= CRITICAL) {
    parts.push(`uso al ${Math.round(u.general)} %: todo a haiku salvo suelos`)
    level = 'critical'
  } else if (u.general >= HIGH) {
    parts.push(`uso al ${Math.round(u.general)} %: baja un escalón`)
    level = 'high'
  }
  if (u.opusWeekly !== undefined && u.opusWeekly >= HIGH) {
    parts.push(`opus semanal al ${Math.round(u.opusWeekly)} %: sin opus`)
    if (level === 'ok') level = 'high'
  }
  if (parts.length === 0) return { text: 'elige el modelo de todos los subagentes', level }
  return { text: parts.join(' · '), level }
}
