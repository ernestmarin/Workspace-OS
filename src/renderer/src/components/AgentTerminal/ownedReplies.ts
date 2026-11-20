import { SpokenReplies } from './spokenReplies'
import { MAX_REPLY_RESERVATIONS, type ReplySpeechApi, type ReplySpeechSession } from '../../../../shared/speech/replies'

export interface ReplyReaderState {
  enabled: boolean
  pending: boolean
  activeCount: number
  destination: Omit<ReplySpeechSession, 'id'> | null
}
interface Run {
  runId: string
  sessionId: string
  epoch: number
  finishing: boolean
  ticket: Promise<{ id: string } | null>
}
interface Observers { onState(state: ReplyReaderState): void; onError(message: string): void }

/** Completed-run reader. Never invokes global Speak/Stop or changes agent execution. */
export class OwnedReplies {
  private readonly buffers = new SpokenReplies()
  private readonly runs = new Map<string, Run>()
  private session: ReplySpeechSession | null = null
  private epoch = 0
  private pending = false
  constructor(private readonly api: ReplySpeechApi, private readonly observers: Observers) {}

  async enable(tabId: string): Promise<void> {
    if (this.pending || this.session) return
    const epoch = ++this.epoch
    this.pending = true
    this.emit()
    try {
      const session = await this.api.openReplySession(tabId)
      if (epoch !== this.epoch) {
        if (session) this.close(session.id)
        return
      }
      this.session = session
    } catch {
      if (epoch === this.epoch) this.error('Unable to enable reply reading; check Voice settings.')
    } finally {
      if (epoch === this.epoch) { this.pending = false; this.emit() }
    }
  }

  disable(): void {
    ++this.epoch
    this.pending = false
    const previous = this.session
    this.session = null
    this.buffers.clear()
    this.runs.clear()
    this.emit()
    if (previous) this.close(previous.id)
  }

  begin(runId: string): void {
    if (!this.session || this.runs.has(runId)) return
    if (this.runs.size >= MAX_REPLY_RESERVATIONS || !this.buffers.begin(runId)) {
      this.error('Reply reading queue is full; this reply will not be read.')
      return
    }
    const run: Run = { runId, sessionId: this.session.id, epoch: this.epoch, finishing: false, ticket: Promise.resolve(null) }
    this.runs.set(runId, run)
    this.emit()
    run.ticket = Promise.resolve().then(() => this.current(run) ? this.api.reserveReply(run.sessionId, runId) : null).catch(() => {
      if (this.current(run)) {
        this.buffers.finish(runId, false)
        this.error('Unable to reserve reply reading; check Voice settings.')
      }
      return null
    })
  }

  append(runId: string, text: string): void {
    const run = this.runs.get(runId)
    if (run && !run.finishing && this.current(run)) this.buffers.append(runId, text)
  }

  finish(runId: string, success: boolean): void {
    const run = this.runs.get(runId)
    if (!run || run.finishing || !this.current(run)) return
    run.finishing = true
    const text = this.buffers.finish(runId, success)
    void run.ticket.then(async (ticket) => {
      if (!ticket || !this.current(run)) return
      const result = await this.api.finishReply(run.sessionId, ticket.id, text)
      if (text !== null && !result.finished && this.current(run)) this.error('Reply reading stopped or failed; check Voice settings.')
    }).catch(() => {
      if (this.current(run)) this.error('Unable to read the agent reply; check Voice settings.')
    }).finally(() => {
      if (this.runs.get(runId) === run) { this.runs.delete(runId); this.emit() }
    })
  }

  cancel(runId: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    this.runs.delete(runId)
    this.buffers.finish(runId, false)
    this.emit()
    void run.ticket.then((ticket) => ticket ? this.api.finishReply(run.sessionId, ticket.id, null) : undefined).catch(() => {
      if (run.epoch === this.epoch && run.sessionId === this.session?.id) this.error('Unable to stop reply reading; use Voice Stop.')
    })
  }

  /** Stop this tab's current/reserved replies; consent still covers future prompt runs. */
  stop(): void {
    for (const id of [...this.runs.keys()]) this.cancel(id)
  }

  private current(run: Run): boolean {
    return run.epoch === this.epoch && this.session?.id === run.sessionId && this.runs.get(run.runId) === run
  }

  private close(id: string): void {
    void this.api.closeReplySession(id).catch(() => this.error('Unable to stop reply reading; use Voice Stop.'))
  }

  private emit(): void {
    const { session } = this
    const destination = session ? { engine: session.engine, voice: session.voice, remote: session.remote } : null
    try { this.observers.onState({ enabled: session !== null, pending: this.pending, activeCount: this.runs.size, destination }) } catch { /* observer only */ }
  }

  private error(message: string): void { try { this.observers.onError(message) } catch { /* observer only */ } }
}
