/** One session's presence: file `<config>/session-link/sessions/<id>.json`, written only by that session. */
export type SessionLinkSession = {
  /** `$.session.id()` */
  id: string
  /** short name: cwd folder by default, `/link name` changes it */
  name: string
  /** last segment of the cwd */
  project: string
  cwd: string
  /** ms since epoch of the last heartbeat (presence) */
  lastSeen: number
}

/** One board entry: each session writes only its own `<config>/session-link/board/<id>.json` (max 100, 7 days). */
export type SessionLinkBoardEntry = {
  id: string
  /** id of the publishing session (owner of the file) */
  sid: string
  /** name of the publishing session */
  from: string
  project: string
  topic: string
  text: string
  /** ms since epoch */
  at: number
}

/** A message seen by this session (inbox: received, outbox: sent). */
export type SessionLinkMessage = {
  /** inbox: the sender as far as the event tells; outbox: the recipient */
  peer: string
  /** truncated text */
  text: string
  /** ms since epoch */
  at: number
  /** outbox only: whether the send was delivered */
  isDelivered?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'session-link': {
      /** this session's own identity, null before session.start */
      me: SessionLinkSession | null
      inbox: SessionLinkMessage[]
      outbox: SessionLinkMessage[]
      /** true once session.start saw an interactive session: presence, panel and timers only then */
      live: boolean
      /** `at` of the newest board entry already announced to the model */
      seen: number
      /** ms when the panel last counted the received messages as read */
      viewed: number
    }
  }
}
