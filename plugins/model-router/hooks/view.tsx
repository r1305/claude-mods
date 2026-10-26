import type { EngineInterface } from 'claude-code'

import type { ModelRouterBucket, ModelRouterLimit, ModelRouterModels, ModelRouterPrefs, ModelRouterTask } from '../types'
import { LEVEL_MARK, LEVEL_NAME, NO_DATA, WINDOWS, levelOf } from './quota'
import {
  BUCKETS,
  HELP_HIGH,
  MODEL_COLOR,
  MODEL_LETTER,
  MODEL_NAME,
  bar,
  clamp,
  fmtPct,
  fmtReset,
  fmtResetTiny,
  fmtTokensLong,
  fmtTokensTiny,
  health,
  healthShort,
  icons,
  levelColor,
  limitLabel,
  limitShort,
  limitTiny,
  modelRows,
  pct,
  planLimits,
} from './usage'
import type { Aggregate } from './usage'
import { EFFORT_COLOR, effortTone, groupByModel } from './progress'
import type { RunProgress } from './progress'

export type Els = ReturnType<EngineInterface['ui']['resolve']>

export type PanelData = {
  now: number
  enabled: boolean
  tasks: readonly ModelRouterTask[]
  limits: readonly ModelRouterLimit[]
  agg: Aggregate
  prefs: ModelRouterPrefs
  route?: { text: string; level: 'none' | 'ok' | 'high' | 'critical' }
  /** progress of the current task (its subagents), null when the turn spawned none */
  progress: RunProgress | null
  /** effort the main session runs at, from its turn.step */
  effort: string | null
  /** subagents of the current user turn, in display order */
  turnTasks: readonly ModelRouterTask[]
  /** family of the model the main session answered with last, null while unknown */
  mainModel: ModelRouterBucket | null
}

export type PanelOpts = {
  surface: string | undefined
  cols: number
  /** rows the pane body can show */
  bodyRows: number
  onToggle: () => void
  onTokens: () => void
}

type Style = { color?: string; bold?: boolean; dimColor?: boolean; inverse?: boolean }
type Seg = string | [string, Style]
export type El = JSX.Element
type Row = { el: El; h: number }
type Built = { title: Seg[]; body: Row[] }
type Block = { id: string; partial?: boolean; build: (inner: number, cap: number) => Built | undefined }

const short = (s: string, n: number) => (n <= 1 ? '' : s.length > n ? `${s.slice(0, n - 1)}…` : s)
const segLen = (segs: Seg[]) => segs.reduce((s, x) => s + (typeof x === 'string' ? x.length : x[0].length), 0)
const linesFor = (len: number, w: number) => Math.max(1, Math.ceil(len / Math.max(1, w)))
/** Panels of up to this many columns use the compact layout. */
export const NARROW_MAX = 45
/** Width the compact layout draws in: the body width less a 2-cell safety margin (scrollbar). */
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

