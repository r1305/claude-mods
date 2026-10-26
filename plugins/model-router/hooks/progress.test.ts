import { test, expect } from 'claude-code/testing'

import type { ModelRouterTask } from '../types'
import { progressOf } from './progress'

const task = (id: string, run: number | undefined, status: ModelRouterTask['status']): ModelRouterTask => ({
  id,
  model: 'sonnet',
  description: '',
  subagentType: '',
  source: 'auto',
  status,
  startedAt: 0,
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
