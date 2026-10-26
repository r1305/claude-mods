import { test, expect } from 'claude-code/testing'

import type { ModelRouterTask } from '../types'
import { effortTone, groupByModel, progressOf, turnTasks } from './progress'
import { modelRows } from './usage'

const task = (id: string, run: number | undefined, status: ModelRouterTask['status'], startedAt = 0): ModelRouterTask => ({
  id,
  model: 'sonnet',
  description: '',
  subagentType: '',
  source: 'auto',
  status,
  startedAt,
  ...(run !== undefined ? { run } : {}),
})

test('progress: counts only the subagents of the current turn', () => {
  const tasks = [task('a', 1, 'done'), task('b', 2, 'running'), task('c', 2, 'done'), task('d', 2, 'error'), task('e', undefined, 'running')]
  expect(progressOf(tasks, 2)).toEqual({ total: 3, done: 2, running: 1, pct: 67 })
})

test('progress: null when the turn has spawned nothing, 100 % when all are finished', () => {
  expect(progressOf([task('a', 1, 'done')], 2)).toBeNull()
  expect(progressOf([task('a', 3, 'done'), task('b', 3, 'done')], 3)).toEqual({ total: 2, done: 2, running: 0, pct: 100 })
})

test('turnTasks: only the current turn, running first, then in spawn order', () => {
  const tasks = [task('a', 2, 'done', 1), task('b', 1, 'running', 2), task('c', 2, 'running', 3), task('d', 2, 'error', 0), task('e', 2, 'running', 2)]
  expect(turnTasks(tasks, 2).map(t => t.id)).toEqual(['e', 'c', 'd', 'a'])
  expect(turnTasks(tasks, 3)).toEqual([])
})

test('modelRows: session tokens per exact model, largest first, empty rows dropped', () => {
  const rows = modelRows({
    'claude-sonnet-4-5': { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
    'claude-opus-5-5': { input: 1000, output: 0, cacheRead: 500, cacheWrite: 0 },
    'x-model': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  })
  expect(rows.map(r => [r.name, r.b, r.total])).toEqual([
    ['claude-opus-5-5', 'opus', 1500],
    ['claude-sonnet-4-5', 'sonnet', 150],
  ])
})

test('groupByModel: Opus, Sonnet, Haiku order, empty groups dropped, inner order kept', () => {
  const t = (id: string, model: ModelRouterTask['model']): ModelRouterTask => ({ ...task(id, 1, 'running'), model })
  const groups = groupByModel([t('a', 'haiku'), t('b', 'opus'), t('c', 'haiku')])
  expect(groups.map(g => [g.b, g.tasks.map(x => x.id)])).toEqual([
    ['opus', ['b']],
    ['haiku', ['a', 'c']],
  ])
})

test('effortTone: low green, medium amber, high/xhigh/max red, unknown gray', () => {
  expect(['low', 'medium', 'high', 'xhigh', 'max', undefined, 'raro'].map(effortTone)).toEqual(['low', 'mid', 'high', 'high', 'high', 'none', 'none'])
})
