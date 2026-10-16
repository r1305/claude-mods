import type { CleanViewStep, CleanViewTurn } from '../types'

export type PanelState = 'en-curso' | 'pendiente' | 'terminado' | 'detenido' | 'inactivo'

export const STORE_KEY = 'enabled'
export const DEFAULT_ENABLED = false

export const LABELS: Partial<Record<PanelState, string>> = {
  'en-curso': 'En curso',
  pendiente: 'Pendiente de mi respuesta',
  terminado: 'Terminado',
  detenido: 'Detenido',
}

const MARKS: Record<CleanViewStep['status'], string> = {
  pending: '[ ]',
  in_progress: '[>]',
  completed: '[x]',
}

export const markOf = (status: CleanViewStep['status']): string => MARKS[status]

export function parsePref(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : DEFAULT_ENABLED
}

export function parseCommand(args: string): 'on' | 'off' | undefined {
  const word = args.trim().toLowerCase()
  return word === 'on' || word === 'off' ? word : undefined
}

export function stepsOf(input: unknown): CleanViewStep[] {
  if (typeof input !== 'object' || input === null) return []
  const todos = (input as { todos?: unknown }).todos
  if (!Array.isArray(todos)) return []
  return todos.flatMap((todo: unknown): CleanViewStep[] => {
    if (typeof todo !== 'object' || todo === null) return []
    const row = todo as Record<string, unknown>
    const content = typeof row.content === 'string' ? row.content.trim() : ''
    const status = row.status
    if (content === '' || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) return []
    const activeForm = typeof row.activeForm === 'string' && row.activeForm.trim() !== '' ? row.activeForm.trim() : content
    return [{ content, status, activeForm }]
  })
}

export function panelState(turn: CleanViewTurn, waiting: boolean): PanelState {
  if (turn === 'idle') return 'inactivo'
  if (turn === 'done') return 'terminado'
  if (turn === 'stopped') return 'detenido'
  return waiting ? 'pendiente' : 'en-curso'
}

export function panelVisible(turn: CleanViewTurn, waiting: boolean, hasSteps: boolean): boolean {
  return turn === 'running' || turn === 'stopped' || waiting || hasSteps
}

export function turnEnd(reason: string): 'done' | 'stopped' {
  return reason === 'answer' ? 'done' : 'stopped'
}

export function isPendingVerdict(decision: string): boolean {
  return decision === 'ask'
}

export function addPending(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? [...ids] : [...ids, id]
}

export function dropPending(ids: readonly string[], id: string): string[] {
  return ids.filter(known => known !== id)
}

export function keepRow(flags: { isErrored?: boolean; isInterrupted?: boolean }): boolean {
  return flags.isErrored === true || flags.isInterrupted === true
}

export function keepGroup(calls: readonly { isErrored?: boolean; isInterrupted?: boolean }[]): boolean {
  return calls.some(call => keepRow(call))
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}
