/** Un paso del plan de la sesion, tal como lo emite TodoWrite. */
export type CleanViewStep = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

/** Estado del turno principal: sin turno, en curso, terminado o detenido. */
export type CleanViewTurn = 'idle' | 'running' | 'done' | 'stopped'

declare module 'claude-code' {
  interface PluginState {
    'clean-view': {
      enabled: boolean
      turn: CleanViewTurn
      waiting: string[]
      steps: CleanViewStep[]
      startedAt: number
      now: number
    }
  }
}
