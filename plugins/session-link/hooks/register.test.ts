import type { On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { allocate, bar, buildPanel, cells, looksSecret, parseSend, parseShare, presenceOf, senderOf, summaryText, toText } from './link'
import type { PanelInput } from './link'

const PANE = {
  plugin: 'session-link',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'session-link',
  props: { title: 'Sesiones', isFocused: false, bodyColumns: 70, placement: 'inline' },
} as never

const DIR = '/cfg/session-link'
type Env = { id: string; cwd: string }
type Files = Map<string, string>

/** A shared file system beneath the plugin, as two processes on one machine see it. */
const disk = (seed: Record<string, unknown> = {}): Files =>
  new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]))

/** The engine side beneath the plugin: identity, files, UI and registration answers. */
/** The engine hands hooks resolved paths (`C:\cfg\...` on Windows); the fake disk keys them as `/cfg/...`. */
const key = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

const world = (on: On, env: Env, files: Files = disk(), failSessionWrite = false) => {
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg' })
  on('fs.read', (_$, e) => {
    const text = files.get(key(e.path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text } as never
  })
  let failing = failSessionWrite
  on('fs.write', (_$, e) => {
    if (failing && key(e.path).includes('/sessions/')) {
      failing = false
      throw new Error('EBUSY')
    }
    files.set(key(e.path), e.text)
    return { value: undefined } as never
  })
  on('fs.list', (_$, e) => {
    const prefix = `${key(e.path)}/`
    const names = [...files.keys()].filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
    if (names.length === 0) throw new Error('ENOENT')
    return { value: names.map(k => ({ name: k.slice(prefix.length), kind: 'file', size: files.get(k)?.length ?? 0, mtimeMs: 0, isLink: false })) } as never
  })
  const toasts: string[] = []
  const sent: { to: string; text: string }[] = []
  on('session.id', () => ({ value: env.id }) as never)
  on('session.cwd', () => ({ value: env.cwd }) as never)
  on('session.end', () => ({ sessionId: env.id }) as never)
  const queued: string[] = []
  on('session.receive', (_$, e) => {
    queued.push(e.text)
    return { text: e.text } as never
  })
  on('command.register', () => ({ value: { command: 'link' } }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  const counts = { invalidations: 0, opened: 0 }
  on('ui.open', () => {
    counts.opened++
    return { value: { isPlaced: true } } as never
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('ui.invalidate', () => {
    counts.invalidations++
    return { value: undefined } as never
  })
  on('ui.toast', (_$, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('tool.call', { tool: 'ListAgents' }, () => ({
    result: { listing: '', sections: [{ kind: 'peers', total: 1, rows: [{ name: 'proyecto-b-session', id: 'cccc3333' }] }] },
  }) as never)
  on('session.send', (_$, e) => {
    sent.push({ to: e.to, text: e.text })
    return { isDelivered: true } as never
  })
  const json = (path: string) => {
    const t = files.get(path)
    return t === undefined || t === '' ? t : JSON.parse(t)
  }
  return { toasts, sent, counts, files, queued, json }
}

const start = ($: Engine, cwd: string, isInteractive = true) =>
  $.session.start({ cwd, surface: isInteractive ? 'terminal' : null, isInteractive } as never)

const run = ($: Engine, args: string) => $.command.run({ command: 'link', args } as never)

test('parsers, sender and secret detection', () => {
  expect(parseShare('api: GET /pedidos devuelve {id}')).toEqual({ topic: 'api', text: 'GET /pedidos devuelve {id}' })
  expect(parseShare('sin tema')).toEqual({ topic: 'general', text: 'sin tema' })
  expect(parseShare('https://x.test/a mira esto')).toEqual({ topic: 'general', text: 'https://x.test/a mira esto' })
  expect(parseShare('a<b>{c}: hola').topic).toBe('abc')
  expect(parseSend('proyecto-b hola que tal')).toEqual({ to: 'proyecto-b', text: 'hola que tal' })
  expect(parseSend('solo')).toBeUndefined()
  expect(senderOf('<cross-session-message from="proyecto-b [ab12]">hola</cross-session-message>')).toBe('proyecto-b ab12')
  expect(senderOf('hola')).toBe('peer')
  for (const s of ['sk-abcdefghijkl', 'AKIAABCDEFGHIJKLMNOP', 'DB_PASS=x', 'password: x', 'token=abc', '-----BEGIN KEY', 'qZ8vK2mN9pL4xR7tW1yB6cD3fG5hJ0sA']) {
    expect(looksSecret(s)).toBe(true)
  }
  expect(looksSecret('GET /v2/pedidos devuelve {id, total} y la tabla pedidos_detalle')).toBe(false)
})

test('share writes only this session own board file and the panel shows it', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const w = world(on, { id: 'aaaa1111', cwd: 'D:\\work\\proyecto-a' })
  await start($, 'D:\\work\\proyecto-a')

  const out = await run($, 'share api: GET /pedidos devuelve {id}')
  expect(out.text).toContain('Publicado')
  expect(w.json(`${DIR}/board/aaaa1111.json`)).toMatchObject([
    { sid: 'aaaa1111', from: 'proyecto-a', project: 'proyecto-a', topic: 'api', text: 'GET /pedidos devuelve {id}' },
  ])
  expect(w.json(`${DIR}/sessions/aaaa1111.json`)).toMatchObject({ id: 'aaaa1111', name: 'proyecto-a', project: 'proyecto-a' })

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /api.*GET \/pedidos.*proyecto-a/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /★ proyecto-a · proyecto-a/ })).toBeDefined()
})

test('share refuses text that looks like a secret', async ($, on) => {
  mock.clock(on, { now: 5 })
  const w = world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' })
  await start($, '/w/proyecto-a')
  const out = await run($, 'share db: DB_PASS=hunter2')
  expect(out.text).toContain('No publicado')
  expect(w.files.has(`${DIR}/board/aaaa1111.json`)).toBe(false)
})

test('own board file keeps 100 entries and drops those older than 7 days', async ($, on) => {
  const now = 8 * 24 * 3600 * 1000
  mock.clock(on, { now })
  const old = Array.from({ length: 100 }, (_, i) => ({ id: `o${i}`, sid: 'aaaa1111', from: 'x', project: 'p', topic: 't', text: `n${i}`, at: now - 1000 + i }))
  const expired = [{ id: 'e', sid: 'zzzz', from: 'z', project: 'z', topic: 't', text: 'viejo', at: 1 }]
  const w = world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' }, disk({ [`${DIR}/board/aaaa1111.json`]: old, [`${DIR}/board/zzzz.json`]: expired }))
  await start($, '/w/proyecto-a')
  await run($, 'share t: nueva')
  const board = w.json(`${DIR}/board/aaaa1111.json`) as { text: string }[]
  expect(board).toHaveLength(100)
  expect(board[board.length - 1]?.text).toBe('nueva')
  expect(board[0]?.text).toBe('n1')
  expect(w.files.get(`${DIR}/board/zzzz.json`)).toBe(JSON.stringify(expired))
})

test('two sessions sharing one disk: share, heartbeat and close never clobber each other', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const files = disk()
  const env = { id: 'aaaa1111', cwd: '/w/proyecto-a' }
  const w = world(on, env, files)

  await start($, '/w/proyecto-a')
  await run($, 'share api: POST /pedidos {id,total}')

  env.id = 'bbbb2222'
  env.cwd = '/w/proyecto-b'
  await start($, '/w/proyecto-b')
  const who = await run($, 'who')
  expect(who.text).toContain('proyecto-a (proyecto-a)')
  await run($, 'share esquema: tabla clientes(id,ruc)')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /api.*POST \/pedidos/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /esquema.*tabla clientes/ })).toBeDefined()

  await clock.advance(61_000)
  expect(w.json(`${DIR}/board/aaaa1111.json`)).toMatchObject([{ topic: 'api' }])
  expect(w.json(`${DIR}/sessions/aaaa1111.json`)).toMatchObject({ id: 'aaaa1111' })

  env.id = 'aaaa1111'
  env.cwd = '/w/proyecto-a'
  await $.session.end({ reason: 'other' } as never)
  expect(files.get(`${DIR}/sessions/aaaa1111.json`)).toBe('')

  env.id = 'bbbb2222'
  env.cwd = '/w/proyecto-b'
  await clock.advance(61_000)
  await run($, 'who')
  expect(files.get(`${DIR}/sessions/aaaa1111.json`)).toBe('')
  expect(w.json(`${DIR}/sessions/bbbb2222.json`)).toMatchObject({ id: 'bbbb2222', name: 'proyecto-b' })
  expect(w.json(`${DIR}/board/aaaa1111.json`)).toMatchObject([{ topic: 'api' }])
})

