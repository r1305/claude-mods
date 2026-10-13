import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { SessionLinkBoardEntry, SessionLinkMessage, SessionLinkSession } from '../types'
import {
  BEAT_MS,
  POLICY,
  activeOthers,
  addressOf,
  ago,
  asEntries,
  asSession,
  bodyOf,
  boardNotice,
  buildPanel,
  clean,
  fileId,
  lastSegment,
  looksSecret,
  mergeBoard,
  parseJson,
  parseSend,
  parseShare,
  pushMessage,
  resolveDest,
  senderOf,
  short,
  summaryText,
  uniqueName,
  withOwnEntry,
} from './link'
import type { AgentRow, Seg } from './link'

const PANE = 'session-link'
const REFRESH_MS = 15_000

const me = atom({ plugin: 'session-link', key: 'me' } as const, null)
const inbox = atom({ plugin: 'session-link', key: 'inbox' } as const, [])
const outbox = atom({ plugin: 'session-link', key: 'outbox' } as const, [])
const live = atom({ plugin: 'session-link', key: 'live' } as const, false)
const seen = atom({ plugin: 'session-link', key: 'seen' } as const, 0)
const viewed = atom({ plugin: 'session-link', key: 'viewed' } as const, 0)

const HELP = [
  '/link                      abre el panel y muestra esta ayuda',
  '/link who                  sesiones activas y su destino en ListAgents',
  '/link send <destino> <txt> mensaje directo (nombre de ListAgents)',
  '/link share <tema>: <txt>  publica en la pizarra compartida (sin secretos)',
  '/link name <nombre>        cambia la etiqueta de esta sesion',
].join('\n')

// Shared storage: plain files under <config>/session-link, via $.fs, not $.store.
// $.store is documented only as "A JSON file of the plugin's own under the user's Claude
// Code configuration directory" with get/set/delete/keys and a 4 MiB cap for the whole
// store: one file for every key, and nothing says a `get` re-reads it from disk when
// another process wrote it, nor that a `set` does not rewrite the file from this
// process's cached copy. That cannot carry state between two live sessions.
// $.fs is documented to read the file as it stands and to write "the whole new content",
// creating directories as needed. So each session writes ONLY its own files:
//   sessions/<id>.json  its presence (heartbeat; emptied at session.end)
//   board/<id>.json     the entries it published (last 100, 7 days; pruned by its owner only)
// and readers list the folders and merge. No file has two writers, so there is no
// read-modify-write between sessions and nothing one session writes can drop another's data.
// Other sessions' dead files are never written: a presence silent for 20 min and a board
// entry older than 7 days are ignored on read. $.fs has no delete, so a session's own files
// stay as empty files after it ends; a torn read (no atomic write is promised) parses as
// nothing and is skipped.
async function storeDir($: EngineInterface) {
  const cfg = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const base = cfg !== undefined && cfg !== '' ? cfg : `${home}/.claude`
  return `${base.replace(/\\/g, '/').replace(/\/+$/, '')}/session-link`
}

type Loaded<T> = { file: string; value: T }

async function loadFolder($: EngineInterface, dir: string): Promise<Loaded<unknown>[]> {
  const entries = await $.fs.list(dir).catch(() => [])
  const files = entries.filter(f => f.kind === 'file' && f.name.endsWith('.json'))
  return Promise.all(
    files.map(async f => {
      const file = `${dir}/${f.name}`
      const text = await $.fs.read(file).then(t => (typeof t === 'string' ? t : ''), () => '')
      return { file, value: parseJson(text) }
    }),
  )
}

async function readSessions($: EngineInterface) {
  const rows = await loadFolder($, `${await storeDir($)}/sessions`)
  return rows.map(r => ({ ...r, value: asSession(r.value) }))
}

async function readBoardFiles($: EngineInterface) {
  const rows = await loadFolder($, `${await storeDir($)}/board`)
  return rows.map(r => ({ ...r, value: asEntries(r.value) }))
}