// Desktop drawings: each meter / chip row is one SVG, as savvy-progress draws its rows.
// Pure CSS animation (compositor, no redraws): the fill grows once, icons spin and the track
// shimmers while subagents run, the task bar pulses at 100 %. Dark by default, light under
// prefers-color-scheme, still under prefers-reduced-motion. Other surfaces never reach these strings.
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif"
const PANE_CSS = `<style>
svg{--t:#e8ecf4;--s:#8b93a7;--k:#1a2030;--bg:#0d111b;--ok:#34d399;--ok2:#a7f3d0;--wa:#fbbf24;--wa2:#fde68a;--cr:#f87171;--cr2:#fecaca;--n1:#22d3ee;--n2:#c084fc;--hk:#4ade80;--sn:#60a5fa;--op:#c084fc;--ot:#9ca3af}
@media (prefers-color-scheme: light){svg{--t:#1f1f1f;--s:#6b6b68;--k:#e4e7ee;--bg:#fff;--ok:#2e9d5b;--ok2:#4ac17d;--wa:#c98a0a;--wa2:#f0bb3c;--cr:#d64545;--cr2:#f06a6a;--n1:#0891b2;--n2:#7c3aed;--hk:#2e9d5b;--sn:#3b82f6;--op:#a855f7;--ot:#6b7280}}
.t{fill:var(--t)}.s{fill:var(--s)}.k{fill:var(--k)}.tick{fill:var(--bg)}.cf{fill:currentColor}
.lv-normal{color:var(--ok)}.lv-aviso{color:var(--wa)}.lv-critico{color:var(--cr)}.neon{color:var(--n1)}
.m-haiku{color:var(--hk)}.m-sonnet{color:var(--sn)}.m-opus{color:var(--op)}.m-other{color:var(--ot)}
.glow{filter:drop-shadow(0 0 2.5px currentColor)}
.fill{transform-box:fill-box;transform-origin:left center;animation:grow .7s ease-out both}
.fill.done{animation:grow .7s ease-out both,pulse 1.1s ease-in-out .7s 3}
@keyframes grow{from{transform:scaleX(0)}}@keyframes pulse{50%{filter:drop-shadow(0 0 7px currentColor)}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
.spin{transform-box:view-box;animation:r 1.4s linear infinite}.slow{animation-duration:6s}@keyframes r{to{transform:rotate(360deg)}}
.scan{animation:sc 1.5s linear infinite}@keyframes sc{to{transform:translateX(var(--d))}}
.draw{stroke-dasharray:11;animation:dr .6s ease-out both}@keyframes dr{from{stroke-dashoffset:11}}
@media (prefers-reduced-motion: reduce){svg *{animation:none!important}}
</style>`

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const svgDoc = (W: number, H: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${PANE_CSS}${body}</svg>`

/** About 8 CSS px per reported column; the card chrome is already out of `inner`. */
/** Terminal mark of the task: ◉ while subagents run, ✓ once all are done. */
const taskMark = (p: RunProgress) => (p.running > 0 ? '◉' : '✓')

const svgWidth = (inner: number) => clamp(inner * 8 - 8, 160, 700)
const SVG_METER_H = 40
const SVG_METER_ROWS = 2
const SVG_CHIPS_H = 26

type MeterIcon = 'task' | 'clock' | 'shield'
const GRAD = { normal: ['ok', 'ok2'], aviso: ['wa', 'wa2'], critico: ['cr', 'cr2'], neon: ['n1', 'n2'] } as const
const anim = (on: boolean, c: string) => (on ? c : '')

/** 14 px icon centred at (7, 8): a spinning core while the task runs and a check once done, a clock or a shield for limits. */
const iconSvg = (icon: MeterIcon, cls: string, isLive: boolean, isDone: boolean): string => {
  if (icon === 'task' && isDone)
    return `<g class="${cls}"><circle cx="7" cy="8" r="6.5" fill="currentColor" opacity=".2"/><path class="draw" d="M3.8 8.3l2.2 2.2 4.4-4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>`
  if (icon === 'task')
    return `<g class="${cls}" fill="none" stroke="currentColor"><circle class="${anim(isLive, 'spin')}" style="transform-origin:7px 8px" cx="7" cy="8" r="5.6" stroke-width="1.6" stroke-dasharray="5 2.6"/><circle class="${anim(isLive, 'live')}" cx="7" cy="8" r="2.2" fill="currentColor" stroke="none"/></g>`
  if (icon === 'clock')
    return `<g class="${cls}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="7" cy="8" r="5.8"/><path d="M7 8V4.8"/><path class="spin slow" style="transform-origin:7px 8px" d="M7 8h3"/></g>`
  return `<g class="${cls}"><path d="M7 1.6l5 1.9v4c0 3.1-2.1 5.2-5 6.4-2.9-1.2-5-3.3-5-6.4v-4z" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle class="${anim(isLive, 'live')}" cx="7" cy="8" r="1.8" fill="currentColor"/></g>`
}

/**
 * One meter: icon, label and figure, a neon-gradient bar on a glowing track, and the detail line.
 * `segs` > 0 is the task bar: one segment per subagent, a radar by the effort, a shimmer while
 * subagents run and a pulse at 100 %.
 */