test('a default name already used by an active session gets a short id suffix', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  const w = world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' }, disk({
    [`${DIR}/sessions/cccc3333.json`]: { id: 'cccc3333', name: 'proyecto-a', project: 'proyecto-a', cwd: '/w/proyecto-a', lastSeen: 99_000 },
  }))
  await start($, '/w/proyecto-a')
  expect(w.json(`${DIR}/sessions/aaaa1111.json`)).toMatchObject({ name: 'proyecto-a-aaaa' })
})

test('a non-interactive session registers no presence and opens no pane', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' })
  await start($, '/w/proyecto-a', false)
  await clock.advance(120_000)
  expect(w.files.size).toBe(0)
  expect(w.counts.opened).toBe(0)
})

test('peer delivery: sender from the envelope, logged in the inbox, passed through unchanged', async ($, on) => {
  mock.clock(on, { now: 10 })
  const w = world(on, { id: 'bbbb2222', cwd: '/w/proyecto-b' })
  await start($, '/w/proyecto-b')

  const text = '<cross-session-message from="proyecto-a">el endpoint cambio a /v2/pedidos</cross-session-message>'
  const res = await $.session.receive({ origin: { kind: 'peer', plugin: 'session-link' }, text } as never)

  expect(res).toEqual({ text })
  expect(w.queued).toEqual([text])
  expect(w.toasts[0]).toContain('proyecto-a')
  expect(w.toasts[0]).not.toContain('session-link:')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /<- proyecto-a \d\d:\d\d  el endpoint cambio a \/v2\/pedidos/ })).toBeDefined()
})

