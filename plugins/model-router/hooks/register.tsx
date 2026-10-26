import { atom, read, update } from 'claude-code'
import type { AgentSpawnResult, EngineInterface, Register, Timer } from 'claude-code'

import type { ModelRouterAlertMemories, ModelRouterLevel, ModelRouterLimit, ModelRouterModels, ModelRouterPrefs, ModelRouterTask, ModelRouterUsageFile } from '../types'
import { DEFAULT_PREFS, PREFS_KEY, WINDOWS, addUsage, alertText, emptyMemories, evaluateAlerts, parseCommand, parsePrefs, windowsOf } from './quota'
import { progressOf, turnTasks } from './progress'
import { route, routeNote } from './route'
import {
  FLUSH_MS,
  addTokens,
  aggregate,
  asUsageFile,
  bucketOf,
  mergeDays,
  parseJson,
  sessionOf,
  statusText,
  textSummary,
  trimDays,
} from './usage'
import type { SessionFile } from './usage'
import { renderPanel, renderProgressBar, renderTokens } from './view'
import type { El } from './view'

const PANE = 'model-router'
const TOKENS_PANE = 'model-router-tokens'
const TOKENS_TITLE = 'Tokens por modelo'
const MAX_TASKS = 200
const REFRESH_MS = 30_000
const LEVELS: ModelRouterLevel[] = ['haiku', 'sonnet', 'opus']

const COMMAND = {
  name: 'model-router',
  description: 'Open the model router pane; "on" / "off" toggles automatic routing; "usage" shows plan limits and consumption; "tokens" opens the tokens-per-model pane; "alerts on|off" and "umbrales <aviso> <crítico>" set the alerts',
  argumentHint: '[on|off|usage|tokens|alerts on|off|umbrales <aviso> <crítico>]',
}

const QUOTA_COMMAND = {
  name: 'quota',
  description: 'Alias of /model-router usage: plan limits, alerts and tokens per model.',
}

const tasks = atom({ plugin: 'model-router', key: 'tasks' } as const, [])
const isEnabled = atom({ plugin: 'model-router', key: 'isEnabled' } as const, true)
const isPaneShown = atom({ plugin: 'model-router', key: 'isPaneShown' } as const, false)
const days = atom({ plugin: 'model-router', key: 'days' } as const, {})
const models = atom({ plugin: 'model-router', key: 'models' } as const, {} as ModelRouterModels)
const limits = atom({ plugin: 'model-router', key: 'limits' } as const, [] as ModelRouterLimit[])
const cost = atom({ plugin: 'model-router', key: 'cost' } as const, null as number | null)
const context = atom({ plugin: 'model-router', key: 'context' } as const, null as { percent?: number; tokens?: number; window: number } | null)
const prefs = atom({ plugin: 'model-router', key: 'prefs' } as const, DEFAULT_PREFS as ModelRouterPrefs)
const memories = atom({ plugin: 'model-router', key: 'memories' } as const, emptyMemories() as ModelRouterAlertMemories)
// Sequence of the user turns: each subagent is stamped with the one that spawned it.
const runSeq = atom({ plugin: 'model-router', key: 'runSeq' } as const, 0)
// Effort the main session runs at, from its last turn.step.
const effort = atom({ plugin: 'model-router', key: 'effort' } as const, null as string | null)
// Model the main session answered with last, from its turn.complete.
const mainModel = atom({ plugin: 'model-router', key: 'mainModel' } as const, null as string | null)

const POLICY = [
  'Model routing: the model-router mod is a middleware for every Agent tool call (all agent types except forks and workflow agents).',
  'It picks the subagent model itself from a per-agent base/floor table, the task complexity and the account usage limits, and overrides any `model` you pass.',
  'You do not need to choose `model`; write a clear `description` and prompt. Do not spawn agents just to save tokens.',
].join('\n')

const fileId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)

const lastSegment = (cwd: string) => {
  const parts = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  const last = parts[parts.length - 1]
  return last !== undefined && last !== '' ? last : 'sesion'
}

// Cross-session usage: one file per session under <config>/model-router/usage, via $.fs,
// not $.store ($.store is one JSON per plugin and is not reliable between processes).
// Each session writes ONLY its own file (<sessionId>.json) with whole-content writes, and
// the panel lists the folder and sums, so no file ever has two writers. $.fs has no delete:
// files of ended sessions stay and simply age out of the 7-day window.
async function usageDir($: EngineInterface) {
  const cfg = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const base = cfg !== undefined && cfg !== '' ? cfg : `${home}/.claude`
  return `${base.replace(/\\/g, '/').replace(/\/+$/, '')}/model-router/usage`
}

