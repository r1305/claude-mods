import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { QuotaAlertMemories, QuotaModels, QuotaPrefs, QuotaWindows } from '../types'
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  WINDOWS,
  addUsage,
  alertText,
  emptyMemories,
  emptyWindows,
  evaluateAlerts,
  modelsLine,
  parseCommand,
  parsePrefs,
  quotaReport,
  windowLine,
  windowsOf,
} from './logic'

const windows = atom({ plugin: 'quota-watch', key: 'windows' } as const, emptyWindows() as QuotaWindows)
const prefs = atom({ plugin: 'quota-watch', key: 'prefs' } as const, DEFAULT_PREFS as QuotaPrefs)
const memories = atom({ plugin: 'quota-watch', key: 'memories' } as const, emptyMemories() as QuotaAlertMemories)
const models = atom({ plugin: 'quota-watch', key: 'models' } as const, {} as QuotaModels)

const loadPrefs = async ($: EngineInterface): Promise<QuotaPrefs> => {
  try {
    return parsePrefs(await $.store.get(PREFS_KEY))
  } catch {
    return DEFAULT_PREFS
  }
}

const savePrefs = async ($: EngineInterface, value: QuotaPrefs) => {
  await update($, prefs, () => value).catch(() => undefined)
  await $.store.set(PREFS_KEY, value).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const loaded = await loadPrefs($)
    await update($, prefs, () => loaded).catch(() => undefined)
    await update($, models, () => ({})).catch(() => undefined)
    await update($, memories, () => emptyMemories()).catch(() => undefined)
    try {
      const usage = await $.session.usage()
      await update($, windows, () => windowsOf(usage.rateLimits)).catch(() => undefined)
    } catch {
      await update($, windows, () => emptyWindows()).catch(() => undefined)
    }
    await $.command
      .register({
        name: 'quota',
        description: 'Cuotas del plan (5 h y semanal), alertas y tokens por modelo en la sesión.',
        argumentHint: 'alerts on|off | umbrales <aviso> <crítico>',
      })
      .catch(error => {
        $.ui.toast(`/quota no se pudo registrar: ${error instanceof Error ? error.message : String(error)}`)
      })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const current = windowsOf(e.rateLimits)
    const config = await read($, prefs)
    const before = await read($, memories)
    const after = emptyMemories()
    const messages: string[] = []
    for (const kind of WINDOWS) {
      const window = current[kind]
      const result = evaluateAlerts(before[kind], window, config)
      after[kind] = result.memory
      if (window !== null && result.alert !== undefined) messages.push(alertText(kind, result.alert, window))
    }
    await update($, windows, () => current).catch(() => undefined)
    await update($, memories, () => after).catch(() => undefined)
    for (const message of messages) $.ui.toast(message)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.usage !== undefined) {
      const usage = e.usage
      await update($, models, prev => addUsage(prev, usage.model, usage)).catch(() => undefined)
    }
    return next(e)
  })

  on('command.run', { command: 'quota' }, async ($, e) => {
    const command = parseCommand(e.args)
    if (command.kind === 'error') return { text: command.message }
    if (command.kind === 'alerts') {
      const config = await read($, prefs)
      await savePrefs($, { ...config, alerts: command.on })
      return { text: `Alertas ${command.on ? 'activadas' : 'ocultas'}.` }
    }
    if (command.kind === 'thresholds') {
      const config = await read($, prefs)
      await savePrefs($, { ...config, warn: command.warn, critical: command.critical })
      return { text: `Umbrales: aviso ${command.warn} %, crítico ${command.critical} %.` }
    }
    const [current, tokens, config] = await Promise.all([read($, windows), read($, models), read($, prefs)])
    return { text: quotaReport(current, tokens, config) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const [current, tokens, config] = await Promise.all([read($, windows), read($, models), read($, prefs)])
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          {WINDOWS.map(kind => (
            <Text key={kind}>{windowLine(kind, current[kind], config)}</Text>
          ))}
          <Text dimColor>{`Tokens de la sesión: ${modelsLine(tokens)}`}</Text>
        </Box>
      </Box>
    )
  })
}
