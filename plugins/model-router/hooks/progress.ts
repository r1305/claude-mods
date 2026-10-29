import type { ModelRouterBucket, ModelRouterTask } from '../types'
import { bucketOf } from './usage'

export type RunProgress = { total: number; done: number; running: number; pct: number }

/** Subagents of the user turn `run`: running first, then in spawn order. */
export const turnTasks = (tasks: readonly ModelRouterTask[], run: number): ModelRouterTask[] =>
  tasks
    .filter(t => t.run === run || t.status === 'running')
    .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || a.startedAt - b.startedAt)

const GROUP_ORDER: ModelRouterBucket[] = ['opus', 'sonnet', 'haiku', 'other']

/** Tasks grouped by model, Opus, Sonnet, Haiku, Otros (fable); empty groups left out, order inside kept. */
export const groupByModel = (tasks: readonly ModelRouterTask[]) =>
  GROUP_ORDER.map(b => ({ b, tasks: tasks.filter(t => bucketOf(t.model) === b) })).filter(g => g.tasks.length > 0)

/** Finished tasks (done or error), newest first. History is per session: the tasks atom holds at most MAX_TASKS and is lost on restart. */
export const historyOf = (tasks: readonly ModelRouterTask[]): ModelRouterTask[] =>
  tasks.filter(t => t.status !== 'running').sort((a, b) => b.startedAt - a.startedAt)

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
export const progressOf = (tasks: readonly ModelRouterTask[], run: number, now?: number): RunProgress | null => {
  const mine = tasks.filter(t => t.run === run)
  if (mine.length === 0) return null
  const running = mine.filter(t => t.status === 'running').length
  const done = mine.length - running
  // heuristic: running = max(10 % per turn.step seen, 1 % per 2 s since startedAt), capped at 90 %; finished = 100 %; total = mean
  const live = (t: ModelRouterTask) => Math.min(90, Math.max((t.steps ?? 0) * 10, now !== undefined ? Math.floor((now - t.startedAt) / 2000) : 0))
  const sum = mine.reduce((s, t) => s + (t.status === 'running' ? live(t) : 100), 0)
  return { total: mine.length, done, running, pct: Math.round(sum / mine.length) }
}