async function readUsageFiles($: EngineInterface): Promise<SessionFile[]> {
  const dir = await usageDir($)
  const entries = await $.fs.list(dir).catch(() => [])
  const names = entries.filter(f => f.kind === 'file' && f.name.endsWith('.json'))
  const rows = await Promise.all(
    names.map(async f => {
      const text = await $.fs.read(`${dir}/${f.name}`).then(t => (typeof t === 'string' ? t : ''), () => '')
      const file = asUsageFile(parseJson(text))
      return file ? { id: f.name.slice(0, -5), file } : undefined
    }),
  )
  return rows.flatMap(r => (r ? [r] : []))
}

let lastFlush = 0

async function flush($: EngineInterface, isForced: boolean) {
  const now = await $.clock.now()
  if (!isForced && lastFlush > 0 && now - lastFlush < FLUSH_MS) return
  lastFlush = now
  const [id, cwd, mine, dir] = await Promise.all([$.session.id(), $.session.cwd(), read($, days), usageDir($)])
  const path = `${dir}/${fileId(id)}.json`
  const prior = asUsageFile(parseJson(await $.fs.read(path).then(t => (typeof t === 'string' ? t : ''), () => '')))
  const merged = trimDays(prior ? mergeDays(prior.days, mine) : mine, now)
  const project = lastSegment(cwd)
  const file: ModelRouterUsageFile = { name: project, project, days: merged }
  await $.fs.write(path, JSON.stringify(file))
}

/** Stores the plan limits and runs the alerts: once per threshold and window cycle, as toasts. */
async function applyLimits($: EngineInterface, rows: readonly ModelRouterLimit[]) {
  const kept: ModelRouterLimit[] = rows.map(l => ({
    kind: l.kind,
    percentUsed: l.percentUsed,
    ...(l.resetsAt !== undefined ? { resetsAt: l.resetsAt } : {}),
  }))
  await update($, limits, () => kept).catch(() => undefined)
  const current = windowsOf(kept)
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
  await update($, memories, () => after).catch(() => undefined)
  for (const message of messages) $.ui.toast(message)
}

/**
 * The only place that reads the plan limits: `$.session.usage()`. It runs at session start,
 * on each /model-router usage or /quota, and on the 30 s tick while the pane is open.
 * session.measure hands its figures over without a read of its own.
 */
async function refreshLimits($: EngineInterface) {
  const live = await $.session.usage().catch(() => undefined)
  if (live === undefined) return
  await update($, cost, () => live.cost?.usd ?? null).catch(() => undefined)
  await update($, context, () => live.context).catch(() => undefined)
  await applyLimits($, live.rateLimits)
}

async function loadPrefs($: EngineInterface): Promise<ModelRouterPrefs> {
  try {
    return parsePrefs(await $.store.get(PREFS_KEY))
  } catch {
    return DEFAULT_PREFS
  }
}

async function savePrefs($: EngineInterface, value: ModelRouterPrefs) {
  await update($, prefs, () => value).catch(() => undefined)
  await $.store.set(PREFS_KEY, value).catch(() => undefined)
}

async function collect($: EngineInterface) {
  const [id, cwd, now, mine, modelsNow, limitsNow, costNow, ctxNow, files] = await Promise.all([
    $.session.id().catch(() => 'sesion'),
    $.session.cwd().catch(() => ''),
    $.clock.now(),
    read($, days),
    read($, models),
    read($, limits),
    read($, cost),
    read($, context),
    readUsageFiles($).catch(() => [] as SessionFile[]),
  ])
  const own = fileId(id)
  const prior = files.find(f => f.id === own)
  const project = lastSegment(cwd)
  const all: SessionFile[] = [
    ...files.filter(f => f.id !== own),
    { id: own, file: { name: project, project, days: prior ? mergeDays(prior.file.days, mine) : mine } },
  ]
  return {
    now,
    ownId: own,
    agg: aggregate(all, now),
    models: modelsNow,
    sess: sessionOf(modelsNow),
    limits: limitsNow,
    cost: costNow,
    ctx: ctxNow,
  }
}

async function usageText($: EngineInterface) {
  await refreshLimits($)
  const [c, enabled, list, config] = await Promise.all([collect($), read($, isEnabled), read($, tasks), read($, prefs)])
  const sessionTotal = Object.values(c.sess.byModel).reduce((s, n) => s + n, 0)
  return textSummary({
    agg: c.agg,
    limits: c.limits,
    now: c.now,
    sessionTotal,
    sessionByModel: c.sess.byModel,
    models: c.models,
    cost: c.cost,
    enabled,
    prefs: config,
    running: list.filter(t => t.status === 'running'),
    routeNote: routeNote(c.limits, config).text,
    ...(c.ctx?.percent !== undefined ? { contextPercent: c.ctx.percent } : {}),
  })
}

