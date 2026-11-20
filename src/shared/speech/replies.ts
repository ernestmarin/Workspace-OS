/** Completed-run reply reading only. These opaque IDs do not authorize agent actions. */
export const MAX_REPLY_SESSIONS = 8
export const MAX_REPLY_RESERVATIONS = 8
export const MAX_REPLY_TEXT = 20_000

export type ReplySpeechResult = { finished: true } | { finished: false; error: string }
export interface ReplySpeechSession {
  id: string
  engine: 'kokoro' | 'openai' | 'local' | 'piper'
  voice: string
  remote: boolean
}

/** Narrow IPC contract: no renderer-supplied executable, settings snapshot or provider key. */
export interface ReplySpeechApi {
  /** Main asks native consent for a frozen engine/voice; cancel returns null. */
  openReplySession(tabId: string): Promise<ReplySpeechSession | null>
  reserveReply(sessionId: string, runId: string): Promise<{ id: string }>
  /** null discards/cancels only this reservation. A text result waits for audio drain. */
  finishReply(sessionId: string, replyId: string, text: string | null): Promise<ReplySpeechResult>
  closeReplySession(sessionId: string): Promise<void>
}