const meterSvg = (W: number, label: string, p: number, detail: string, lvl: 'normal' | 'aviso' | 'critico', isLive: boolean, icon: MeterIcon, segs = 0): string => {
  const v = clamp(p, 0, 100)
  const track = 7
  const fw = v > 0 || (isLive && icon === 'task') ? Math.max(track, (v / 100) * W) : 0
  const fwS = fw.toFixed(1)
  const isTask = icon === 'task'
  const g = isTask ? 'neon' : lvl
  const cls = isTask ? 'neon' : `lv-${lvl}`
  const isDone = isTask && v >= 100 && !isLive
  const isScan = isLive && fw > 0
  const clip = `c${fwS.replace('.', '_')}`
  const [a, b] = GRAD[g]
  const defs = `<defs><linearGradient id="g-${g}"><stop offset="0" style="stop-color:var(--${a})"/><stop offset="1" style="stop-color:var(--${b})"/></linearGradient>${
    isScan
      ? `<linearGradient id="sh"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><clipPath id="${clip}"><rect x="0" y="19" width="${fwS}" height="${track}" rx="${track / 2}"/></clipPath>`
      : ''
  }</defs>`
  const step = segs > 0 ? W / segs : 0
  const ticks =
    step >= 6
      ? Array.from({ length: segs - 1 }, (_, i) => `<rect class="tick" x="${((i + 1) * step - 0.75).toFixed(1)}" y="19" width="1.5" height="${track}"/>`).join('')
      : ''
  const radar = isTask
    ? `<g class="neon" fill="none" stroke="currentColor" stroke-width="1"><circle cx="5" cy="33" r="4.2" opacity=".6"/><circle cx="5" cy="33" r="1.4"/><path class="${anim(isLive, 'spin')}" style="transform-origin:5px 33px" d="M5 33l3-3" stroke-width="1.3" stroke-linecap="round"/></g>`
    : ''
  return svgDoc(
    W,
    SVG_METER_H,
    `${defs}${iconSvg(icon, cls, isLive, isDone)}
<text class="t" x="18" y="13" font-family="${FONT}" font-size="12" font-weight="600">${xml(label)}</text>
<text class="cf ${cls}" x="${W}" y="13" text-anchor="end" font-family="${FONT}" font-size="13" font-weight="700" font-variant-numeric="tabular-nums">${xml(fmtPct(p))}</text>
<g class="${cls}"><rect class="k" x="0.5" y="19" width="${W - 1}" height="${track}" rx="${track / 2}" stroke="currentColor" stroke-opacity=".35"/>
${fw > 0 ? `<rect class="fill glow${isDone ? ' done' : ''}" fill="url(#g-${g})" x="0" y="19" width="${fwS}" height="${track}" rx="${track / 2}"/>` : ''}
${isScan ? `<g clip-path="url(#${clip})"><rect class="scan" style="--d:${(fw + 36).toFixed(1)}px" x="-36" y="19" width="36" height="${track}" fill="url(#sh)"/></g>` : ''}${ticks}</g>
${radar}<text class="s" x="${isTask ? 13 : 0}" y="37" font-family="${FONT}" font-size="10.5">${xml(detail)}</text>
${lvl !== 'normal' ? `<text class="cf ${cls}" x="${W}" y="37" text-anchor="end" font-family="${FONT}" font-size="10.5" font-weight="700">${xml(LEVEL_NAME[lvl])}</text>` : ''}`,
  )
}

/** Model glyph centred at (cx, 13) inside a spinning dashed ring: dot for haiku, diamond for sonnet, hexagon for opus. */
const modelGlyph = (b: ModelRouterBucket, cx: number) => {
  const hex = Array.from({ length: 6 }, (_, i) => `${(cx + 4.2 * Math.cos((Math.PI / 3) * i - Math.PI / 2)).toFixed(1)},${(13 + 4.2 * Math.sin((Math.PI / 3) * i - Math.PI / 2)).toFixed(1)}`).join(' ')
  const core =
    b === 'sonnet'
      ? `<path d="M${cx} 8.8l4.2 4.2-4.2 4.2-4.2-4.2z"/>`
      : b === 'opus'
        ? `<polygon points="${hex}"/>`
        : `<circle cx="${cx}" cy="13" r="3.2"/>`
  return `<g class="live m-${b}" fill="currentColor">${core}</g><circle class="spin m-${b}" style="transform-origin:${cx}px 13px" cx="${cx}" cy="13" r="6.4" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="3 2.2"/>`
}

