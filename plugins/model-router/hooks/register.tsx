import { atom, read, update } from 'claude-code'
import type { AgentSpawnResult, EngineInterface, Register, Timer } from 'claude-code'

import type { ModelRouterLevel, ModelRouterLimit, ModelRouterTask, ModelRouterUsageFile } from '../types'
import { route, routeNote } from './route'
import {
  FLUSH_MS,
  addTokens,
  aggregate,
  asUsageFile,
  bucketOf,
  emptyTokens,
  mergeDays,
  parseJson,
  statusText,
  textSummary,
  trimDays,
} from './usage'
import type { SessionFile } from './usage'
import { renderPanel } from './view'
import type { TabId } from './view'

const PANE = 'model-router'
const MAX_TASKS = 200
const REFRESH_MS = 30_000
const LEVELS: ModelRouterLevel[] = ['haiku', 'sonnet', 'opus']

const tasks = atom({ plugin: 'model-router', key: 'tasks' } as const, [])
const isEnabled = atom({ plugin: 'model-router', key: 'isEnabled' } as const, true)
const isPaneShown = atom({ plugin: 'model-router', key: 'isPaneShown' } as const, false)
const tab = atom({ plugin: 'model-router', key: 'tab' } as const, 'resumen')
const days = atom({ plugin: 'model-router', key: 'days' } as const, {})
const sessionTokens = atom({ plugin: 'model-router', key: 'sessionTokens' } as const, emptyTokens())
const limits = atom({ plugin: 'model-router', key: 'limits' } as const, [])
const cost = atom({ plugin: 'model-router', key: 'cost' } as const, null)
const context = atom({ plugin: 'model-router', key: 'context' } as const, null)

const POLICY = [
  'Model routing: the model-router mod is a middleware for every Agent tool call (all agent types except forks and workflow agents).',
  'It picks the subagent model itself from a per-agent base/floor table, the task complexity and the account usage limits, and overrides any `model` you pass.',
  'You do not need to choose `model`; write a clear `description` and prompt. Do not spawn agents just to save tokens.',
].join('\n')

const levelOf = (model: string | undefined): ModelRouterLevel | undefined => {
  const m = (model ?? '').toLowerCase()
  return LEVELS.find(l => m.includes(l))
}

const runningCounts = (list: readonly ModelRouterTask[]) => {
  const running = list.filter(t => t.status === 'running')
  const n = (m: ModelRouterLevel) => running.filter(t => t.model === m).length
  return { haiku: n('haiku'), sonnet: n('sonnet'), opus: n('opus') }
}

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

async function collect($: EngineInterface) {
  const [id, cwd, now, mine, sess, limitsAtom, costAtom, ctxAtom, files] = await Promise.all([
    $.session.id().catch(() => 'sesion'),
    $.session.cwd().catch(() => ''),
    $.clock.now(),
    read($, days),
    read($, sessionTokens),
    read($, limits),
    read($, cost),
    read($, context),
    readUsageFiles($).catch(() => [] as SessionFile[]),
  ])
  let live: Awaited<ReturnType<EngineInterface['session']['usage']>> | undefined
  try {
    live = await $.session.usage()
  } catch {
    live = undefined
  }
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
    sess,
    limits: live?.rateLimits ?? limitsAtom,
    cost: live?.cost?.usd ?? costAtom,
    ctx: live?.context ?? ctxAtom,
  }
}

// Timer: redraws the pane (and flushes the usage file) every REFRESH_MS, only while the
// pane is open. Cancelled at ui.close and session.end; a hot reload drops it with the old
// environment and ui.render starts it again, so it never doubles.
let tick: Timer | undefined
const stopTick = () => {
  tick?.cancel()
  tick = undefined
}
function startTick($: EngineInterface) {
  if (tick !== undefined) return
  tick = $.clock.every(REFRESH_MS, () => {
    $.ui.invalidate('ui.render')
    void flush($, false).catch(() => {})
  })
}

let seq = 0

async function currentLimits($: EngineInterface): Promise<readonly ModelRouterLimit[]> {
  let live: readonly ModelRouterLimit[] = []
  try {
    live = (await $.session.usage()).rateLimits
  } catch {}
  if (live.length > 0) return live
  return read($, limits).catch(() => [] as ModelRouterLimit[])
}