test('a delivery without envelope is from "peer"; non-peer and subagent deliveries are not logged', async ($, on) => {
  mock.clock(on)
  const w = world(on, { id: 'bbbb2222', cwd: '/w/proyecto-b' })
  await start($, '/w/proyecto-b')
  await $.session.receive({ origin: { kind: 'peer', plugin: 'session-link' }, text: 'hola' } as never)
  expect(w.toasts[0]).toContain('mensaje de peer')
  await $.session.receive({ origin: { kind: 'task-notification' }, text: 'ci ok' } as never)
  await $.session.receive({ origin: { kind: 'peer' }, text: 'interno', agentId: 'sub1' } as never)
  expect(w.toasts).toHaveLength(1)
  expect(w.queued).toEqual(['hola', 'ci ok', 'interno'])
})

test('/link send goes through session.send once and records exactly one outbox row', async ($, on) => {
  mock.clock(on, { now: 20 })
  const w = world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' })
  await start($, '/w/proyecto-a')

  const out = await run($, 'send proyecto-b-session el esquema tiene columna nueva')
  expect(out.text).toContain('Enviado a proyecto-b-session')
  expect(w.sent).toEqual([{ to: 'proyecto-b-session', text: 'el esquema tiene columna nueva' }])
  const ui = await $.ui.mount(PANE)
  const rows = await ui.findAll({ type: 'Text', text: /-> proyecto-b-session \d\d:\d\d  el esquema tiene columna nueva/ })
  expect(rows).toHaveLength(1)

  const usage = await run($, 'send proyecto-b')
  expect(usage.text).toContain('Uso:')
})