async function readBoard($: EngineInterface) {
  const [files, now] = await Promise.all([readBoardFiles($), $.clock.now()])
  return mergeBoard(files.map(f => f.value), now)
}

const liveSessions = (rows: Loaded<SessionLinkSession | undefined>[]) =>
  rows.flatMap(r => (r.value ? [r.value] : []))

/** ListAgents rows usable as `/link send` destinations; [] if the call fails. */
async function agentRows($: EngineInterface): Promise<AgentRow[]> {
  try {
    const out = await $.tool.call({ tool: 'ListAgents' })
    if (out.deny !== undefined || out.isError === true) return []
    const r = out.result as { sections?: { rows?: { name?: string; id?: string }[] }[] } | undefined
    const rows = (r?.sections ?? []).flatMap(s => s.rows ?? [])
    const seenNames = new Set<string>()
    const list: AgentRow[] = []
    for (const x of rows) {
      const name = x.name ?? ''
      if (name === '' || seenNames.has(name)) continue
      seenNames.add(name)
      list.push(x.id !== undefined ? { name, id: x.id } : { name })
    }
    return list
  } catch {
    return []
  }
}

/**
 * This session's identity; with `write`, its presence file too (at most once per
 * BEAT_MS unless `force`), and only once session.start saw an interactive session.
 * State reads of one dispatch see the moment it began, so session.start passes `isLive`.
 */
async function heartbeat($: EngineInterface, opts: { name?: string; force?: boolean; isLive?: boolean } = {}): Promise<SessionLinkSession> {
  const [id, cwd, now, prev, wasLive] = await Promise.all([
    $.session.id(),
    $.session.cwd(),
    $.clock.now(),
    read($, me),
    read($, live),
  ])
  const isLive = opts.isLive ?? wasLive
  const mine = prev !== null && prev.id === id ? prev : undefined
  const isDue = opts.force === true || opts.name !== undefined || mine === undefined || now - mine.lastSeen >= BEAT_MS
  if (!isDue && mine) return mine
  const project = clean(lastSegment(cwd), 'sesion')
  const rows = isLive ? await readSessions($) : []
  const others = activeOthers(liveSessions(rows), id, now)
  const ownFile = liveSessions(rows).find(s => s.id === id)
  const name = opts.name ?? mine?.name ?? ownFile?.name ?? uniqueName(project, id, others)
  const self: SessionLinkSession = { id, name, project, cwd, lastSeen: now }
  await update($, me, () => self)
  if (!isLive) return self
  await $.fs.write(`${await storeDir($)}/sessions/${fileId(id)}.json`, JSON.stringify(self))
  return self
}

async function publish($: EngineInterface, entry: SessionLinkBoardEntry) {
  const dir = `${await storeDir($)}/board`
  const files = await readBoardFiles($)
  const ownPath = `${dir}/${fileId(entry.sid)}.json`
  const own = files.find(f => f.file === ownPath)?.value ?? []
  await $.fs.write(ownPath, JSON.stringify(withOwnEntry(own, entry, entry.at)))
}

async function leave($: EngineInterface) {
  if (!(await read($, live))) return
  const id = await $.session.id()
  await $.fs.write(`${await storeDir($)}/sessions/${fileId(id)}.json`, '')
}

// Timers: `beat` keeps presence fresh while the session is live (cancelled at session.end);
// `tick` redraws the pane only while it is open (cancelled at ui.close and session.end).
// The handles live in this module, so a hot reload drops them while the live flag in the
// plugin state survives: session.start, turn.start and ui.render re-arm them. startBeat and
// startTick do nothing when their timer already runs.
let beat: Timer | undefined
let tick: Timer | undefined
const stopTimers = () => {
  beat?.cancel()
  beat = undefined
  tick?.cancel()
  tick = undefined
}
const stopTick = () => {
  tick?.cancel()
  tick = undefined
}

function startBeat($: EngineInterface) {
  if (beat !== undefined) return
  beat = $.clock.every(BEAT_MS, () => {
    void heartbeat($).catch(() => {})
  })
}

