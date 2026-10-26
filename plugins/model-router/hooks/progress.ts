import type { ModelRouterLevel, ModelRouterTask } from '../types'

export type RunProgress = { total: number; done: number; running: number; pct: number }

/** Subagents of the user turn `run`: running first, then in spawn order. */
export const turnTasks = (tasks: readonly ModelRouterTask[], run: number): ModelRouterTask[] =>
  tasks
    .filter(t => t.run === run)
    .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || a.startedAt - b.startedAt)

const GROUP_ORDER: ModelRouterLevel[] = ['opus', 'sonnet', 'haiku']

/** Tasks grouped by model, Opus, Sonnet, Haiku; empty groups left out, order inside kept. */
export const groupByModel = (tasks: readonly ModelRouterTask[]) =>
  GROUP_ORDER.map(b => ({ b, tasks: tasks.filter(t => t.model === b) })).filter(g => g.tasks.length > 0)

export type EffortTone = 'low' | 'mid' | 'high' | 'none'

/** low green, medium amber, high/xhigh/max red, unknown gray. */
export const effortTone = (e: string | null | undefined): EffortTone =>
  e === 'low' ? 'low' : e === 'medium' ? 'mid' : e === 'high' || e === 'xhigh' || e === 'max' ? 'high' : 'none'

/** One colour per effort tone: `color` for terminal Text, `css` the PANE_CSS variable on the desktop. */
export const EFFORT_COLOR: Record<EffortTone, { color: string; css: string }> = {
  low: { color: 'green', css: 'ok' },
  mid: { color: 'yellow', css: 'wa' },
  high: { color: 'red', css: 'cr' },
  none: { color: 'gray', css: 'ot' },
}

/**
 * Progress of the current task: the subagents spawned in the user turn `run` (its turn.start
 * sequence number). A subagent counts as done once it leaves `running`, error included.
 * Null when that turn has spawned none, so the bar stays hidden.
 */
export const progressOf = (tasks: readonly ModelRouterTask[], run: number): RunProgress | null => {
  const mine = tasks.filter(t => t.run === run)
  if (mine.length === 0) return null
  const running = mine.filter(t => t.status === 'running').length
  const done = mine.length - running
  // heuristic: a running task is worth 10 % per turn.step seen, capped at 90 %; finished = 100 %; total = mean
  const sum = mine.reduce((s, t) => s + (t.status === 'running' ? Math.min(90, (t.steps ?? 0) * 10) : 100), 0)
  return { total: mine.length, done, running, pct: Math.round(sum / mine.length) }
}