async function refreshStatus($: EngineInterface, override?: readonly ModelRouterLimit[]) {
  const [list, lims, enabled] = await Promise.all([read($, tasks), read($, limits), read($, isEnabled)])
  $.ui.status(statusText(runningCounts(list), override ?? lims, enabled))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'model-router',
      description: 'Open the model router pane; "off" / "on" toggles automatic routing; "usage" shows consumption',
      argumentHint: '[on|off|usage]',
    })
    try {
      const u = await $.session.usage()
      await update($, limits, () => u.rateLimits)
    } catch {}
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
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await update($, isEnabled, () => arg === 'on')
      await refreshStatus($).catch(() => {})
      await $.ui.open({ id: PANE, title: 'Model router' }).catch(() => {})
      return { text: `Model router: enrutado ${arg === 'on' ? 'activo' : 'pausado'}.` }
    }
    if (arg === 'usage') {
      await update($, tab, () => 'consumo' as const)
      await $.ui.open({ id: PANE, title: 'Model router' }).catch(() => {})
      const [c, enabled, list] = await Promise.all([collect($), read($, isEnabled), read($, tasks)])
      return {
        text: textSummary({
          agg: c.agg,
          limits: c.limits,
          now: c.now,
          sessionTotal: Object.values(c.sess.byModel).reduce((s, n) => s + n, 0),
          sessionByModel: c.sess.byModel,
          cost: c.cost,
          enabled,
          running: list.filter(t => t.status === 'running'),
          routeNote: routeNote(c.limits).text,
          ...(c.ctx?.percent !== undefined ? { contextPercent: c.ctx.percent } : {}),
        }),
      }
    }
    await $.ui.open({ id: PANE, title: 'Model router' })
    const enabled = await read($, isEnabled)
    return { text: `Model router: panel abierto (enrutado ${enabled ? 'activo' : 'pausado'}).` }
  }).catch(() => ({ text: 'model-router: error interno, inténtalo de nuevo.' }))

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
    const enabled = await read($, isEnabled)
    const isRouted = enabled && !e.fork && !e.workflow
    const decision = isRouted
      ? route(e.subagentType ?? '', e.description ?? '', e.prompt ?? '', await currentLimits($), e.model)
      : undefined
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
          }
          await update($, tasks, list => [...list.filter(t => t.id !== id), task].slice(-MAX_TASKS))
          await refreshStatus($)
        }
      } catch {}
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      try {
        const input = u.input_tokens
        const output = u.output_tokens
        const cacheRead = u.cache_read_input_tokens ?? 0
        const cacheWrite = u.cache_creation_input_tokens ?? 0
        const total = input + output + cacheRead + cacheWrite
        const bucket = bucketOf(u.model)
        const now = await $.clock.now()
        await update($, sessionTokens, s => ({
          input: s.input + input,
          output: s.output + output,
          cacheRead: s.cacheRead + cacheRead,
          cacheWrite: s.cacheWrite + cacheWrite,
          byModel: { ...s.byModel, [bucket]: s.byModel[bucket] + total },
        }))
        await update($, days, d => addTokens(d, now, bucket, total))
        await flush($, false)
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
        }
      } catch {}
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    try {
      await update($, limits, () => e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, ...(l.resetsAt !== undefined ? { resetsAt: l.resetsAt } : {}) })))
      await update($, cost, () => e.cost?.usd ?? null)
      await update($, context, () => ({
        window: e.context.window,
        ...(e.context.tokens !== undefined ? { tokens: e.context.tokens } : {}),
        ...(e.context.percent !== undefined ? { percent: e.context.percent } : {}),
      }))
      await refreshStatus($, e.rateLimits)
      if (tick !== undefined) $.ui.invalidate('ui.render')
      await flush($, false)
    } catch {}
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    startTick($)
    const els = $.ui.resolve(e)
    const [enabled, view, c, list] = await Promise.all([read($, isEnabled), read($, tab), collect($), read($, tasks)])
    const tabId: TabId = view === 'tareas' || view === 'consumo' ? view : 'resumen'
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
        sess: c.sess,
        agg: c.agg,
        ownId: c.ownId,
        cost: c.cost,
        ctx: c.ctx,
        route: routeNote(c.limits),
      },
      {
        surface: e.surface,
        cols: Math.max(24, e.props.bodyColumns),
        bodyRows: scroll?.bodyRows ?? Math.max(8, rows - 6),
        tab: tabId,
        onTab: t => {
          void update($, tab, () => t)
            .then(refresh)
            .catch(() => {})
        },
        onToggle: () => {
          void update($, isEnabled, v => !v)
            .then(() => refreshStatus($))
            .then(refresh)
            .catch(() => {})
        },
      },
    )
  }).catch(($, e, next) => next(e))
}