test('/link send resolves a mod label to its ListAgents name, or explains why not', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  const w = world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' }, disk({
    [`${DIR}/sessions/cccc3333.json`]: { id: 'cccc3333', name: 'proyecto-b', project: 'proyecto-b', cwd: '/w/proyecto-b', lastSeen: 99_000 },
    [`${DIR}/sessions/dddd4444.json`]: { id: 'dddd4444', name: 'web', project: 'web', cwd: '/w/web', lastSeen: 99_000 },
  }))
  await start($, '/w/proyecto-a')
  const ok = await run($, 'send proyecto-b hola')
  expect(ok.text).toContain('Enviado a proyecto-b-session')
  const bad = await run($, 'send web hola')
  expect(bad.text).toContain('sin destino en ListAgents')
  expect(w.sent).toEqual([{ to: 'proyecto-b-session', text: 'hola' }])
})

test('a model SendMessage lands in the outbox; a subagent send does not', async ($, on) => {
  mock.clock(on, { now: 30 })
  world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' })
  await start($, '/w/proyecto-a')
  const res = await $.session.send({ to: 'proyecto-b', text: 'hola', origin: { kind: 'model' } } as never)
  expect(res).toEqual({ isDelivered: true })
  await $.session.send({ to: 'proyecto-b', text: 'de subagente', origin: { kind: 'model' }, agentId: 'sub1' } as never)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /-> proyecto-b \d\d:\d\d  hola/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /de subagente/ })).toHaveLength(0)
})

test('who shows active peers with their ListAgents destination', async ($, on) => {
  mock.clock(on, { now: 100_000_000 })
  const w = world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' }, disk({
    [`${DIR}/sessions/cccc3333.json`]: { id: 'cccc3333', name: 'proyecto-b', project: 'proyecto-b', cwd: '/w/proyecto-b', lastSeen: 99_990_000 },
    [`${DIR}/sessions/dddd4444.json`]: { id: 'dddd4444', name: 'viejo', project: 'old', cwd: '/w/old', lastSeen: 1 },
    [`${DIR}/sessions/broken.json`]: { name: 'sin id' },
  }))
  await start($, '/w/proyecto-a')
  const out = await run($, 'who')
  expect(out.text).toContain('proyecto-b (proyecto-b)')
  expect(out.text).toContain('destino: proyecto-b-session')
  expect(out.text).not.toContain('viejo')
  expect(out.text).not.toContain('sin id')
  expect(out.text).toContain('ListAgents): proyecto-b-session')
  expect(w.files.get(`${DIR}/sessions/dddd4444.json`)).toContain('"viejo"')
})

test('prompt.compose adds the same fixed section whatever the shared state', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  const files = disk({
    [`${DIR}/sessions/cccc3333.json`]: { id: 'cccc3333', name: 'proyecto-b', project: 'proyecto-b', cwd: '/w/proyecto-b', lastSeen: 99_000 },
  })
  world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' }, files)
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'x', scope: 'shared' }] }) as never)
  await start($, '/w/proyecto-a')
  const input = { model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never
  const first = (await $.prompt.compose(input)).sections.find(s => s.id === 'session-link:policy')
  await run($, 'share esquema: tabla nueva')
  files.set(`${DIR}/sessions/eeee5555.json`, JSON.stringify({ id: 'eeee5555', name: 'otra', project: 'otra', cwd: '/w/o', lastSeen: 99_500 }))
  const second = (await $.prompt.compose(input)).sections.find(s => s.id === 'session-link:policy')
  expect(first?.scope).toBe('session')
  expect(second).toEqual(first)
  expect(first?.text).toContain('ListAgents')
  expect(first?.text).not.toContain('proyecto-b')
})

test('turn.start appends one line only when other sessions posted new board entries', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const files = disk()
  world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' }, files)
  const session = mock.session(on)
  await start($, '/w/proyecto-a')
  await $.turn.start({ text: 'hola', turnId: 't1' } as never)
  expect(session.appended()).toHaveLength(0)

  await clock.advance(1_000)
  files.set(`${DIR}/board/cccc3333.json`, JSON.stringify([{ id: 'x', sid: 'cccc3333', from: 'proyecto-b', project: 'proyecto-b', topic: 'esquema', text: 'tabla', at: 1_500 }]))
  await $.turn.start({ text: 'sigue', turnId: 't2' } as never)
  await $.turn.start({ text: 'otra', turnId: 't3' } as never)
  const rows = session.appended()
  expect(rows).toHaveLength(1)
  expect(JSON.stringify(rows[0]?.message)).toContain('proyecto-b/esquema')
})