// Timer: refreshes the limits and redraws the pane every REFRESH_MS, only while the pane is
// open. Cancelled at ui.close and session.end; a hot reload drops it with the old
// environment and ui.render starts it again, so it never doubles.
let tick: Timer | undefined
const stopTick = () => {
  tick?.cancel()
  tick = undefined
}
function startTick($: EngineInterface) {
  if (tick !== undefined) return
  tick = $.clock.every(REFRESH_MS, () => {
    void refreshLimits($)
      .then(() => $.ui.invalidate('ui.render'))
      .catch(() => {})
    void flush($, false).catch(() => {})
  })
}

let seq = 0

async function refreshStatus($: EngineInterface) {
  const [lims, enabled, config] = await Promise.all([read($, limits), read($, isEnabled), read($, prefs)])
  $.ui.status(statusText(lims, enabled, config))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const spec of [COMMAND, QUOTA_COMMAND]) await $.command.register(spec).catch(() => undefined)
    const config = await loadPrefs($)
    await update($, prefs, () => config).catch(() => undefined)
    await refreshLimits($)
    if (!(await read($, isPaneShown))) {
      await update($, isPaneShown, () => true)
      void $.ui.open({ id: PANE, title: 'Model router' }).catch(() => {})
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    stopTick()
    try {
      await flush($, true)
    } catch {}
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      stopTick()
    }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'model-router' }, async ($, e) => {
    const command = parseCommand(e.args)
    if (command.kind === 'error') return { text: command.message }
    if (command.kind === 'toggle') {
      await update($, isEnabled, () => command.on)
      await refreshStatus($).catch(() => {})
      await $.ui.open({ id: PANE, title: 'Model router' }).catch(() => {})
      return { text: `Model router: enrutado ${command.on ? 'activo' : 'pausado'}.` }
    }
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
    if (command.kind === 'tokens') {
      await $.ui.open({ id: TOKENS_PANE, title: TOKENS_TITLE })
      return { text: 'Model router: vista de tokens por modelo abierta.' }
    }
    if (command.kind === 'usage') {
      await $.ui.open({ id: PANE, title: 'Model router' }).catch(() => {})
      return { text: await usageText($) }
    }
    await $.ui.open({ id: PANE, title: 'Model router' })
    const enabled = await read($, isEnabled)
    return { text: `Model router: panel abierto (enrutado ${enabled ? 'activo' : 'pausado'}).` }
  }).catch(() => ({ text: 'model-router: error interno, inténtalo de nuevo.' }))

  on('command.run', { command: 'quota' }, async ($) => {
    await $.ui.open({ id: PANE, title: 'Model router' }).catch(() => {})
    return { text: await usageText($) }
  }).catch(() => ({ text: 'quota: error interno, inténtalo de nuevo.' }))

  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    if (!e.tools.includes('Agent')) return out
    if (!(await read($, isEnabled))) return out
    return {
      sections: [
        ...out.sections,
        { id: 'model-router:policy', text: POLICY, scope: 'session' as const },
      ],
    }
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const [enabled, lims, config, run] = await Promise.all([read($, isEnabled), read($, limits), read($, prefs), read($, runSeq)])
    const isRouted = enabled && !e.fork && !e.workflow
    const decision = isRouted ? route(e.subagentType ?? '', e.description ?? '', e.prompt ?? '', lims, e.model, config) : undefined
    const chosen = decision?.model
    const startedAt = await $.clock.now()
    let r: AgentSpawnResult | undefined
    try {
      r = await next(chosen ? { ...e, model: chosen } : e)
      return r
    } finally {
      try {
        const failed = r === undefined || r.deny !== undefined
        const model = levelOf(r?.model) ?? chosen ?? (e.fork ? undefined : levelOf(e.model))
        const id = failed ? `spawn-${e.tool_use_id || startedAt}-${++seq}` : r?.agentId
        if (model && id) {
          const task: ModelRouterTask = {
            id,
            model,
            description: e.description ?? '',
            subagentType: e.fork ? 'fork' : e.subagentType ?? '',
            source: chosen ? 'auto' : e.model !== undefined && !e.fork ? 'explícito' : 'agente',
            ...(chosen && e.model !== undefined && e.model !== '' ? { requested: e.model } : {}),
            ...(decision ? { reason: decision.reason } : {}),
            status: failed ? 'error' : 'running',
            startedAt,
            run,
          }
          await update($, tasks, list => [...list.filter(t => t.id !== id), task].slice(-MAX_TASKS))
          await refreshStatus($)
          $.ui.invalidate('ui.render')
        }
      } catch {}
    }
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, runSeq, n => n + 1).catch(() => undefined)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const level = e.effort
    if (e.agentId !== undefined) {
      const id = e.agentId
      try {
        await update($, tasks, list => list.map(t => (t.id === id && t.status === 'running' ? { ...t, steps: (t.steps ?? 0) + 1 } : t)))
        $.ui.invalidate('ui.render')
      } catch {}
    }
    if (typeof level === 'string') {
      try {
        if (e.agentId === undefined) {
          if ((await read($, effort)) !== level) {
            await update($, effort, () => level)
            $.ui.invalidate('ui.render')
          }
        } else {
          const agentId = e.agentId
          if ((await read($, tasks)).some(t => t.id === agentId && t.effort !== level)) {
            await update($, tasks, list => list.map(t => (t.id === agentId && t.effort !== level ? { ...t, effort: level } : t)))
            $.ui.invalidate('ui.render')
          }
        }
      } catch {}
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      try {
        const input = u.input_tokens
        const output = u.output_tokens
        const cacheRead = u.cache_read_input_tokens ?? 0
        const cacheWrite = u.cache_creation_input_tokens ?? 0
        const total = input + output + cacheRead + cacheWrite
        const now = await $.clock.now()
        await update($, models, prev => addUsage(prev, u.model ?? '', u))
        await update($, days, d => addTokens(d, now, bucketOf(u.model), total))
        if (e.agentId === undefined && u.model) {
          const name = u.model
          await update($, mainModel, () => name)
        }
        await flush($, false)
        $.ui.invalidate('ui.render')
      } catch {}
    }
    const agentId = e.agentId
    if (agentId !== undefined) {
      try {
        const list = await read($, tasks)
        if (list.some(t => t.id === agentId)) {
          const tokens = u
            ? u.input_tokens + u.output_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
            : undefined
          const actual = levelOf(u?.model)
          await update($, tasks, cur =>
            cur.map(t =>
              t.id === agentId
                ? {
                    ...t,
                    ...(actual ? { model: actual } : {}),
                    status: e.reason === 'answer' ? ('done' as const) : ('error' as const),
                    durationMs: (t.durationMs ?? 0) + e.durationMs,
                    ...(tokens !== undefined ? { tokens: (t.tokens ?? 0) + tokens } : {}),
                  }
                : t,
            ),
          )
          await refreshStatus($)
          $.ui.invalidate('ui.render')
        }
      } catch {}
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    try {
      await update($, cost, () => e.cost?.usd ?? null)
      await update($, context, () => ({
        window: e.context.window,
        ...(e.context.tokens !== undefined ? { tokens: e.context.tokens } : {}),
        ...(e.context.percent !== undefined ? { percent: e.context.percent } : {}),
      }))
      await applyLimits($, e.rateLimits)
      await refreshStatus($)
      if (tick !== undefined) $.ui.invalidate('ui.render')
      await flush($, false)
    } catch {}
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [run, list, level] = await Promise.all([read($, runSeq), read($, tasks), read($, effort)])
    if (e.props.hasSurvey) return next(e)
    const progress = progressOf(list, run) ?? { total: 0, done: 0, running: 0, pct: 0 }
    // Other mods' bands drawn beneath this bar; Claude Code's own placeholder is never nested.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? (drawn as El) : null
    return renderProgressBar($.ui.resolve(e), { surface: e.surface, cols: e.props.bodyColumns, progress, effort: level, below })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    startTick($)
    const els = $.ui.resolve(e)
    const [enabled, c, list, config, run, level, main] = await Promise.all([
      read($, isEnabled),
      collect($),
      read($, tasks),
      read($, prefs),
      read($, runSeq),
      read($, effort),
      read($, mainModel),
    ])
    const rows = e.viewport?.rows ?? 30
    const scroll = e.props.scroll as { bodyRows?: number } | undefined
    const refresh = () => {
      $.ui.invalidate('ui.render')
    }
    return renderPanel(
      els,
      {
        now: c.now,
        enabled,
        tasks: list,
        limits: c.limits,
        agg: c.agg,
        prefs: config,
        route: routeNote(c.limits, config),
        progress: progressOf(list, run),
        effort: level,
        turnTasks: turnTasks(list, run),
        mainModel: main ? bucketOf(main) : null,
      },
      {
        surface: e.surface,
        cols: Math.max(24, e.props.bodyColumns),
        bodyRows: scroll?.bodyRows ?? Math.max(8, rows - 6),
        onToggle: () => {
          void update($, isEnabled, v => !v)
            .then(() => refreshStatus($))
            .then(refresh)
            .catch(() => {})
        },
        onTokens: () => {
          void $.ui.open({ id: TOKENS_PANE, title: TOKENS_TITLE }).catch(() => {})
        },
      },
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: TOKENS_PANE }, async ($, e) => {
    const c = await collect($)
    return renderTokens($.ui.resolve(e), { agg: c.agg, models: c.models }, { surface: e.surface, cols: Math.max(24, e.props.bodyColumns) })
  }).catch(($, e, next) => next(e))
}

const levelOf = (model: string | undefined): ModelRouterLevel | undefined => {
  const m = (model ?? '').toLowerCase()
  return LEVELS.find(l => m.includes(l))
}
