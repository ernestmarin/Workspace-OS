/**
 * Local, framework-independent voice turn lifecycle. This does not capture audio,
 * launch agents or authorize actions. Its caller owns those side effects.
 */
export type ConversationPhase = 'off' | 'listening' | 'thinking' | 'speaking' | 'error'
export interface ConversationState {
  phase: ConversationPhase
  /** Caller-provided unique session identity; never reused across sessions. */
  sessionId: string
  /** Epoch changes whenever callbacks from an earlier session must be ignored. */
  epoch: number
  turn: number | null
  error: string | null
  /** Once interrupted, later audio for this turn must not resume. */
  playbackBlocked: boolean
}
export interface TurnTicket { sessionId: string; epoch: number; turn: number }
export type ConversationEvent =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'submit'; text: string }
  | { type: 'audio-started'; ticket: TurnTicket }
  | { type: 'audio-finished'; ticket: TurnTicket }
  | { type: 'run-finished'; ticket: TurnTicket }
  | { type: 'interrupt' }
  | { type: 'fail'; ticket: TurnTicket; message: string }

export interface ConversationEffects {
  /** A finalized transcript for the existing WOS agent. Never a command to execute directly. */
  submit?: { ticket: TurnTicket; text: string }
  /** Stop playback, not the agent run or its side effects. */
  stopPlayback?: boolean
}
export interface ConversationTransition { state: ConversationState; effects: ConversationEffects }

export const initialConversationState = (sessionId: string): ConversationState => {
  if (!sessionId || sessionId.length > 256) throw new Error('Invalid conversation session identity')
  return { sessionId, phase: 'off', epoch: 0, turn: null, error: null, playbackBlocked: false }
}
const MAX_TRANSCRIPT_LENGTH = 20_000

/** Side-effect-free. Caller serializes events and executes returned effects once. */
export function transitionConversation(state: ConversationState, event: ConversationEvent): ConversationTransition {
  const unchanged = (): ConversationTransition => ({ state, effects: {} })
  const matches = (ticket: TurnTicket): boolean => state.turn !== null && ticket.sessionId === state.sessionId && ticket.epoch === state.epoch && ticket.turn === state.turn
  switch (event.type) {
    case 'start':
      if (state.phase !== 'off' && state.phase !== 'error') return unchanged()
      return { state: { ...state, phase: 'listening', epoch: state.epoch + 1, turn: null, error: null, playbackBlocked: false }, effects: {} }
    case 'stop':
      if (state.phase === 'off') return unchanged()
      return { state: { ...state, phase: 'off', epoch: state.epoch + 1, turn: null, error: null, playbackBlocked: false }, effects: { stopPlayback: true } }
    case 'submit': {
      if (state.phase !== 'listening') return unchanged()
      if (typeof event.text !== 'string' || !event.text.trim() || event.text.length > MAX_TRANSCRIPT_LENGTH) return unchanged()
      // Epoch is unique for every turn, including after an interruption.
      const ticket = { sessionId: state.sessionId, epoch: state.epoch + 1, turn: (state.turn ?? 0) + 1 }
      return { state: { ...state, phase: 'thinking', epoch: ticket.epoch, turn: ticket.turn, error: null, playbackBlocked: false }, effects: { submit: { ticket, text: event.text.trim() } } }
    }
    case 'audio-started':
      if (!matches(event.ticket) || state.phase !== 'thinking' || state.playbackBlocked) return unchanged()
      return { state: { ...state, phase: 'speaking' }, effects: {} }
    case 'audio-finished':
      if (!matches(event.ticket) || state.phase !== 'speaking') return unchanged()
      return { state: { ...state, phase: 'thinking' }, effects: {} }
    case 'run-finished':
      if (!matches(event.ticket) || (state.phase !== 'thinking' && state.phase !== 'speaking')) return unchanged()
      // The caller must emit this only after both the run and queued audio finish.
      return { state: { ...state, phase: 'listening', turn: null }, effects: {} }
    case 'interrupt':
      if (state.phase !== 'speaking') return unchanged()
      // Do not cancel a run or grant permission to execute a new one here.
      return { state: { ...state, phase: 'thinking', playbackBlocked: true }, effects: { stopPlayback: true } }
    case 'fail':
      if (!matches(event.ticket) || (state.phase !== 'thinking' && state.phase !== 'speaking')) return unchanged()
      return { state: { ...state, phase: 'error', epoch: state.epoch + 1, turn: null, error: event.message.slice(0, 500) }, effects: { stopPlayback: true } }
  }
}