test('heartbeat runs every minute independent of the pane; timers stop at session.end', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' })
  await start($, '/w/proyecto-a')
  await clock.advance(61_000)
  expect(w.json(`${DIR}/sessions/aaaa1111.json`)).toMatchObject({ lastSeen: 60_000 })

  await $.session.end({ reason: 'other' } as never)
  const before = w.counts.invalidations
  await clock.advance(180_000)
  expect(w.counts.invalidations).toBe(before)
  expect(w.files.get(`${DIR}/sessions/aaaa1111.json`)).toBe('')
})

// A hot reload leaves the live flag in the plugin state but drops the module's timers.
// session.end cancels the same timers and keeps the flag, so it stands in for the reload here.
test('after a hot reload a turn re-arms the presence beat', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' })
  await start($, '/w/proyecto-a')
  await $.session.end({ reason: 'other' } as never)
  await $.turn.start({ text: 'hola', turnId: 't1' } as never)
  await clock.advance(61_000)
  expect(w.json(`${DIR}/sessions/aaaa1111.json`)).toMatchObject({ id: 'aaaa1111', lastSeen: 60_000 })
})

test('after a hot reload a render re-arms the presence beat', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' })
  await start($, '/w/proyecto-a')
  await $.session.end({ reason: 'other' } as never)
  await $.ui.mount(PANE)
  await clock.advance(61_000)
  expect(w.json(`${DIR}/sessions/aaaa1111.json`)).toMatchObject({ id: 'aaaa1111', lastSeen: 60_000 })
})

test('a non-interactive session does not arm the beat on turn or render', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' })
  await start($, '/w/proyecto-a', false)
  await $.turn.start({ text: 'hola', turnId: 't1' } as never)
  await $.ui.mount(PANE)
  await clock.advance(180_000)
  expect(w.files.size).toBe(0)
})

test('the pane redraws every 15 s while open', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' })
  await start($, '/w/proyecto-a')
  await clock.advance(15_000)
  expect(w.counts.invalidations).toBeGreaterThan(0)
})

const NOW = 100_000_000
const mk = (id: string, name: string, ageMs: number) => ({ id, name, project: name, cwd: `/w/${name}`, lastSeen: NOW - ageMs })
const entry = (id: string, sid: string, from: string, project: string, topic: string, text: string, ageMs: number) => ({ id, sid, from, project, topic, text, at: NOW - ageMs })

const FULL: PanelInput = {
  self: mk('aaaa1111', 'proyecto-a', 10_000),
  others: [mk('cccc3333', 'proyecto-b', 60_000), mk('dddd4444', 'web', 5 * 60_000), mk('eeee5555', 'viejo', 15 * 60_000)],
  inbox: [{ peer: 'proyecto-b', text: 'el endpoint cambio a /v2/pedidos', at: NOW - 120_000 }, { peer: 'web', text: 'listo el front', at: NOW - 60_000 }],
  outbox: [{ peer: 'proyecto-b-session', text: 'ok, lo uso', at: NOW - 30_000, isDelivered: true }],
  board: [
    entry('b1', 'aaaa1111', 'proyecto-a', 'proyecto-a', 'api', 'GET /pedidos devuelve {id}', 3_600_000),
    entry('b2', 'aaaa1111', 'proyecto-a', 'proyecto-a', 'esquema', 'tabla clientes', 1_800_000),
    entry('b3', 'cccc3333', 'proyecto-b', 'proyecto-b', 'deploy', 'sube a las 5', 600_000),
    entry('b4', 'dddd4444', 'web', 'web', 'ui', 'nuevo layout', 300_000),
  ],
  now: NOW,
  cols: 67,
  rows: 30,
  emoji: false,
  viewedAt: 0,
}