const chipsSvg = (W: number, items: { b: ModelRouterBucket; text: string }[]): string => {
  let x = 0
  const parts = items.map(it => {
    const w = 22 + it.text.length * 6.8
    const out = `${modelGlyph(it.b, x + 7)}<text class="t" x="${x + 18}" y="17" font-family="${FONT}" font-size="12" font-weight="600">${xml(it.text)}</text>`
    x += w + 8
    return out
  })
  return svgDoc(W, SVG_CHIPS_H, parts.join('\n'))
}

const SVG_ROW_H = 22
const STATUS_TXT = { running: 'en curso', done: 'hecha', error: 'error' } as const
const STATUS_CLS = { running: 'neon', done: 'lv-normal', error: 'lv-critico' } as const
type RowStatus = ModelRouterTask['status'] | 'main'

/**
 * One task row: model glyph, description, and on the right the effort in small type coloured by
 * EFFORT_COLOR, then the status; the main session row names its model instead of a status.
 */
const taskRowSvg = (W: number, b: ModelRouterBucket, desc: string, effort: string, status: RowStatus, last = true): string => {
  const isMain = status === 'main'
  const st = isMain ? '' : STATUS_TXT[status]
  const rightLen = (isMain ? MODEL_NAME[b].length + 3 : 0) + effort.length + st.length + 3
  const x0 = isMain ? 18 : 28
  const d = short(desc, Math.max(4, Math.floor((W - x0 - 6 - rightLen * 6.4) / 6.8)))
  const eff = `<tspan font-size="9.5" style="fill:var(--${EFFORT_COLOR[effortTone(effort)].css})">${xml(effort)}</tspan>`
  const lead = isMain
    ? modelGlyph(b, 7)
    : `<path style="color:var(--s);fill:none" d="M7 0V${last ? 11 : SVG_ROW_H}M7 11H14" stroke="currentColor" stroke-opacity=".6" stroke-width="1"/><circle class="m-${b}" cx="19" cy="11" r="2.4" fill="currentColor"/>`
  return svgDoc(
    W,
    SVG_ROW_H,
    `${lead}<text class="t" x="${x0}" y="17" font-family="${FONT}" font-size="12" font-weight="600">${xml(d)}</text>
<text class="s" x="${W}" y="17" text-anchor="end" font-family="${FONT}" font-size="11">${
      isMain
        ? `<tspan class="cf m-${b}" font-weight="700">${MODEL_NAME[b]}</tspan> · ${eff}`
        : `${eff} · <tspan class="cf ${STATUS_CLS[status]}" font-weight="700">${st}</tspan>`
    }</text>`,
  )
}

/** One family row of the tokens view: glyph, name, today and 7 days, and a bar of its share of the week. */
const familySvg = (W: number, b: ModelRouterBucket, detail: string, p: number): string => {
  const fw = (clamp(p, 0, 100) / 100) * (W - 18)
  return svgDoc(
    W,
    32,
    `${modelGlyph(b, 7)}<text class="t" x="18" y="17" font-family="${FONT}" font-size="12" font-weight="600">${MODEL_NAME[b]}</text>
<text class="s" x="${W}" y="17" text-anchor="end" font-family="${FONT}" font-size="11">${xml(detail)}</text>
<g class="m-${b}"><rect class="k" x="18" y="24" width="${W - 18}" height="4" rx="2"/>${fw > 0 ? `<rect class="fill glow" fill="currentColor" x="18" y="24" width="${Math.max(4, fw).toFixed(1)}" height="4" rx="2"/>` : ''}</g>`,
  )
}

