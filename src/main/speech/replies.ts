/** Consent-scoped completed replies over the existing shared reading controller. */
import { randomUUID } from 'node:crypto'
import type { AppConfig } from '../../shared/speech/types'
import { MAX_REPLY_RESERVATIONS, MAX_REPLY_SESSIONS, MAX_REPLY_TEXT, type ReplySpeechSession, type ReplySpeechResult } from '../../shared/speech/replies'
import type { ReadingOutcome } from './reading'

interface Reservation { runId: string; consumed: boolean; readingId?: number }
interface Session<Context> { context: Context; config: AppConfig; reservations: Map<string, Reservation> }
interface ReplyDependencies<Context> {
  enqueue(text: string, config: AppConfig, context: Context): { id: number; result: Promise<ReadingOutcome> }
  cancel(readingId: number): unknown
}

export function replyDestination(config: AppConfig): Omit<ReplySpeechSession, 'id'> {
  const profile = config.tts.profiles.find((p) => p.id === config.tts.active_profile_id)
  const engine = profile?.engine ?? config.tts.active_backend
  if (engine !== 'openai' && engine !== 'kokoro' && engine !== 'local') throw new Error('Reply speech engine is not implemented')
  const voice = profile?.voice || config.tts.voice || (engine === 'openai' ? config.tts.openai.voice : '')
  return { engine, voice, remote: engine === 'openai' }
}

function assertIdentity(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(id)) throw new Error('Invalid reply reading identity')
}

/** IDs address lifecycle ownership within the trusted renderer, not tab isolation or agent grants. */
export class ReplyReadingSessions<Context> {
  private readonly sessions = new Map<string, Session<Context>>()
  constructor(private readonly deps: ReplyDependencies<Context>) {}

  /** Only call after explicit native consent for this exact config snapshot. */
  open(context: Context, tabId: unknown, config: AppConfig): ReplySpeechSession {
    assertIdentity(tabId)
    const destination = replyDestination(config)
    if (this.sessions.size >= MAX_REPLY_SESSIONS) throw new Error('Reply reading session limit reached')
    const snapshot = structuredClone(config)
    // A completed agent reply must never interrupt manual or another tab's speech.
    snapshot.playback.on_retrigger = 'queue'
    const id = randomUUID()
    this.sessions.set(id, { context, config: snapshot, reservations: new Map() })
    return { id, ...destination }
  }

  reserve(context: Context, sessionId: unknown, runId: unknown): { id: string } {
    assertIdentity(runId)
    const session = this.get(context, sessionId)
    if ([...session.reservations.values()].some((r) => r.runId === runId)) throw new Error('Reply run is already reserved')
    let count = 0
    for (const s of this.sessions.values()) count += s.reservations.size
    if (count >= MAX_REPLY_RESERVATIONS) throw new Error('Reply reading reservation limit reached')
    const id = randomUUID()
    session.reservations.set(id, { runId, consumed: false })
    return { id }
  }

  async finish(context: Context, sessionId: unknown, replyId: unknown, text: unknown): Promise<ReplySpeechResult> {
    const session = this.get(context, sessionId)
    assertIdentity(replyId)
    const reservation = session.reservations.get(replyId)
    if (text === null) {
      // Idempotent cancellation never touches a different session's reservation.
      if (reservation) this.discard(session, replyId, reservation)
      return { finished: false, error: 'Cancelled' }
    }
    if (!reservation || reservation.consumed) throw new Error('Reply reservation is no longer available')
    // Completion is terminal even if validation/enqueue fails. Otherwise a
    // smaller approved text limit can orphan one reservation per successful run.
    reservation.consumed = true
    try {
      if (typeof text !== 'string' || !text.trim() || text.length > Math.min(MAX_REPLY_TEXT, session.config.trigger.max_text_length)) throw new Error('Invalid or oversized reply text')
      const reading = this.deps.enqueue(text, session.config, session.context)
      reservation.readingId = reading.id
      // Also tolerate a dependency that re-enters cancellation synchronously.
      if (session.reservations.get(replyId) !== reservation) this.deps.cancel(reading.id)
      return await reading.result
    } finally {
      if (session.reservations.get(replyId) === reservation) session.reservations.delete(replyId)
    }
  }

  close(context: Context, sessionId: unknown): void {
    assertIdentity(sessionId)
    const session = this.sessions.get(sessionId)
    if (!session) return
    if (session.context !== context) throw new Error('Reply reading session is unavailable')
    // Seal before cancelling. A delayed reserve/finish can never revive this ID.
    this.sessions.delete(sessionId)
    for (const [id, r] of session.reservations) this.discard(session, id, r)
  }

  closeContext(context: Context): void {
    for (const [id, session] of this.sessions) if (session.context === context) this.close(context, id)
  }

  closeAll(): void {
    for (const [id, session] of this.sessions) this.close(session.context, id)
  }

  /** Global Voice Stop also invalidates not-yet-completed reserved runs, not future runs. */
  stopWork(): void {
    for (const session of this.sessions.values()) for (const [id, r] of session.reservations) this.discard(session, id, r)
  }

  private get(context: Context, id: unknown): Session<Context> {
    assertIdentity(id)
    const session = this.sessions.get(id)
    if (!session || session.context !== context) throw new Error('Reply reading session is unavailable')
    return session
  }

  private discard(session: Session<Context>, id: string, reservation: Reservation): void {
    session.reservations.delete(id)
    if (reservation.readingId !== undefined) this.deps.cancel(reservation.readingId)
  }
}