function startTick($: EngineInterface) {
  if (tick !== undefined) return
  tick = $.clock.every(REFRESH_MS, () => {
    $.ui.invalidate('ui.render')
  })
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'Sesiones' })
  startTick($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'link',
      description: 'Sesiones paralelas: panel, pizarra compartida y mensajes (who | send | share | name)',
      argumentHint: '[who|send <destino> <texto>|share <tema>: <texto>|name <nombre>]',
    })
    if (e.isInteractive && e.surface !== null) {
      await update($, live, () => true)
      const now = await $.clock.now()
      await update($, seen, v => (v > 0 ? v : now))
      try {
        await heartbeat($, { force: true, isLive: true })
      } catch {}
      startBeat($)
      openPane($).catch(() => {})
    } else {
      await update($, live, () => false)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    stopTimers()
    try {
      await leave($)
    } catch {
      // presence is best effort
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      stopTick()
    }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'link' }, async ($, e) => {
    const m = /^(\S*)\s*([\s\S]*)$/.exec(e.args.trim())
    const sub = (m?.[1] ?? '').toLowerCase()
    const rest = (m?.[2] ?? '').trim()

    if (sub === 'name') {
      if (rest === '') return { text: 'Uso: /link name <nombre>' }
      const renamed = await heartbeat($, { name: clean(rest, 'sesion') })
      return { text: `Esta sesion ahora se etiqueta "${renamed.name}" (solo etiqueta; el destino de SendMessage es el nombre de ListAgents).` }
    }

    const self = await heartbeat($)
    const now = await $.clock.now()

    if (sub === 'share') {
      const { topic, text } = parseShare(rest)
      if (text === '') return { text: 'Uso: /link share <tema>: <texto>' }
      if (looksSecret(`${topic} ${text}`)) {
        return { text: 'No publicado: el texto parece contener un secreto (clave, token, password o cadena de alta entropia). La pizarra es legible por todas las sesiones.' }
      }
      await publish($, { id: `${now.toString(36)}-${fileId(self.id).slice(0, 4)}`, sid: self.id, from: self.name, project: self.project, topic, text, at: now })
      $.ui.invalidate('ui.render')
      return { text: `Publicado en la pizarra: [${topic}] ${short(text, 80)}` }
    }

    if (sub === 'send') {
      const parsed = parseSend(rest)
      if (parsed === undefined) return { text: 'Uso: /link send <destino> <texto>' }
      const [rows, sessions] = await Promise.all([agentRows($), readSessions($)])
      const dest = resolveDest(parsed.to, rows, activeOthers(liveSessions(sessions), self.id, now))
      if ('error' in dest) return { text: dest.error }
      try {
        const sent = await $.session.send({ to: dest.to, text: parsed.text })
        return { text: sent.isDelivered ? `Enviado a ${dest.to}.` : `No enviado a ${dest.to}: ${sent.reason}` }
      } catch (err) {
        return { text: `No enviado a ${dest.to}: ${err instanceof Error ? err.message : 'error'}` }
      }
    }

    if (sub === 'who') {
      const [sessions, rows] = await Promise.all([readSessions($), agentRows($)])
      const others = activeOthers(liveSessions(sessions), self.id, now)
      const lines = [
        `* ${self.name} (${self.project}) - esta sesion`,
        ...others.map(s => {
          const to = addressOf(s, rows)
          return `* ${s.name} (${s.project}) - ${ago(now, s.lastSeen)} - destino: ${to ?? 'ver ListAgents'}`
        }),
      ]
      lines.push(
        rows.length > 0
          ? `Destinos para /link send (ListAgents): ${rows.map(r => r.name).join(', ')}`
          : 'ListAgents no devolvio destinos (o no es invocable desde el mod).',
      )
      return { text: lines.join('\n') }
    }

    openPane($).catch(() => {})
    const [sessions, board, inList, outList] = await Promise.all([readSessions($), readBoard($), read($, inbox), read($, outbox)])
    const others = activeOthers(liveSessions(sessions), self.id, now)
    const viewedAt = await read($, viewed)
    const summary = summaryText({ self, others, inbox: inList, outbox: outList, board, now, viewedAt })
    await update($, viewed, () => now)
    return { text: `Panel abierto. Esta sesion: ${self.name}.
${summary}
${HELP}` }
  }).catch(() => ({ text: 'session-link: error interno (el comando no se ejecuto).' }))

  on('session.receive', async ($, e, next) => {
    const o = e.origin
    if (e.agentId === undefined && (o.kind === 'peer' || o.kind === 'peer-send-message')) {
      try {
        const from = senderOf(e.text, 'teammate' in o ? o.teammate : undefined)
        const msg: SessionLinkMessage = { peer: from, text: short(bodyOf(e.text), 200), at: await $.clock.now() }
        await update($, inbox, list => pushMessage(list, msg))
        $.ui.toast(`Sesiones: mensaje de ${from}: ${short(msg.text, 70)}`)
      } catch {
        // observing must never change the delivery
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.send', async ($, e, next) => {
    const out = await next(e)
    if (e.agentId !== undefined) return out
    try {
      const msg: SessionLinkMessage = {
        peer: short(e.to, 60),
        text: short(e.text, 200),
        at: await $.clock.now(),
        isDelivered: out.isDelivered,
      }
      await update($, outbox, list => pushMessage(list, msg))
    } catch {
      // observing must never change the send
    }
    return out
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    return { sections: [...out.sections, { id: 'session-link:policy', text: POLICY, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const out = await next(e)
    try {
      if (!(await read($, live))) return out
      startBeat($)
      const [id, board, last] = await Promise.all([$.session.id(), readBoard($), read($, seen)])
      const fresh = board.filter(b => b.sid !== id && b.at > last)
      if (fresh.length === 0) return out
      await update($, seen, () => Math.max(last, ...fresh.map(b => b.at)))
      await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: boardNotice(fresh) }] } })
    } catch {
      // the notice is optional
    }
    return out
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    startTick($)
    if (await read($, live)) startBeat($)
    const { Box, Text, Button } = $.ui.resolve(e)
    const [self, inList, outList, sessions, board, now, viewedAt] = await Promise.all([
      read($, me),
      read($, inbox),
      read($, outbox),
      readSessions($),
      readBoard($),
      $.clock.now(),
      read($, viewed),
    ])
    const others = activeOthers(liveSessions(sessions), self?.id ?? '', now)
    const lines = buildPanel({
      ...(self ? { self } : {}),
      others,
      inbox: inList,
      outbox: outList,
      board,
      now,
      cols: e.props.bodyColumns - 3,
      rows: e.viewport?.rows ?? 24,
      emoji: e.surface !== 'terminal',
      viewedAt,
    })
    if (e.props.isFocused && inList.some(m => m.at > viewedAt)) {
      try {
        await update($, viewed, () => now)
      } catch {
        // the unread counter is cosmetic
      }
    }
    const styled = (s: Seg, i: number) => (
      <Text key={String(i)} {...(s.color !== undefined ? { color: s.color } : {})} {...(s.bold ? { bold: true } : {})} {...(s.dim ? { dimColor: true } : {})}>
        {s.t}
      </Text>
    )
    const head = lines.slice(0, 1)
    const body = lines.slice(1)
    const row = (l: { key: string; segs: Seg[] }) => (
      <Text key={l.key} wrap="truncate">
        {l.segs.map(styled)}
      </Text>
    )
    const names = [self, ...others].flatMap(s => (s ? [s.name] : []))

    return (
      <Box flexDirection="column">
        {head.map(row)}
        <Box gap={1}>
          <Button hotkey="r" onPress={() => $.ui.invalidate('ui.render')}>
            Refrescar
          </Button>
          <Button hotkey="w" onPress={() => $.ui.toast(`Sesiones activas: ${names.join(', ') || 'ninguna'}`, { timeoutMs: 6000 })}>
            Who
          </Button>
        </Box>
        {body.map(row)}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
