import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CleanViewStep, CleanViewTurn } from '../types'
import {
  DEFAULT_ENABLED,
  LABELS,
  STORE_KEY,
  addPending,
  dropPending,
  formatElapsed,
  isPendingVerdict,
  keepGroup,
  keepRow,
  markOf,
  panelState,
  parseCommand,
  parsePref,
  stepsOf,
  turnEnd,
} from './logic'

const enabled = atom({ plugin: 'clean-view', key: 'enabled' } as const, DEFAULT_ENABLED)
const turn = atom({ plugin: 'clean-view', key: 'turn' } as const, 'idle' as CleanViewTurn)
const waiting = atom({ plugin: 'clean-view', key: 'waiting' } as const, [] as string[])
const steps = atom({ plugin: 'clean-view', key: 'steps' } as const, [] as CleanViewStep[])
const startedAt = atom({ plugin: 'clean-view', key: 'startedAt' } as const, 0)
const now = atom({ plugin: 'clean-view', key: 'now' } as const, 0)

const TICK_MS = 1000

let timer: Timer | undefined

const stopTimer = () => {
  timer?.cancel()
  timer = undefined
}

const startTimer = ($: EngineInterface) => {
  stopTimer()
  timer = $.clock.every(TICK_MS, () => {
    $.clock
      .now()
      .then(t => update($, now, () => t))
      .catch(() => undefined)
  })
}

const setEnabled = async ($: EngineInterface, value: boolean) => {
  await update($, enabled, () => value).catch(() => undefined)
  await $.store.set(STORE_KEY, value).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const raw = await $.store.get(STORE_KEY)
      await update($, enabled, () => parsePref(raw))
    } catch {
      await update($, enabled, () => DEFAULT_ENABLED).catch(() => undefined)
    }
    await $.command
      .register({
        name: 'simple',
        description: 'Vista simple: oculta las filas técnicas de herramientas.',
        argumentHint: 'on|off',
      })
      .catch(() => undefined)
    return next(e)
  })

  on('session.end', ($, e, next) => {
    stopTimer()
    return next(e)
  })

  on('command.run', { command: 'simple' }, async ($, e) => {
    const mode = parseCommand(e.args)
    if (mode === undefined) {
      const current = await read($, enabled)
      return { text: `Vista simple ${current ? 'activada' : 'desactivada'}. Uso: /simple on | /simple off` }
    }
    await setEnabled($, mode === 'on')
    return { text: `Vista simple ${mode === 'on' ? 'activada' : 'desactivada'}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    if ((await read($, turn)) !== 'running') {
      await update($, turn, () => 'idle').catch(() => undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const t = await $.clock.now()
      await update($, turn, () => 'running').catch(() => undefined)
      await update($, waiting, () => []).catch(() => undefined)
      await update($, steps, () => []).catch(() => undefined)
      await update($, startedAt, () => t).catch(() => undefined)
      await update($, now, () => t).catch(() => undefined)
      startTimer($)
    }
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (e.tool_use_id !== undefined && e.agentId === undefined) {
      const id = e.tool_use_id
      const asks = isPendingVerdict(verdict.decision)
      await update($, waiting, prev => (asks ? addPending(prev, id) : dropPending(prev, id))).catch(() => undefined)
    }
    return verdict
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    if (e.tool === 'TodoWrite') {
      await update($, steps, () => stepsOf({ todos: e.todos })).catch(() => undefined)
    }
    const id = e.tool_use_id
    if (e.tool === 'AskUserQuestion') {
      await update($, waiting, prev => addPending(prev, id)).catch(() => undefined)
    }
    try {
      return await next(e)
    } finally {
      await update($, waiting, prev => dropPending(prev, id)).catch(() => undefined)
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      stopTimer()
      const t = await $.clock.now()
      await update($, now, () => t).catch(() => undefined)
      await update($, waiting, () => []).catch(() => undefined)
      await update($, turn, () => turnEnd(e.reason)).catch(() => undefined)
    }
    return next(e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)
    if (keepRow({ isErrored: e.props.isErrored, isInterrupted: e.props.isInterrupted })) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)
    if (keepRow({ isErrored: e.props.isErrored })) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)
    if (keepGroup(e.props.calls)) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const status = await read($, turn)
    if (status === 'idle' || e.props.hasSurvey) return next(e)

    const isOn = await read($, enabled)
    const pending = await read($, waiting)
    const plan = await read($, steps)
    const started = await read($, startedAt)
    const current = await read($, now)
    const label = LABELS[panelState(status, pending.length > 0)] ?? ''
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>{`Estado: ${label}`}</Text>
        {plan.length === 0 ? <Text dimColor>Sin plan emitido por la sesión</Text> : null}
        {plan.map((step, index) => (
          <Text key={`${index}:${step.content}`} bold={step.status === 'in_progress'} dimColor={step.status === 'completed'}>
            {`${markOf(step.status)} ${step.status === 'in_progress' ? step.activeForm : step.content}`}
          </Text>
        ))}
        <Text dimColor>{`Tiempo: ${formatElapsed(current - started)}`}</Text>
        <Button
          key="clean-view-toggle"
          label={isOn ? 'Vista simple: on' : 'Vista simple: off'}
          onPress={() => setEnabled($, !isOn)}
        />
      </Box>
    )
  })
}