export function renderPanel(els: Els, d: PanelData, o: PanelOpts): El {
  const { Box, Text, Button } = els
  const Svg = o.surface === 'desktop' && 'Svg' in els ? els.Svg : null
  const ic = icons(o.surface)
  const { cols } = o
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

  /** One meter in text: the bar in the level colour, the figure, and `tag` as the level in words (aviso, crítico). */
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

  const running = d.tasks.filter(t => t.status === 'running')
  const isLive = running.length > 0
  const MODEL_ORDER = ['opus', 'sonnet', 'haiku'] as const
  const runCounts = MODEL_ORDER.map(b => ({ b, n: running.filter(t => t.model === b).length })).filter(x => x.n > 0)

  const lim = planLimits(d.limits)
  const hd = health(d.limits, d.prefs)

  /** A plan limit as a meter: an animated SVG bar on the desktop, the character bar elsewhere. */
  const limitRow = (kind: string, p: number, resetsAt: string | undefined, inner: number): Row => {
    const r = fmtReset(resetsAt, now)
    const lvl = levelOf(p, d.prefs)
    const detail = r !== '' ? `se reinicia en ${r}` : ''
    if (Svg !== null) {
      const W = svgWidth(inner)
      return {
        h: SVG_METER_ROWS,
        el: (
          <Svg
            key={`lim-${kind}`}
            source={meterSvg(W, limitLabel(kind), p, detail, lvl, isLive, kind === 'five_hour' ? 'clock' : 'shield')}
            alt={`${limitLabel(kind)}: ${fmtPct(p)}${detail !== '' ? `, ${detail}` : ''}${lvl !== 'normal' ? `, ${LEVEL_NAME[lvl]}` : ''}`}
            width={W}
            height={SVG_METER_H}
          />
        ),
      }
    }
    return meter(`lim-${kind}`, limitLabel(kind), p, detail, inner, `${LEVEL_MARK[lvl]} ${LEVEL_NAME[lvl]}`)
  }

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
        rows.push(limitRow(kind, l.percentUsed, l.resetsAt, inner))
      }
      for (const l of lim.filter(x => x.kind === 'spend_limit')) rows.push(limitRow(l.kind, l.percentUsed, l.resetsAt, inner))
      if (lim.length === 0) rows.push(P('lim-none', [['Sin datos: los límites aparecen con una suscripción de Claude.', DIM]], inner))
      const high = lim.reduce((m, l) => Math.max(m, l.percentUsed), 0)
      if (high >= d.prefs.warn) rows.push(P('lim-help', [[`→ ${HELP_HIGH}`, { bold: true, color: levelColor(high, d.prefs) }]], inner))
      return { title: [['Límites de tu plan', BOLD]], body: rows }
    },
  }

  /** One-line summary of the model the router chose for the subagents running now (Opus 2 · Sonnet 1 · Haiku 3). */
  const modelsBlock: Block = {
    id: 'modelos',
    build: inner => {
      const items = runCounts.map(x => ({ b: x.b as ModelRouterBucket, text: `${MODEL_NAME[x.b]} ${x.n}` }))
      const plain = items.map(i => i.text).join(' · ')
      const row: Row =
        Svg !== null
          ? {
              h: 2,
              el: <Svg key="mod" source={chipsSvg(svgWidth(inner), items)} alt={plain} width={svgWidth(inner)} height={SVG_CHIPS_H} />,
            }
          : P(
              'mod',
              items.flatMap((it, i): Seg[] => [...(i > 0 ? ([['  ·  ', DIM]] as Seg[]) : []), dot(it.b), [it.text, { bold: true, color: MODEL_COLOR[it.b] }]]),
              inner,
            )
      return { title: [['Modelos en curso', BOLD], [`  ${running.length}`, DIM]], body: [row] }
    },
  }

  const usageBlock: Block = {
    id: 'consumo',
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

  type ListItem =
    | { kind: 'head'; key: string; b: ModelRouterBucket; n: number }
    | { kind: 'row'; key: string; b: ModelRouterBucket; desc: string; effort: string; status: RowStatus; last: boolean }
  const listItems: ListItem[] = [
    ...(d.mainModel !== null ? [{ kind: 'row' as const, key: 'main', b: d.mainModel, desc: 'Principal', effort: d.effort ?? '—', status: 'main' as const, last: true }] : []),
    ...groupByModel(d.turnTasks).flatMap((g): ListItem[] => [
      { kind: 'head', key: `g-${g.b}`, b: g.b, n: g.tasks.length },
      ...g.tasks.map((t, i) => ({ kind: 'row' as const, key: t.id, b: g.b, desc: t.description || t.subagentType || 'subagente', effort: t.effort ?? '—', status: t.status, last: i === g.tasks.length - 1 })),
    ]),
  ]
  const branch = (last: boolean) => (last ? '└' : '├')
  const statusSeg = (s: RowStatus): Seg =>
    s === 'main' ? ['· ', DIM] : [`${ic[s]} `, { color: s === 'error' ? 'red' : s === 'done' ? 'green' : 'cyan' }]
  const effortSeg = (e: string): Seg => [e, { color: EFFORT_COLOR[effortTone(e)].color, dimColor: true }]
  const listBlock: Block = {
    id: 'tareas',
    partial: true,
    build: inner => {
      const W = svgWidth(inner)
      const rows: Row[] = listItems.map(it => {
        if (it.kind === 'head') {
          const text = `${MODEL_NAME[it.b]} · ${it.n}`
          return Svg !== null
            ? { h: 2, el: <Svg key={`tl-${it.key}`} source={chipsSvg(W, [{ b: it.b, text }])} alt={text} width={W} height={SVG_CHIPS_H} /> }
            : L(`tl-${it.key}`, [dot(it.b), [text, { bold: true, color: MODEL_COLOR[it.b] }]])
        }
        const isMain = it.status === 'main'
        const st = isMain ? '' : STATUS_TXT[it.status]
        if (Svg !== null) {
          return {
            h: 1,
            el: <Svg key={`tl-${it.key}`} source={taskRowSvg(W, it.b, it.desc, it.effort, it.status, it.last)} alt={`${it.desc} · ${isMain ? `${MODEL_NAME[it.b]} · ` : ''}${it.effort}${st !== '' ? ` · ${st}` : ''}`} width={W} height={SVG_ROW_H} />,
          }
        }
        const rightLen = (isMain ? MODEL_NAME[it.b].length + 3 : 0) + it.effort.length + (st !== '' ? st.length + 3 : 0) + 2
        return L(`tl-${it.key}`, [
          isMain ? '' : [`${branch(it.last)} `, DIM],
          statusSeg(it.status),
          ...(isMain ? [dot(it.b)] : []),
          short(it.desc, Math.max(4, inner - 7 - rightLen)),
          '  ',
          ...(isMain ? ([[MODEL_NAME[it.b], { color: MODEL_COLOR[it.b] }], ' · '] as Seg[]) : []),
          effortSeg(it.effort),
          ...(st !== '' ? ([[` · ${st}`, DIM]] as Seg[]) : []),
        ])
      })
      if (d.turnTasks.length === 0) rows.push(L('tl-none', [['Sin tareas en este turno', DIM]]))
      return { title: [['Tareas del turno', BOLD], [`  ${d.turnTasks.length}`, DIM]], body: rows }
    },
  }

  const blocks: Block[] = [limitsBlock, listBlock, ...(isLive ? [modelsBlock] : []), usageBlock]

  const footH = isNarrow ? 2 : 1
  const avail = Math.max(1, o.bodyRows - 2 - footH)

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
  const compact = cols <= NARROW_MAX
  const W = narrowWidth(cols)

  type CBlock = { id: string; name: string; title: string; rows: Row[]; partial?: boolean }
  const sect = (id: string, title: string): El => {
    const t = short(title, W)
    return line(`${id}-t`, [[t, BOLD], ' ', ['─'.repeat(Math.max(0, W - t.length - 1)), DIM]])
  }
  const cLimits = (): CBlock => {
    const rows: Row[] = []
    const lw = lim.reduce((m, l) => Math.max(m, limitTiny(l.kind).length), 0)
    const rsMax = lim.reduce((m, l) => {
      const r = fmtResetTiny(l.resetsAt, now)
      return Math.max(m, r !== '' ? r.length + 2 : 0)
    }, 0)
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
  const cModels = (): CBlock => {
    const full = runCounts.map(x => `${MODEL_NAME[x.b]} ${x.n}`).join(' · ')
    const text = full.length <= W ? full : runCounts.map(x => `${MODEL_LETTER[x.b]} ${x.n}`).join(' · ')
    return { id: 'c-mod', name: 'modelos', title: `En curso · ${running.length}`, rows: [L('cm', [[short(text, W), BOLD]])] }
  }
  const cList = (): CBlock => ({
    id: 'c-list',
    name: 'tareas',
    title: `Tareas · ${d.turnTasks.length}`,
    partial: true,
    rows: [
      ...listItems.map(it => {
        if (it.kind === 'head') return L(`cli-${it.key}`, [[short(`${MODEL_NAME[it.b]} · ${it.n}`, W), { bold: true, color: MODEL_COLOR[it.b] }]])
        const mark = it.status === 'main' ? `· ${MODEL_LETTER[it.b]} ` : `${branch(it.last)}${ic[it.status]} `
        return L(`cli-${it.key}`, [mark, effortSeg(it.effort), ' ', short(it.desc, W - mark.length - it.effort.length - 1)])
      }),
      ...(d.turnTasks.length === 0 ? [L('cl-none', [[short('Sin tareas en este turno', W), DIM]])] : []),
    ],
  })
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
    for (const b of [cLimits(), cList(), ...(isLive ? [cModels()] : []), cUse()]) {
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
  const cRoom = Math.max(1, o.bodyRows - 2 - 1)
  let cp = compact ? cPlace(cRoom) : { nodes: [] as El[], dropped: [] as string[] }
  if (compact && cp.dropped.length > 0) cp = cPlace(cRoom - 1)

  const framed = run(false)
  const flat = run(true)
  const score = (p: { dropped: Block[]; trimmed: boolean }) => p.dropped.length * 2 + (p.trimmed ? 1 : 0)
  const placed = score(flat) < score(framed) ? flat : framed
  const hasMore = compact ? cp.dropped.length > 0 : placed.dropped.length > 0 || placed.trimmed
  const moreText = compact ? `… omitido: ${cp.dropped.join(', ')}` : '… amplía el panel para ver el resto'

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
      <Box key="foot" flexDirection={isNarrow && !compact ? 'column' : 'row'} gap={1}>
        <Button key="toggle" hotkey="p" onPress={o.onToggle}>
          {compact ? (on ? 'p Pausar' : 'p Activar') : on ? 'p Pausar enrutado' : 'p Activar enrutado'}
        </Button>
        <Button key="tokens" hotkey="t" onPress={o.onTokens}>
          t Tokens
        </Button>
        {!compact && (
          <Text dimColor wrap="truncate-end">
            Detalle de consumo: /quota
          </Text>
        )}
      </Box>
    </Box>
  )
}

export type ProgressOpts = { surface: string | undefined; cols: number; progress: RunProgress; effort: string | null; below: El | null }

/**
 * The bar above the prompt: the current task's progress, advancing as its subagents finish.
 * Always drawn; a turn with no subagents yet shows `Tarea 0/0 · en espera`.
 * `below` is the row the other mods drew, kept beneath it.
 */
export function renderProgressBar(els: Els, o: ProgressOpts): El {
  const { Box, Text } = els
  const Svg = o.surface === 'desktop' && 'Svg' in els ? els.Svg : null
  const p = o.progress
  const label = `Tarea ${p.done}/${p.total}${p.total === 0 ? ' · en espera' : ''}`
  const effortTxt = `esfuerzo ${o.effort ?? '—'}`
  if (Svg !== null) {
    const width = Math.max(180, Math.min(1600, o.cols * 8 - 96))
    return (
      <Box flexDirection="column">
        <Svg
          source={meterSvg(width, label, p.pct, effortTxt, 'normal', p.running > 0, 'task', p.total)}
          alt={`${label}, ${fmtPct(p.pct)}, ${effortTxt}`}
          width={width}
          height={SVG_METER_H}
        />
        {o.below}
      </Box>
    )
  }
  const width = Math.max(6, Math.min(40, o.cols - 48 - (p.total === 0 ? 12 : 0)))
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2}>
        <Text bold>{`${taskMark(p)} ${label}`}</Text>
        <Text color="green">{bar(p.pct, width)}</Text>
        <Text bold>{fmtPct(p.pct)}</Text>
        <Text dimColor>{effortTxt}</Text>
      </Box>
      {o.below}
    </Box>
  )
}