const widthOf = (l: { segs: { t: string }[] }) => l.segs.reduce((n, s) => n + cells(s.t), 0)

test('panel model: header, presence, activity bars with percentages, messages and grouped board', () => {
  const lines = buildPanel(FULL)
  const text = toText(lines)
  expect(lines[0] && toText([lines[0]])).toBe('● 4 activas  <- 2 recib. (2 nuevos)  -> 1 env.  ▪ 4 pizarra')
  // activity: proyecto-a 2 posts + 3 messages = 5 of 7 (71%); proyecto-b 1 (14%); web 1 (14%); viejo 0 (0%)
  const row = (name: string) => toText(lines.filter(l => l.key.startsWith('s:') && l.segs.some(s => s.t === name)))
  expect(row('proyecto-a')).toContain('★')
  expect(row('proyecto-a')).toContain(`${bar(0.71, 10)}  71%`)
  expect(row('proyecto-b')).toContain(`${bar(0.14, 10)}  14%`)
  expect(row('viejo')).toContain(`${bar(0, 10)}   0%`)
  expect(row('viejo')).toContain('hace 15 min')
  const dot = (name: string) => lines.find(l => l.key.startsWith('s:') && l.segs.some(s => s.t === name))?.segs[0]
  expect(dot('proyecto-a')?.color).toBe('success')
  expect(dot('web')?.color).toBe('warning')
  expect(dot('viejo')?.color).toBe('inactive')
  expect(presenceOf(NOW, NOW - 119_000)).toBe('live')
  expect(presenceOf(NOW, NOW - 121_000)).toBe('recent')
  expect(presenceOf(NOW, NOW - 601_000)).toBe('idle')
  expect(text).toMatch(/<- proyecto-b \d\d:\d\d {2}el endpoint cambio a \/v2\/pedidos/)
  expect(text).toMatch(/-> proyecto-b-session \d\d:\d\d {2}ok, lo uso/)
  expect(text).toContain('Mensajes (3) 2 sin leer')
  // board grouped by project, bar and percent per project (proyecto-a 2 of 4 = 50%)
  expect(text).toMatch(/▪ proyecto-a +█████░░░░░ {2}2 {2}50%/)
  expect(text).toMatch(/▪ proyecto-b +███░░░░░░░ {2}1 {2}25%/)
  expect(text).toMatch(/ {2}api GET \/pedidos devuelve \{id\} · proyecto-a · hace 1 h/)
  for (const l of lines) expect(widthOf(l)).toBeLessThanOrEqual(67)
})

test('panel model: emoji set for surfaces that draw it; read messages are not unread', () => {
  const lines = buildPanel({ ...FULL, emoji: true, viewedAt: NOW })
  const text = toText(lines)
  expect(text).toContain('🟢 4 activas  📨 2 recib.  📤 1 env.  📌 4 pizarra')
  expect(text).not.toContain('nuevos')
  expect(text).not.toContain('sin leer')
  expect(text).toContain('🟡')
  expect(text).toContain('⚪')
  expect(text).toContain('⬅ proyecto-b')
  expect(text).toContain('➡ proyecto-b-session')
  expect(text).toContain('📌 proyecto-a')
  for (const l of lines) expect(widthOf(l)).toBeLessThanOrEqual(67)
})

test('panel model: wide viewport spells the header out', () => {
  const head = toText(buildPanel({ ...FULL, cols: 100 }).slice(0, 1))
  expect(head).toBe('● 4 sesiones activas  <- 2 recibidos (2 nuevos)  -> 1 enviados  ▪ 4 en pizarra')
})

test('panel model: empty states carry an icon and the command to start', () => {
  const text = toText(buildPanel({ ...FULL, self: undefined, others: [], inbox: [], outbox: [], board: [], emoji: true }))
  expect(text).toContain('💤 Ninguna sesion registrada')
  expect(text).toContain('💬 Sin mensajes. /link send <destino> <texto>')
  expect(text).toContain('📭 Pizarra vacia. /link share tema: texto')
  expect(text).toContain('🟢 0 activas')
})

