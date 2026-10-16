import type { EngineInterface } from 'claude-code'

import type {
  ModelRouterBucket,
  ModelRouterContext,
  ModelRouterLimit,
  ModelRouterModels,
  ModelRouterPrefs,
  ModelRouterSessionTokens,
  ModelRouterTask,
} from '../types'
import { LEVEL_MARK, LEVEL_NAME, NO_DATA, WINDOWS, levelOf, modelRowText, totalTokensOf } from './quota'
import {
  BUCKETS,
  HELP_HIGH,
  MODEL_COLOR,
  MODEL_LETTER,
  MODEL_NAME,
  bar,
  clamp,
  fmtDur,
  fmtPct,
  fmtReset,
  fmtResetTiny,
  fmtTokens,
  fmtTokensLong,
  fmtTokensTiny,
  fmtUsd,
  health,
  healthShort,
  icons,
  isEmoji,
  levelColor,
  limitLabel,
  limitShort,
  limitTiny,
  pct,
  planLimits,
  plural,
  spark,
  stackCells,
  weekdayShort,
} from './usage'
import type { Aggregate } from './usage'

export type Els = ReturnType<EngineInterface['ui']['resolve']>
export type TabId = 'resumen' | 'tareas' | 'consumo'

export type PanelData = {
  now: number
  enabled: boolean
  tasks: readonly ModelRouterTask[]
  limits: readonly ModelRouterLimit[]
  sess: ModelRouterSessionTokens
  agg: Aggregate
  ownId: string
  cost: number | null
  ctx: ModelRouterContext | null
  models: ModelRouterModels
  prefs: ModelRouterPrefs
  route?: { text: string; level: 'none' | 'ok' | 'high' | 'critical' }
}

export type PanelOpts = {
  surface: string | undefined
  cols: number
  /** rows the pane body can show */
  bodyRows: number
  tab: TabId
  onTab: (t: TabId) => void
  onToggle: () => void
}

type Style = { color?: string; bold?: boolean; dimColor?: boolean; inverse?: boolean }
type Seg = string | [string, Style]
type El = JSX.Element
type Row = { el: El; h: number }
type Built = { title: Seg[]; body: Row[] }
type Block = { id: string; partial?: boolean; build: (inner: number, cap: number) => Built | undefined }

const NOTE = 'Los % de límites son los oficiales de tu cuenta; los tokens son los que contó este mod (solo sesiones con model-router).'

const short = (s: string, n: number) => (n <= 1 ? '' : s.length > n ? `${s.slice(0, n - 1)}…` : s)
const segLen = (segs: Seg[]) => segs.reduce((s, x) => s + (typeof x === 'string' ? x.length : x[0].length), 0)
const linesFor = (len: number, w: number) => Math.max(1, Math.ceil(len / Math.max(1, w)))
/** Panels of up to this many columns use the compact Resumen layout. */
export const NARROW_MAX = 45
/** Width the compact Resumen draws in: the body width less a 2-cell safety margin (scrollbar). */
export const narrowWidth = (cols: number) => Math.max(10, cols - 2)
const DIM: Style = { dimColor: true }
const BOLD: Style = { bold: true }

const takeRows = (rows: Row[], cap: number) => {
  const out: Row[] = []
  let used = 0
  for (const r of rows) {
    if (used + r.h > cap) break
    out.push(r)
    used += r.h
  }
  return out
}

const sumH = (rows: Row[]) => rows.reduce((s, r) => s + r.h, 0)

/** Stacked bar as a row of boxes, one per model: width in percent, colour as background. Used off the terminal, where `█` can draw wider than one column. */
const stackRow = (els: Els, key: string, by: Record<ModelRouterBucket, number>): El => {
  const { Box } = els
  const parts = BUCKETS.filter(b => by[b] > 0)
  const cells = stackCells(
    parts.map(b => by[b]),
    100,
  )
  return (
    <Box key={key} flexDirection="row" width="100%" height={1} flexWrap="nowrap">
      {parts.map((b, i) => (
        <Box
          key={`${key}-${b}`}
          width={`${cells[i] ?? 0}%`}
          height={1}
          flexShrink={0}
          flexGrow={i === parts.length - 1 ? 1 : 0}
          backgroundColor={MODEL_COLOR[b]}
        />
      ))}
    </Box>
  )
}