export type TokensOpts = { surface: string | undefined; cols: number }

/**
 * Second pane (`model-router-tokens`): tokens per model family for today and the last 7 days
 * (every session with the mod), and this session's tokens per exact model name.
 */
export function renderTokens(els: Els, d: { agg: Aggregate; models: ModelRouterModels }, o: TokensOpts): El {
  const { Box, Text } = els
  const Svg = o.surface === 'desktop' && 'Svg' in els ? els.Svg : null
  const ic = icons(o.surface)
  const inner = Math.max(10, o.cols - 2)
  const tiny = o.cols < 50
  const fmt = tiny ? fmtTokensTiny : fmtTokensLong
  const ln = (key: string, segs: Seg[]): El => (
    <Text key={key} wrap="truncate-end">
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
  const maxWeek = Math.max(1, ...BUCKETS.map(b => d.agg.week[b]))
  const fams = BUCKETS.map(b => {
    const detail = `hoy ${fmt(d.agg.today[b])} · 7 días ${fmt(d.agg.week[b])}`
    const p = (d.agg.week[b] / maxWeek) * 100
    if (Svg !== null) {
      const W = svgWidth(inner)
      return <Svg key={`f-${b}`} source={familySvg(W, b, detail, p)} alt={`${MODEL_NAME[b]}: ${detail}`} width={W} height={32} />
    }
    return ln(`f-${b}`, [
      [`${ic[b]} `, { color: MODEL_COLOR[b] }],
      [MODEL_NAME[b].padEnd(7), { bold: true, color: MODEL_COLOR[b] }],
      ...(tiny ? [] : ([[bar(p, clamp(inner - 50, 4, 20)), { color: MODEL_COLOR[b] }], ' '] as Seg[])),
      [detail, DIM],
    ])
  })
  const rows = modelRows(d.models)
  const sess = rows.map(r =>
    ln(`m-${r.name}`, [
      [`${ic[r.b]} `, { color: MODEL_COLOR[r.b] }],
      [short(r.name, Math.max(6, inner - 14)), { bold: true, color: MODEL_COLOR[r.b] }],
      ` ${fmt(r.total)}`,
      ...(tiny ? [] : ([[`  entrada ${fmtTokensTiny(r.input)} · salida ${fmtTokensTiny(r.output)} · caché ${fmtTokensTiny(r.cacheRead)}/${fmtTokensTiny(r.cacheWrite)}`, DIM]] as Seg[])),
    ]),
  )
  return (
    <Box flexDirection="column">
      {ln('t1', [['Tokens por modelo', BOLD], ['  hoy y 7 días, todas las sesiones', DIM]])}
      {fams}
      {ln('t2', [['Esta sesión', BOLD], [`  ${fmt(rows.reduce((s, r) => s + r.total, 0))}`, DIM]])}
      {sess.length > 0 ? sess : ln('m-none', [['Sin turnos con tokens en esta sesión', DIM]])}
      {ln('t3', [[`Reparto 7 días: ${BUCKETS.filter(b => d.agg.week[b] > 0).map(b => `${MODEL_LETTER[b]} ${pct(d.agg.week[b], d.agg.week.total)} %`).join(' · ') || '—'}`, DIM]])}
    </Box>
  )
}