test('panel model: narrow widths and short viewports keep every line inside the width and the rows inside the budget', () => {
  for (const cols of [20, 27, 40, 55]) {
    const lines = buildPanel({ ...FULL, cols, rows: 14 })
    for (const l of lines) expect(widthOf(l)).toBeLessThanOrEqual(Math.max(20, cols))
    expect(lines.length).toBeLessThanOrEqual(1 + 3 + Math.max(3, 14 - 4 - 5))
  }
  expect(toText(buildPanel({ ...FULL, cols: 40, rows: 14 }))).toMatch(/… \+\d+ mas/)
  expect(allocate(15, [3, 3, 30]).reduce((a, b) => a + b, 0)).toBe(15)
  expect(allocate(15, [1, 1, 1])).toEqual([1, 1, 1])
  expect(allocate(3, [9, 9, 9])).toEqual([1, 1, 1])
  expect(allocate(10, [5, 5, 5]).every(n => n >= 1)).toBe(true)
})

test('/link summary uses the same icons as the panel', () => {
  const text = summaryText({ ...FULL })
  expect(text).toContain('● 4 activas')
  expect(text).toContain('★ proyecto-a')
  expect(text).toContain('71%')
})

const mountWith = async ($: Engine, on: On, width: number, surface: 'terminal' | 'desktop') => {
  world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' }, disk({
    [`${DIR}/sessions/cccc3333.json`]: { id: 'cccc3333', name: 'proyecto-b', project: 'proyecto-b', cwd: '/w/proyecto-b', lastSeen: 99_000 },
  }))
  await start($, '/w/proyecto-a')
  await run($, 'share api: GET /pedidos devuelve {id}')
  await $.session.receive({ origin: { kind: 'peer', plugin: 'session-link' }, text: '<cross-session-message from="proyecto-b">hola</cross-session-message>' } as never)
  await $.session.send({ to: 'proyecto-b', text: 'ok', origin: { kind: 'model' } } as never)
  const pane = { ...(PANE as object), surface, props: { title: 'Sesiones', isFocused: false, bodyColumns: width, placement: 'inline' } } as never
  return $.ui.mount(pane)
}

test('pane renders header icons, presence, bars and quick-action buttons', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  const ui = await mountWith($, on, 70, 'terminal')
  expect(await ui.find({ type: 'Text', text: /● 2 activas {2}<- 1 recib\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /★ proyecto-a · proyecto-a +ahora .*%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /proyecto-b · proyecto-b +ahora .*%/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Refrescar/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Who/ })).toBeDefined()
})

test('pane in a narrow terminal shortens the header to icons and counts', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  const ui = await mountWith($, on, 30, 'terminal')
  expect(await ui.find({ type: 'Text', text: /^● 2 {2}<- 1/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^● 2 activas/ })).toHaveLength(0)
})

test('pane on desktop draws emoji icons', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  const ui = await mountWith($, on, 70, 'desktop')
  expect(await ui.find({ type: 'Text', text: /🟢 2 activas {2}📨 1 recib\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⬅ proyecto-b/ })).toBeDefined()
})

test('empty pane shows the empty states with their help', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' })
  await start($, '/w/proyecto-a')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /- Sin mensajes\. \/link send/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /- Pizarra vacia\. \/link share/ })).toBeDefined()
})

test('a failing presence write at session.start still arms the beat and opens the pane', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' }, disk(), true)
  await start($, '/w/proyecto-a')
  expect(w.counts.opened).toBe(1)
  await clock.advance(61_000)
  expect(w.json(`${DIR}/sessions/aaaa1111.json`)).toMatchObject({ lastSeen: 60_000 })
})

test('a non-interactive session.start after an interactive one turns presence off', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const w = world(on, { id: 'aaaa1111', cwd: '/w/proyecto-a' })
  await start($, '/w/proyecto-a')
  await $.session.end({ reason: 'other' } as never)
  await start($, '/w/proyecto-a', false)
  await $.turn.start({ text: 'hola', turnId: 't1' } as never)
  await clock.advance(180_000)
  expect(w.files.get(`${DIR}/sessions/aaaa1111.json`)).toBe('')
})
