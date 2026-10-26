import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { ModelRouterDay } from '../types'
import { lastDayKeys } from './usage'

const NOW = new Date(2026, 9, 12, 12, 0, 0).getTime()

const day = (haiku: number, sonnet = 0, opus = 0): ModelRouterDay => ({ haiku, sonnet, opus, other: 0, total: haiku + sonnet + opus })

const pane = (o: { cols?: number; rows?: number; bodyRows?: number; surface?: string } = {}) =>
  ({
    plugin: 'model-router',
    surface: o.surface ?? 'terminal',
    component: 'Pane',
    requestId: 'model-router',
    viewport: { columns: o.cols ?? 80, rows: o.rows ?? 40 },
    props: {
      title: 'Model router',
      isFocused: false,
      bodyColumns: o.cols ?? 80,
      placement: 'inline',
      ...(o.bodyRows !== undefined ? { scroll: { bodyRows: o.bodyRows } } : {}),
    },
  }) as never

const textOf = (n: unknown): string => {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  if (n && typeof n === 'object') {
    const o = n as { props?: { children?: unknown }; children?: unknown }
    return textOf((o.props as { label?: string; children?: unknown } | undefined)?.label ?? o.props?.children ?? o.children)
  }
  return ''
}

const linesOf = (n: unknown): string[] => {
  const out: string[] = []
  const walk = (x: unknown) => {
    if (!x || typeof x !== 'object') return
    const o = x as { type?: string; props?: { children?: unknown; flexDirection?: string }; children?: unknown }
    if (o.type === 'Text' || o.type === 'Button') {
      out.push(textOf(x))
      return
    }
    const kids = o.props?.children ?? o.children
    if (o.type === 'Box' && o.props?.flexDirection === 'row') {
      out.push(textOf(kids))
      return
    }
    for (const k of Array.isArray(kids) ? kids : [kids]) walk(k)
  }
  walk(n)
  return out
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

// The plan limits are read at session start (the one reader); a pane test starts the session first.
const begin = ($: Engine) => $.session.start({ cwd: '/w/proyecto-a', surface: 'terminal', isInteractive: true } as never)

type Limits = { kind: string; percentUsed: number; resetsAt?: string }[]

const FIVE_RESET = new Date(NOW + 2 * 3600 * 1000 + 10 * 60000).toISOString()

function world(on: On, opts: { limits?: Limits; files?: Record<string, string>; openFails?: boolean; opened?: unknown[] } = {}) {
  const files = opts.files ?? {}
  const dir = '/cfg/model-router/usage'
  mock.clock(on, { now: NOW })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg' })
  if (opts.openFails !== true) on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.id', () => ({ value: 'sess-a' }) as never)
  on('session.cwd', () => ({ value: 'C:/work/proyecto-a' }) as never)
  on('fs.write', (_$, e) => {
    files[norm(e.path)] = e.text
    return { value: undefined } as never
  })
  on('fs.read', (_$, e) => {
    const t = files[norm(e.path)]
    if (t === undefined) throw new Error('ENOENT')
    return { value: t } as never
  })
  on('fs.list', (_$, e) => {
    if (norm(e.path) !== dir) return { value: [] } as never
    return {
      value: Object.keys(files)
        .filter(p => p.startsWith(`${dir}/`))
        .map(p => ({ name: p.slice(dir.length + 1), kind: 'file', size: files[p]?.length ?? 0 })),
    } as never
  })
  on('ui.open', (_$, e) => {
    if (opts.openFails) throw new Error('boom')
    opts.opened?.push((e as { id?: string }).id)
    return { value: { isPlaced: true } } as never
  })
  on('session.usage', () =>
    ({
      value: {
        startedAt: 0,
        context: { window: 200000, tokens: 80000, percent: 40 },
        rateLimits: opts.limits ?? [],
        cost: { usd: 1.5 },
      },
    }) as never,
  )
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  let n = 0
  on('agent.spawn', (_$, e) => ({ model: (e.model as string | undefined) ?? 'claude-opus-5-5', agentId: `agent_${++n}`, status: 'async_launched' }) as never)
  return files
}

const spawn = (description: string, prompt = 'busca donde esta el login') =>
  ({
    tool_use_id: `toolu_${description}`,
    prompt,
    description,
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  }) as never

const complete = (agentId: string | undefined, tokens: number, model: string, reason = 'answer') =>
  ({
    answer: 'ok',
    durationMs: 1500,
    isAborted: false,
    turnId: 't',
    ...(agentId ? { agentId } : {}),
    reason,
    usage: { input_tokens: tokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model },
  }) as never

const seedFiles = (): Record<string, string> => {
  const k = lastDayKeys(NOW, 7)
  return {
    '/cfg/model-router/usage/sess-b.json': JSON.stringify({
      name: 'proyecto-b',
      project: 'proyecto-b',
      days: { [k[6] as string]: day(0, 0, 3000), [k[3] as string]: day(1000), [k[4] as string]: day(200, 800) },
    }),
  }
}

const LIMITS_OK: Limits = [
  { kind: 'five_hour', percentUsed: 34, resetsAt: FIVE_RESET },
  { kind: 'seven_day', percentUsed: 41 },
]

const textOfPane = async (ui: { drawn: () => Promise<unknown> }) => linesOf(await ui.drawn()).join('\n')

async function seedTasks($: Engine) {
  await $.agent.spawn(spawn('Buscar archivos de login'))
  await $.agent.spawn(spawn('Integrar pagos con Stripe', 'integrar Stripe checkout'))
  await $.agent.spawn(spawn('Agregar endpoint de reservas', 'implement the new endpoint and its tests'))
  await $.turn.complete(complete('agent_1', 1200, 'claude-haiku-4-5'))
  await $.turn.complete(complete(undefined, 4000, 'claude-opus-5-5'))
  await $.turn.complete(complete(undefined, 800, 'claude-sonnet-4-5'))
}

test('resumen with data: how am I doing, which model runs, today vs 7 days', async ($, on) => {
  world(on, { limits: LIMITS_OK, files: seedFiles() })
  await begin($)
  await seedTasks($)
  const ui = await $.ui.mount(pane())
  const text = await textOfPane(ui)
  expect(text).toContain('Router ● Activo')
  expect(text).toContain('Vas bien')
  expect(text).toContain('Límites de tu plan')
  expect(text).toMatch(/Ventana de 5 h .*34 %.*se reinicia en 2 h 10 min/)
  expect(text).toMatch(/Semana .*41 %/)
  expect(text).not.toContain('Pasa a modelos más baratos')
  expect(text).toContain('Modelos en curso')
  expect(text).toMatch(/Opus 1/)
  expect(text).toMatch(/Sonnet 1/)
  expect(text).not.toMatch(/Haiku 1/)
  expect(text).toContain('Consumo')
  expect(text).toMatch(/Hoy .*7 días/)
  expect(text).toContain('Detalle de consumo: /quota')
  expect(text).toContain('Tareas en progreso  3')
  expect(text).toMatch(/Opus · 1\n└ » Integrar pagos con Stripe +— · en curso/)
  expect(text).toMatch(/Haiku · 1\n└ ✓ Buscar archivos de login +— · hecha/)
  expect(text.indexOf('Opus · 1')).toBeLessThan(text.indexOf('Haiku · 1'))
  expect(text).not.toContain('Principal')
  expect(JSON.stringify(await ui.drawn())).toContain('"color":"gray","dimColor":true')
  for (const gone of ['Historial reciente', 'Reparto por modelo', 'Por sesión', 'Esta sesión', 'Costo estimado', 'Ahora mismo', 'Los % de límites son los oficiales']) {
    expect(text).not.toContain(gone)
  }
  expect(text).not.toContain('~0')
})

test('resumen with limits at the aviso threshold: yellow light and help sentence', async ($, on) => {
  world(on, { limits: [{ kind: 'five_hour', percentUsed: 82, resetsAt: FIVE_RESET }, { kind: 'seven_day', percentUsed: 30 }] })
  await begin($)
  const ui = await $.ui.mount(pane())
  const text = await textOfPane(ui)
  expect(text).toContain('Cuidado: 5 h al 82 %')
  expect(text).toContain('5 h se reinicia en 2 h 10 min')
  expect(text).toContain('Pasa a modelos más baratos o espera al reinicio.')
  expect(JSON.stringify(await ui.drawn())).toContain('"color":"yellow"')
  expect(JSON.stringify(await ui.drawn())).not.toContain('"color":"red"')
})

test('resumen with limits almost exhausted', async ($, on) => {
  world(on, { limits: [{ kind: 'seven_day', percentUsed: 97 }] })
  await begin($)
  const ui = await $.ui.mount(pane())
  const text = await textOfPane(ui)
  expect(text).toContain('Límite casi agotado: Semana al 97 %')
  expect(text).toContain('Pasa a modelos más baratos')
})

test('resumen without limits and without tasks shows friendly empty states and no running block', async ($, on) => {
  world(on)
  await begin($)
  const ui = await $.ui.mount(pane())
  const text = await textOfPane(ui)
  expect(text).toContain('Sin datos de límites')
  expect(text).toContain('Sin datos: los límites aparecen con una suscripción de Claude.')
  expect(text).not.toContain('Modelos en curso')
  expect(text).toContain('Sin tareas en este turno')
  expect(text).not.toContain('Principal')
})

test('a new user turn restarts the task list, keeping only what still runs', async ($, on) => {
  world(on, { limits: LIMITS_OK })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  await begin($)
  await $.agent.spawn(spawn('Buscar archivos de login'))
  await $.agent.spawn(spawn('Integrar pagos con Stripe', 'integrar Stripe checkout'))
  await $.turn.complete(complete('agent_1', 1200, 'claude-haiku-4-5'))
  await $.turn.start({ text: 'hola', turnId: 't2' } as never)
  const ui = await $.ui.mount(pane())
  const text = await textOfPane(ui)
  expect(text).toContain('Tareas en progreso  1')
  expect(text).toMatch(/Opus · 1\n└ » Integrar pagos con Stripe/)
  expect(text).not.toContain('Buscar archivos de login')
  await $.turn.complete(complete('agent_2', 800, 'claude-opus-5-5'))
  const idle = await textOfPane(ui)
  expect(idle).toContain('Tareas en progreso  0')
  expect(idle).toContain('Sin tareas en este turno')
})

test('tokens pane: per family today and 7 days, and the session per exact model', async ($, on) => {
  const opened: unknown[] = []
  world(on, { limits: LIMITS_OK, files: seedFiles(), opened })
  await begin($)
  await seedTasks($)
  const out = await $.command.run({ command: 'model-router', args: 'tokens' } as never)
  expect(out.text).toContain('tokens por modelo')
  expect(opened).toContain('model-router-tokens')
  const ui = await $.ui.mount({ ...(pane() as object), requestId: 'model-router-tokens' } as never)
  const text = await textOfPane(ui)
  expect(text).toContain('Tokens por modelo')
  expect(text).toMatch(/Opus +.*hoy 7 k tokens · 7 días 7 k tokens/)
  expect(text).toMatch(/Haiku +.*7 días 2,4 k tokens/)
  expect(text).toMatch(/claude-opus-5-5 4 k tokens/)
  expect(text).toMatch(/claude-sonnet-4-5 800 tokens/)
})

test('narrow viewport uses the compact one-line layout and never overflows', async ($, on) => {
  world(on, { limits: LIMITS_OK, files: seedFiles() })
  await begin($)
  await seedTasks($)
  const ui = await $.ui.mount(pane({ cols: 40, rows: 40 }))
  const lines = linesOf(await ui.drawn())
  expect(lines.some(l => /^5h [█░]+ +34% ↻2h10$/.test(l))).toBe(true)
  expect(lines.filter(l => l.length > 40)).toEqual([])
})

test('low viewport keeps header and limits and points to a bigger panel', async ($, on) => {
  world(on, { limits: LIMITS_OK, files: seedFiles() })
  await begin($)
  await seedTasks($)
  const ui = await $.ui.mount(pane({ bodyRows: 7 }))
  const text = await textOfPane(ui)
  expect(text).toContain('Router ● Activo')
  expect(text).toContain('Límites de tu plan')
  expect(text).not.toContain('Consumo')
  expect(text).toContain('… amplía el panel para ver el resto')
})

test('desktop surface draws emoji and animated SVG meters when the engine offers Svg; terminal does not', async ($, on) => {
  world(on, { limits: LIMITS_OK })
  await begin($)
  await $.agent.spawn(spawn('Buscar archivos de login'))
  const desktop = await $.ui.mount(pane({ surface: 'desktop' }))
  const dText = await textOfPane(desktop)
  expect(dText).toMatch(/[🟢🟡🔴⚪]/u)
  const dJson = JSON.stringify(await desktop.drawn())
  expect(dJson).toContain('Haiku')
  if (dJson.includes('<svg')) {
    expect(dJson).toContain('prefers-reduced-motion')
    expect(dJson).toContain('prefers-color-scheme: light')
    expect(dJson).toContain('class=\\"live')
  }
  const term = await textOfPane(await $.ui.mount(pane()))
  expect(term).not.toMatch(/[🟢🔵🟣⏳✅❌]/u)
  expect(JSON.stringify(await (await $.ui.mount(pane())).drawn())).not.toContain('<svg')
})

test('pause button flips the router state in the header and the status line', async ($, on) => {
  world(on, { limits: LIMITS_OK })
  const statuses: unknown[] = []
  on('ui.status', (_$, e) => {
    statuses.push((e as { text?: string }).text)
    return { value: undefined } as never
  })
  await begin($)
  const ui = await $.ui.mount(pane())
  expect(await textOfPane(ui)).toContain('Router ● Activo')
  await ui.press({ key: 'toggle' })
  const text = await textOfPane(ui)
  expect(text).toContain('Router ○ Pausado')
  expect(text).toContain('p Activar enrutado')
  expect(statuses[statuses.length - 1]).toBe('Router ○ pausado · 5h 34%')
})

test('command.run falls back to a friendly message instead of throwing', async ($, on) => {
  world(on, { openFails: true })
  const out = await $.command.run({ command: 'model-router', args: '' } as never)
  expect(out.text).toBe('model-router: error interno, inténtalo de nuevo.')
  const off = await $.command.run({ command: 'model-router', args: 'off' } as never)
  expect(off.text).toContain('pausado')
})

test('session.start survives a failing command registration and pane open', async ($, on) => {
  world(on, { openFails: true })
  on('command.register', () => {
    throw new Error('boom')
  })
  let reached = false
  on('session.start', (_$, e) => {
    reached = true
    return e as never
  })
  await $.session.start({ cwd: '/work' } as never)
  expect(reached).toBe(true)
})

for (const cols of [30, 40, 45]) {
  test(`compact resumen at ${cols} columns: one line per element`, async ($, on) => {
    world(on, { limits: LIMITS_OK, files: seedFiles() })
    await begin($)
    await seedTasks($)
    const ui = await $.ui.mount(pane({ cols, rows: 50 }))
    const lines = linesOf(await ui.drawn())
    expect(lines.filter(l => l.length > cols)).toEqual([])
    expect(lines).toContain('● Vas bien')
    expect(lines.some(l => /^En curso · 2/.test(l))).toBe(true)
    expect(lines).toContain('Opus 1 · Sonnet 1')
    expect(lines.some(l => /^Hoy \d+(,\d)?k? · 7d \d+(,\d)?k?$/.test(l))).toBe(true)
    expect(lines.some(l => l.startsWith('Reparto'))).toBe(false)
  })
}

test('compact resumen with little height omits whole sections and hints it', async ($, on) => {
  world(on, { limits: LIMITS_OK, files: seedFiles() })
  await begin($)
  await seedTasks($)
  const ui = await $.ui.mount(pane({ cols: 35, rows: 40, bodyRows: 7 }))
  const lines = linesOf(await ui.drawn())
  expect(lines).toContain('● Vas bien')
  expect(lines.some(l => l.startsWith('Límites'))).toBe(true)
  expect(lines.some(l => l.startsWith('Consumo'))).toBe(false)
  expect(lines.some(l => l.startsWith('… omitido:'))).toBe(true)
  expect(lines.filter(l => l.length > 35)).toEqual([])
})