export function renderPanel(els: Els, d: PanelData, o: PanelOpts): El {
  const { Box, Text, Button } = els
  const ic = icons(o.surface)
  const iw = isEmoji(o.surface) ? 2 : 1
  const { cols } = o
  const boxBars = o.surface !== undefined && o.surface !== 'terminal'
  const now = d.now
  const isNarrow = cols < 60

  const line = (key: string, segs: Seg[], wrap: 'truncate-end' | 'wrap' = 'truncate-end'): El => (
    <Text key={key} wrap={wrap}>
      {segs.map((s, i) =>
        typeof s === 'string' ? (
          <Text key={`s${i}`}>{s}</Text>
        ) : (
          <Text key={`s${i}`} {...s[1]}>
            {s[0]}
          </Text>
        ),
      )}
    </Text>
  )
  const L = (key: string, segs: Seg[]): Row => ({ el: line(key, segs), h: 1 })
  const P = (key: string, segs: Seg[], inner: number): Row => ({
    el: line(key, segs, 'wrap'),
    h: linesFor(segLen(segs), inner - 3),
  })

  const dot = (b: ModelRouterBucket): Seg => [`${ic[b]} `, { color: MODEL_COLOR[b] }]
  const dotW = iw + 1

  /** One meter: the bar in the level colour, the figure, and `tag` as the level in words (aviso, crítico). */
  const meter = (key: string, label: string, p: number, detail: string, inner: number, tag = ''): Row => {
    const labelW = 16
    const color = levelColor(p, d.prefs)
    const pctTxt = fmtPct(p).padStart(5)
    const tagSegs: Seg[] = tag !== '' ? [[`  ${tag}`, { bold: true, color }]] : []
    const tagW = tag !== '' ? tag.length + 2 : 0
    const barW = inner - labelW - 1 - 1 - pctTxt.length - tagW - (detail !== '' ? 2 + detail.length : 0)
    if (barW >= 6) {
      return L(key, [
        label.padEnd(labelW),
        ' ',
        [bar(p, Math.min(barW, 24)), { color }],
        ' ',
        [pctTxt, { bold: true, color }],
        ...tagSegs,
        ...(detail !== '' ? ([['  ' + detail, DIM]] as Seg[]) : []),
      ])
    }
    const head = line(`${key}-a`, [[label, BOLD], ' ', [fmtPct(p), { bold: true, color }], ...tagSegs])
    const barW2 = inner - (detail !== '' ? detail.length + 2 : 0)
    if (detail === '' || barW2 >= 6) {
      return {
        h: 2,
        el: (
          <Box key={key} flexDirection="column">
            {head}
            {line(`${key}-b`, [[bar(p, clamp(barW2, 4, 40)), { color }], ...(detail !== '' ? ([['  ' + detail, DIM]] as Seg[]) : [])])}
          </Box>
        ),
      }
    }
    return {
      h: 3,
      el: (
        <Box key={key} flexDirection="column">
          {head}
          {line(`${key}-b`, [[bar(p, clamp(inner, 4, 40)), { color }]])}
          {line(`${key}-c`, [[detail, DIM]])}
        </Box>
      ),
    }
  }

  const taskTag = (t: ModelRouterTask) => (t.source === 'auto' ? 'auto' : t.source === 'explícito' ? 'manual' : t.subagentType || 'agente')

  const runningRows = (key: string, inner: number, cap: number, withTag: boolean): Row[] => {
    const running = d.tasks.filter(t => t.status === 'running').sort((a, b) => a.startedAt - b.startedAt)
    if (running.length === 0) return [P(`${key}-empty`, [['Nada en curso. Los subagentes que lances aparecerán aquí.', DIM]], inner)]
    const hasMore = running.length > cap
    const shown = running.slice(0, hasMore ? Math.max(1, cap - 1) : cap)
    const rows = shown.map(t => {
      const elapsed = fmtDur(Math.max(0, now - t.startedAt))
      const tag = withTag && inner >= 56 ? ` (${taskTag(t)})` : ''
      const descW = Math.max(6, inner - dotW - 6 - 1 - elapsed.length - 1 - tag.length)
      return L(`${key}-${t.id}`, [
        dot(t.model),
        [MODEL_NAME[t.model].padEnd(6), { bold: true, color: MODEL_COLOR[t.model] }],
        ' ',
        short(t.description || '(sin descripción)', descW).padEnd(descW),
        ...(tag !== '' ? ([[tag, DIM]] as Seg[]) : []),
        ' ',
        [elapsed, DIM],
      ])
    })
    if (hasMore) rows.push(L(`${key}-more`, [[`… y ${running.length - shown.length} más`, DIM]]))
    return rows
  }

  const splitRows = (key: string, by: Record<ModelRouterBucket, number>, inner: number, empty: string): Row[] => {
    const vals = BUCKETS.map(b => by[b])
    const total = vals.reduce((s, v) => s + v, 0)
    if (total <= 0) return [P(`${key}-empty`, [[empty, DIM]], inner)]
    const cells = stackCells(vals, clamp(inner - 1, 8, 60))
    const barSegs: Seg[] = []
    BUCKETS.forEach((b, i) => {
      const c = cells[i] ?? 0
      if (c > 0) barSegs.push(['█'.repeat(c), { color: MODEL_COLOR[b] }])
    })
    const items = BUCKETS.filter(b => by[b] > 0).map((b): Seg[] => [
      dot(b),
      [MODEL_NAME[b], { bold: true, color: MODEL_COLOR[b] }],
      ` ${fmtPct(pct(by[b], total))} · ${fmtTokensLong(by[b])}`,
    ])
    const itemW = (it: Seg[]) => segLen(it) - 1 + iw
    const oneLine = items.reduce((s, it) => s + itemW(it), 0) + (items.length - 1) * 3 <= inner
    const rows: Row[] = [boxBars ? { h: 1, el: stackRow(els, `${key}-bar`, by) } : L(`${key}-bar`, barSegs)]
    if (oneLine) {
      const segs: Seg[] = []
      items.forEach((it, i) => {
        if (i > 0) segs.push('   ')
        segs.push(...it)
      })
      rows.push(L(`${key}-legend`, segs))
    } else {
      items.forEach((it, i) => rows.push(L(`${key}-leg${i}`, it)))
    }
    const cheap = by.haiku + by.sonnet
    if (cheap > 0) rows.push(P(`${key}-cheap`, [[`Modelos económicos (Haiku y Sonnet): ${fmtPct(pct(cheap, total))} de los tokens`, DIM]], inner))
    return rows
  }

  const lim = planLimits(d.limits)
  const hd = health(d.limits, d.prefs)
  const sessTotal = Object.values(d.sess.byModel).reduce((s, n) => s + n, 0)

  const limitsBlock: Block = {
    id: 'limites',
    partial: true,
    build: inner => {
      const rows: Row[] = []
      for (const kind of WINDOWS) {
        const l = lim.find(x => x.kind === kind)
        if (l === undefined) {
          rows.push(P(`lim-${kind}-none`, [[`${limitLabel(kind)}: ${NO_DATA}`, DIM]], inner))
          continue
        }
        const r = fmtReset(l.resetsAt, now)
        const lvl = levelOf(l.percentUsed, d.prefs)
        rows.push(meter(`lim-${kind}`, limitLabel(kind), l.percentUsed, r !== '' ? `se reinicia en ${r}` : '', inner, `${LEVEL_MARK[lvl]} ${LEVEL_NAME[lvl]}`))
      }
      for (const l of lim.filter(x => x.kind === 'spend_limit')) {
        const r = fmtReset(l.resetsAt, now)
        const lvl = levelOf(l.percentUsed, d.prefs)
        rows.push(meter(`lim-${l.kind}`, limitLabel(l.kind), l.percentUsed, r !== '' ? `se reinicia en ${r}` : '', inner, `${LEVEL_MARK[lvl]} ${LEVEL_NAME[lvl]}`))
      }
      if (lim.length === 0) rows.push(P('lim-none', [['Sin datos: los límites aparecen con una suscripción de Claude.', DIM]], inner))
      const high = lim.reduce((m, l) => Math.max(m, l.percentUsed), 0)
      if (high >= d.prefs.warn) rows.push(P('lim-help', [[`→ ${HELP_HIGH}`, { bold: true, color: levelColor(high, d.prefs) }]], inner))
      return { title: [['Límites de tu plan', BOLD]], body: rows }
    },
  }

  const nowBlock: Block = {
    id: 'ahora',
    build: (inner, cap) => {
      const n = d.tasks.filter(t => t.status === 'running').length
      return {
        title: [['Ahora mismo', BOLD], ...(n > 0 ? ([[`  ${plural(n, 'tarea en curso', 'tareas en curso')}`, DIM]] as Seg[]) : [])],
        body: runningRows('now', inner, Math.min(cap, 4), false),
      }
    },
  }

  const sessionSplitBlock: Block = {
    id: 'reparto',
    build: inner => ({
      title: [['Reparto por modelo (esta sesión)', BOLD]],
      body: splitRows('ss', d.sess.byModel, inner, 'Aún no hay consumo en esta sesión.'),
    }),
  }

  const miniUsageBlock: Block = {
    id: 'consumo-mini',
    build: inner => ({
      title: [['Consumo', BOLD]],
      body: [
        P(
          'mini',
          [
            ['Hoy ', DIM],
            [fmtTokensLong(d.agg.today.total), BOLD],
            ['  ·  7 días ', DIM],
            [fmtTokensLong(d.agg.week.total), BOLD],
          ],
          inner,
        ),
      ],
    }),
  }

  const tasksSummaryBlock: Block = {
    id: 'tareas-resumen',
    build: inner => {
      if (d.tasks.length === 0) {
        return {
          title: [['Resumen de tareas', BOLD]],
          body: [P('ts-empty', [['Todavía no se lanzó ninguna tarea. Los subagentes que delegues aparecerán aquí con su modelo.', DIM]], inner)],
        }
      }
      const running = d.tasks.filter(t => t.status === 'running').length
      const done = d.tasks.filter(t => t.status === 'done').length
      const failed = d.tasks.filter(t => t.status === 'error').length
      const rows: Row[] = [
        L('ts-count', [
          [`${ic.running} ${running} en curso`, BOLD],
          '   ',
          [`${ic.done} ${done} ${done === 1 ? 'hecha' : 'hechas'}`, { color: 'green' }],
          '   ',
          [`${ic.error} ${failed} con error`, failed > 0 ? { color: 'red', bold: true } : DIM],
        ]),
      ]
      const levels = (['haiku', 'sonnet', 'opus'] as const).filter(l => d.tasks.some(t => t.model === l))
      for (const l of levels) {
        const mine = d.tasks.filter(t => t.model === l)
        const tokens = mine.reduce((s, t) => s + (t.tokens ?? 0), 0)
        rows.push(
          L(`ts-${l}`, [
            dot(l),
            [MODEL_NAME[l].padEnd(6), { bold: true, color: MODEL_COLOR[l] }],
            ` ${plural(mine.length, 'tarea', 'tareas')}`,
            ...(tokens > 0 ? ([[` · ${fmtTokensLong(tokens)}`, DIM]] as Seg[]) : []),
          ]),
        )
      }
      return { title: [['Resumen de tareas', BOLD]], body: rows }
    },
  }

  const runBlock: Block = {
    id: 'en-curso',
    build: (inner, cap) => {
      const n = d.tasks.filter(t => t.status === 'running').length
      return {
        title: [['En curso', BOLD], ...(n > 0 ? ([[`  ${n}`, DIM]] as Seg[]) : [])],
        body: runningRows('run', inner, Math.min(cap, 6), true),
      }
    },
  }

  const historyBlock: Block = {
    id: 'historial',
    build: (inner, cap) => {
      const fin = d.tasks.filter(t => t.status !== 'running').sort((a, b) => b.startedAt - a.startedAt)
      if (fin.length === 0) {
        return { title: [['Historial reciente', BOLD]], body: [P('h-empty', [['Todavía no terminó ninguna tarea.', DIM]], inner)] }
      }
      const max = Math.min(cap, 10)
      const hasMore = fin.length > max
      const shown = fin.slice(0, hasMore ? Math.max(1, max - 1) : max)
      const rows = shown.map(t => {
        const dur = t.durationMs !== undefined ? fmtDur(t.durationMs) : ''
        const stats =
          t.status === 'error'
            ? `error${dur !== '' ? ` · ${dur}` : ''}`
            : [dur, t.tokens !== undefined && inner >= 56 ? fmtTokensLong(t.tokens) : ''].filter(x => x !== '').join(' · ')
        const tag = inner >= 64 ? ` (${taskTag(t)})` : ''
        const descW = Math.max(6, inner - iw - 1 - dotW - 6 - 1 - 1 - stats.length - tag.length)
        const isErr = t.status === 'error'
        return L(`h-${t.id}`, [
          [`${isErr ? ic.error : ic.done} `, { color: isErr ? 'red' : 'green' }],
          dot(t.model),
          [MODEL_NAME[t.model].padEnd(6), { bold: true, color: MODEL_COLOR[t.model] }],
          ' ',
          short(t.description || '(sin descripción)', descW).padEnd(descW),
          ...(tag !== '' ? ([[tag, DIM]] as Seg[]) : []),
          ' ',
          [stats, isErr ? { color: 'red' } : DIM],
        ])
      })
      if (hasMore) rows.push(L('h-more', [[`… y ${fin.length - shown.length} anteriores`, DIM]]))
      return { title: [['Historial reciente', BOLD], [`  ${shown.length} de ${fin.length}`, DIM]], body: rows }
    },
  }

  const totalsBlock: Block = {
    id: 'totales',
    build: inner => {
      const today = d.agg.today.total
      const week = d.agg.week.total
      if (inner >= 44) {
        const w = Math.floor(inner / 2)
        const cell = (key: string, label: string, n: number): El => (
          <Box key={key} flexDirection="column" width={w}>
            {line(`${key}-l`, [[label, DIM]])}
            {line(`${key}-n`, [[fmtTokens(n), { bold: true }], [' tokens', DIM]])}
          </Box>
        )
        return {
          title: [['Consumo', BOLD]],
          body: [{ h: 2, el: <Box key="tot" flexDirection="row">{[cell('c-hoy', 'HOY', today), cell('c-7', 'ÚLTIMOS 7 DÍAS', week)]}</Box> }],
        }
      }
      return {
        title: [['Consumo', BOLD]],
        body: [
          L('tot-hoy', [['Hoy         ', DIM], [fmtTokensLong(today), BOLD]]),
          L('tot-7', [['Últimos 7 días ', DIM], [fmtTokensLong(week), BOLD]]),
        ],
      }
    },
  }

  const chartBlock: Block = {
    id: 'grafico',
    build: (inner, cap) => {
      const days = d.agg.perDay
      const max = Math.max(1, ...days.map(x => x.total))
      const last = days.length - 1
      if (cap >= days.length) {
        const bw = clamp(inner - 4 - 1 - 1 - 7, 4, 30)
        return {
          title: [['Últimos 7 días', BOLD], ['  tokens por día', DIM]],
          body: days.map((x, i) => {
            const today = i === last
            return L(`d-${x.key}`, [
              [(today ? 'Hoy' : weekdayShort(x.key)).padEnd(4), today ? BOLD : DIM],
              [bar((x.total / max) * 100, bw), { color: today ? 'cyan' : 'gray' }],
              ' ',
              [fmtTokens(x.total), today ? BOLD : DIM],
            ])
          }),
        }
      }
      if (cap >= 2 && inner >= 28) {
        const cells = spark(days.map(x => x.total))
        return {
          title: [['Últimos 7 días', BOLD]],
          body: [
            L('sp-bars', cells.map((c, i): Seg => [` ${c}  `, { color: i === last ? 'cyan' : 'gray', bold: i === last }])),
            L('sp-days', days.map((x, i): Seg => [(i === last ? 'Hoy' : weekdayShort(x.key)).padEnd(4), i === last ? BOLD : DIM])),
          ],
        }
      }
      return undefined
    },
  }

  const modelsBlock: Block = {
    id: 'modelos',
    partial: true,
    build: inner => {
      const named = Object.keys(d.models)
        .sort()
        .flatMap(name => {
          const row = d.models[name]
          return row === undefined ? [] : [{ name, row }]
        })
      if (named.length === 0) {
        return {
          title: [['Tokens por modelo (esta sesión)', BOLD]],
          body: [P('pm-empty', [['Sin dato: aún no hay turnos completados en esta sesión.', DIM]], inner)],
        }
      }
      const totalAll = named.reduce((s, x) => s + totalTokensOf(x.row), 0)
      const nameW = clamp(Math.floor(inner / 3), 8, 20)
      const bw = clamp(inner - nameW - 1 - 1 - 5 - 1 - 8, 3, 30)
      const rows: Row[] = []
      for (const { name, row } of named) {
        const t = totalTokensOf(row)
        const share = totalAll > 0 ? (t / totalAll) * 100 : 0
        rows.push(
          L(`pm-${name}`, [
            [short(name, nameW).padEnd(nameW), BOLD],
            ' ',
            [bar(share, bw), { color: 'cyan' }],
            ' ',
            [fmtPct(share).padStart(5), BOLD],
            ' ',
            [fmtTokens(t), DIM],
          ]),
        )
        rows.push(P(`pm-${name}-d`, [[modelRowText(row), DIM]], inner))
      }
      return { title: [['Tokens por modelo (esta sesión)', BOLD]], body: rows }
    },
  }

  const weekSplitBlock: Block = {
    id: 'reparto-7',
    build: inner => ({
      title: [['Reparto por modelo (7 días)', BOLD]],
      body: splitRows('ws', d.agg.week, inner, 'Aún no hay consumo registrado en los últimos 7 días.'),
    }),
  }

  const sessionsBlock: Block = {
    id: 'sesiones',
    build: (inner, cap) => {
      const list = d.agg.sessions
      if (list.length === 0) {
        return { title: [['Por sesión', BOLD]], body: [P('se-empty', [['Todavía no hay datos de sesiones.', DIM]], inner)] }
      }
      const max = Math.min(cap, 6)
      const shown = list.slice(0, max)
      const nameW = clamp(Math.floor(inner / 3), 8, 16)
      const bw = clamp(inner - 2 - nameW - 1 - 1 - 5 - 1 - 7 - 8, 3, 20)
      return {
        title: [['Por sesión', BOLD], ['  7 días', DIM]],
        body: shown.map(s => {
          const mine = s.id === d.ownId
          return L(`se-${s.id}`, [
            [mine ? '▸ ' : '  ', { bold: true, color: 'cyan' }],
            [short(s.name, nameW).padEnd(nameW), mine ? BOLD : {}],
            ' ',
            [bar(s.pct, bw), { color: mine ? 'cyan' : 'gray' }],
            ' ',
            [fmtPct(s.pct).padStart(5), mine ? BOLD : {}],
            ' ',
            [fmtTokens(s.week).padStart(6), DIM],
            ...(mine ? ([[' ← esta', { color: 'cyan' }]] as Seg[]) : []),
          ])
        }),
      }
    },
  }

  const thisSessionBlock: Block = {
    id: 'esta-sesion',
    build: inner => {
      const rows: Row[] = [
        P(
          'es-tokens',
          [
            [fmtTokensLong(sessTotal), BOLD],
            [` (entrada ${fmtTokens(d.sess.input)} · salida ${fmtTokens(d.sess.output)} · caché ${fmtTokens(d.sess.cacheRead + d.sess.cacheWrite)})`, DIM],
          ],
          inner,
        ),
      ]
      if (d.cost !== null) rows.push(L('es-cost', [['Costo estimado: ', DIM], [fmtUsd(d.cost), BOLD]]))
      if (d.ctx?.percent !== undefined) {
        rows.push(
          meter('es-ctx', 'Contexto', d.ctx.percent, d.ctx.tokens !== undefined ? `${fmtTokens(d.ctx.tokens)} de ${fmtTokens(d.ctx.window)}` : '', inner),
        )
      }
      return { title: [['Esta sesión', BOLD]], body: rows }
    },
  }

  const blocks: Block[] =
    o.tab === 'resumen'
      ? [limitsBlock, nowBlock, sessionSplitBlock, miniUsageBlock]
      : o.tab === 'tareas'
        ? [tasksSummaryBlock, runBlock, historyBlock]
        : [totalsBlock, chartBlock, weekSplitBlock, sessionsBlock, thisSessionBlock, modelsBlock]

  const tabsH = cols < 46 ? 2 : 1
  const footNoteH = o.bodyRows >= 22 ? linesFor(NOTE.length, cols - 2) : 0
  const footH = footNoteH + (isNarrow ? 2 : 1)
  const avail = Math.max(1, o.bodyRows - tabsH - 2 - footH)

  const card = (id: string, title: Seg[], body: Row[], isFlat: boolean): El =>
    isFlat ? (
      <Box key={id} flexDirection="column" paddingLeft={1}>
        {line(`${id}-t`, title)}
        {body.map(r => r.el)}
      </Box>
    ) : (
      <Box key={id} flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1}>
        {line(`${id}-t`, title)}
        {body.map(r => r.el)}
      </Box>
    )

  const attempt = (isFlat: boolean, room: number) => {
    const inner = Math.max(10, isFlat ? cols - 1 : cols - 4)
    const chrome = isFlat ? 1 : 3
    let used = 0
    let trimmed = false
    const nodes: El[] = []
    const dropped: Block[] = []
    for (const b of blocks) {
      if (dropped.length > 0) {
        dropped.push(b)
        continue
      }
      const remaining = room - used - chrome
      const built = remaining >= 1 ? b.build(inner, remaining) : undefined
      const body = built ? takeRows(built.body, remaining) : []
      if (!built || body.length === 0) {
        dropped.push(b)
        continue
      }
      if (body.length < built.body.length) {
        if (!b.partial) {
          dropped.push(b)
          continue
        }
        trimmed = true
      }
      used += chrome + sumH(body)
      nodes.push(card(b.id, built.title, body, isFlat))
    }
    return { nodes, dropped, trimmed }
  }
  const run = (isFlat: boolean) => {
    let p = attempt(isFlat, avail)
    if (p.dropped.length > 0 || p.trimmed) p = attempt(isFlat, avail - 1)
    return p
  }
  const compact = o.tab === 'resumen' && cols <= NARROW_MAX
  const W = narrowWidth(cols)

  type CBlock = { id: string; name: string; title: string; rows: Row[]; partial?: boolean }
  const sect = (id: string, title: string): El => {
    const t = short(title, W)
    return line(`${id}-t`, [[t, BOLD], ' ', ['─'.repeat(Math.max(0, W - t.length - 1)), DIM]])
  }
  const cLimits = (): CBlock => {
    const rows: Row[] = []
    const lw = lim.reduce((m, l) => Math.max(m, limitTiny(l.kind).length), 0)
    const rsMax = lim.reduce((m, l) => Math.max(m, fmtResetTiny(l.resetsAt, now) !== '' ? fmtResetTiny(l.resetsAt, now).length + 2 : 0), 0)
    const showReset = rsMax > 0 && W - lw - 6 - rsMax >= 3
    for (const l of lim) {
      const r = fmtResetTiny(l.resetsAt, now)
      const p = Math.round(l.percentUsed)
      const rs = r !== '' ? ` ↻${r}` : ''
      const withReset = showReset && rs !== ''
      const barW = clamp(W - lw - 6 - (showReset ? rsMax : 0), 1, 40)
      rows.push(
        L(`cl-${l.kind}`, [
          limitTiny(l.kind).padEnd(lw),
          ' ',
          [bar(l.percentUsed, barW), { color: levelColor(l.percentUsed, d.prefs) }],
          ' ',
          [`${p}%`.padStart(4), { bold: true, color: levelColor(l.percentUsed, d.prefs) }],
          ...(withReset ? ([[rs, DIM]] as Seg[]) : []),
        ]),
      )
    }
    for (const kind of WINDOWS) {
      if (!lim.some(l => l.kind === kind)) rows.push(L(`cl-${kind}`, [[`${limitTiny(kind)}  ${NO_DATA}`, DIM]]))
    }
    const high = lim.reduce((m, l) => Math.max(m, l.percentUsed), 0)
    if (high >= d.prefs.warn) rows.push(L('cl-help', [['→ Usa modelos más baratos', { bold: true, color: levelColor(high, d.prefs) }]]))
    return { id: 'c-lim', name: 'límites', title: 'Límites', rows, partial: true }
  }
  const cNow = (): CBlock => {
    const running = d.tasks.filter(t => t.status === 'running').sort((a, b) => a.startedAt - b.startedAt)
    const rows: Row[] = []
    if (running.length === 0) rows.push(L('cn-empty', [['Nada en curso', DIM]]))
    const cap = 3
    const shown = running.length > cap ? running.slice(0, cap - 1) : running
    for (const t of shown) rows.push(L(`cn-${t.id}`, [dot(t.model), short(t.description || '(sin descripción)', W - dotW)]))
    if (running.length > shown.length) rows.push(L('cn-more', [[`… y ${running.length - shown.length} más`, DIM]]))
    return { id: 'c-now', name: 'ahora', title: running.length > 0 ? `Ahora mismo · ${running.length}` : 'Ahora mismo', rows, partial: true }
  }
  const cSplit = (): CBlock => {
    const by = d.sess.byModel
    const vals = BUCKETS.map(b => by[b])
    const total = vals.reduce((s, v) => s + v, 0)
    const rows: Row[] = []
    if (total <= 0) rows.push(L('cs-empty', [['Sin consumo aún', DIM]]))
    else {
      const cells = stackCells(vals, W)
      const barSegs: Seg[] = []
      const leg: Seg[] = []
      BUCKETS.forEach((b, i) => {
        const c = cells[i] ?? 0
        if (c > 0) barSegs.push(['█'.repeat(c), { color: MODEL_COLOR[b] }])
        if (by[b] > 0) {
          if (leg.length > 0) leg.push([' · ', DIM])
          leg.push([`${MODEL_LETTER[b]} ${pct(by[b], total)}%`, { bold: true, color: MODEL_COLOR[b] }])
        }
      })
      rows.push(boxBars ? { h: 1, el: stackRow(els, 'cs-bar', by) } : L('cs-bar', barSegs), L('cs-legend', leg))
    }
    return { id: 'c-split', name: 'reparto', title: 'Reparto (sesión)', rows }
  }
  const cUse = (): CBlock => ({
    id: 'c-use',
    name: 'consumo',
    title: 'Consumo',
    rows: [L('cu', [['Hoy ', DIM], [fmtTokensTiny(d.agg.today.total), BOLD], [' · 7d ', DIM], [fmtTokensTiny(d.agg.week.total), BOLD]])],
  })
  const cPlace = (room: number) => {
    const nodes: El[] = []
    const dropped: string[] = []
    let used = 0
    for (const b of [cLimits(), cNow(), cSplit(), cUse()]) {
      const left = room - used - 1
      const rows = left >= 1 ? takeRows(b.rows, left) : []
      if (rows.length === 0 || (rows.length < b.rows.length && !b.partial)) {
        dropped.push(b.name)
        continue
      }
      used += 1 + sumH(rows)
      nodes.push(
        <Box key={b.id} flexDirection="column">
          {sect(b.id, b.title)}
          {rows.map(r => r.el)}
        </Box>,
      )
    }
    return { nodes, dropped }
  }
  const cRoom = Math.max(1, o.bodyRows - tabsH - 2 - 1)
  let cp = compact ? cPlace(cRoom) : { nodes: [] as El[], dropped: [] as string[] }
  if (compact && cp.dropped.length > 0) cp = cPlace(cRoom - 1)

  const framed = run(false)
  const flat = run(true)
  const score = (p: { dropped: Block[]; trimmed: boolean }) => p.dropped.length * 2 + (p.trimmed ? 1 : 0)
  const placed = score(flat) < score(framed) ? flat : framed
  const hasMore = compact ? cp.dropped.length > 0 : placed.dropped.length > 0 || placed.trimmed
  const moreText =
    compact ? `… omitido: ${cp.dropped.join(', ')}` : o.tab === 'resumen' ? '… más detalle en las pestañas Tareas (2) y Consumo (3)' : '… amplía el panel para ver el resto'

  const tabBtn = (id: TabId, n: number, label: string) => (
    <Button
      key={`tab-${id}`}
      hotkey={String(n)}
      {...(o.tab === id ? { variant: 'primary' as const } : {})}
      onPress={() => o.onTab(id)}
    >
      {o.tab === id ? `▸ ${n} ${label}` : `${n} ${label}`}
    </Button>
  )

  const on = d.enabled
  const worstReset = hd.worst ? fmtReset(hd.worst.resetsAt, now) : ''
  const detail = [
    hd.level === 'ok' && hd.color === 'green' && hd.worst ? `lo más alto: ${limitShort(hd.worst.kind)} al ${Math.round(hd.worst.percentUsed)} %` : '',
    hd.level === 'none' ? 'aparecen con una suscripción de Claude' : '',
    worstReset !== '' ? `${hd.worst ? limitShort(hd.worst.kind) : ''} se reinicia en ${worstReset}`.trim() : '',
  ]
    .filter(x => x !== '')
    .join(' · ')

  return (
    <Box flexDirection="column">
      <Box key="tabs" flexDirection="row" flexWrap="wrap" gap={1}>
        {tabBtn('resumen', 1, 'Resumen')}
        {tabBtn('tareas', 2, 'Tareas')}
        {tabBtn('consumo', 3, 'Consumo')}
      </Box>
      {line('h1', [
        ['Router ', BOLD],
        [`${on ? ic.ok : ic.none} ${on ? 'Activo' : 'Pausado'}`, { bold: true, color: on ? 'green' : 'yellow' }],
        ...(cols >= 56
          ? ([
              [
                on ? `  ${d.route?.text ?? 'elige el modelo de todos los subagentes'}` : '  no se cambia el modelo de los subagentes',
                on && d.route?.level === 'critical'
                  ? { bold: true, color: 'red' }
                  : on && d.route?.level === 'high'
                    ? { bold: true, color: 'yellow' }
                    : DIM,
              ],
            ] as Seg[])
          : []),
      ])}
      {line('h2', [
        [`${ic[hd.level]} `, { color: hd.color }],
        [compact ? healthShort(hd) : hd.text, { bold: true, color: hd.color, ...(hd.level === 'danger' ? { inverse: true } : {}) }],
        ...(detail !== '' && !compact ? ([[` · ${detail}`, DIM]] as Seg[]) : []),
      ])}
      {compact ? cp.nodes : placed.nodes}
      {hasMore && line('more', [[moreText, DIM]])}
      {footNoteH > 0 && !compact && (
        <Text key="note" dimColor wrap="wrap">
          {NOTE}
        </Text>
      )}
      <Box key="foot" flexDirection={isNarrow && !compact ? 'column' : 'row'} gap={1}>
        <Button key="toggle" hotkey="p" onPress={o.onToggle}>
          {compact ? (on ? 'p Pausar' : 'p Activar') : on ? 'p Pausar enrutado' : 'p Activar enrutado'}
        </Button>
        <Text dimColor wrap="truncate-end">{compact ? '1-3 pestañas' : 'Teclas: 1, 2, 3 cambian de pestaña'}</Text>
      </Box>
    </Box>
  )
}
