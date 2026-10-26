import type { ModelRouterTask } from '../types'

export type RunProgress = { total: number; done: number; running: number; pct: number }

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
  return { total: mine.length, done, running, pct: Math.round((done / mine.length) * 100) }
}
