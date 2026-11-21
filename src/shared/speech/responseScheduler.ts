/**
 * Response-owned bounded speech scheduler (VOX-A2 & VOX-A3).
 *
 * Connects verified `AssistantResponseEvent`s → `AssistantProseStream` →
 * `SentenceStream` → bounded synthesis/playback dispatch:
 *  - `'completed'` mode (default): accumulates verified prose and dispatches once
 *    after `run-end: 'completed'`.
 *  - `'incremental'` mode: requires `incrementalConsent === true` on the frozen
 *    session snapshot; never activates silently.
 *  - Bounded queue (`maxQueuedSentences`), bounded in-flight count (`maxInFlight`),
 *    and bounded estimated buffered audio duration (`maxBufferedDurationMs`).
 *    Overflow quarantines ONLY this speech scheduler, never the agent or tools.
 *  - Separates `generationDone` from `playbackDrained`; failed/cancelled turns or
 *    `source-error` cancel all queued and in-flight fragments immediately.
 *
 * VOX-A2b — the boundary with the real audio transport:
 *  - A fragment counts as spoken only when the transport CONFIRMS it was heard.
 *    Queueing it, or handing it to the transport, is not playback.
 *  - The text-length estimate is an admission guess. When the transport reports
 *    the measured audio duration, accounting switches to the real number; a
 *    measured fragment that exceeds the buffered-duration cap holds dispatch
 *    exactly like a full queue does.
 *  - A transport that fails — including one that throws synchronously, as the
 *    main-side play guard does once its document is gone — is a failed
 *    fragment. It is never reported as a text overflow, never quarantines a
 *    healthy reply, and never leaks the in-flight accounting that `whenDrained`
 *    depends on.
 */
import type { AssistantResponseEvent } from '../agentRun'
import { AssistantProseStream } from './assistantProse'
import { SentenceStream } from './sentenceStream'

export type ReplyScheduleMode = 'completed' | 'incremental'

export interface ScheduledFragmentResult {
  finished: boolean
  error?: string
  /** Real audio duration measured by the transport, when it knows it. */
  durationMs?: number
}

/** Reported once per fragment the transport could not play to completion. */
export type FragmentErrorReporter = (error: string) => void

/**
 * What the scheduler does when the producer outruns the audio.
 *
 *  - `'quarantine'` (default, the pre-A2a behaviour): stop speaking this reply
 *    entirely and report it. Safe and dumb: the listener loses the rest of the
 *    answer rather than hearing it out of order or minutes late.
 *  - `'hold'`: apply real backpressure. The queued sentence is kept, no further
 *    dispatch happens until playback drains, and `onBackpressure` reports
 *    `held: true` so the caller can tell the user (or slow the source) instead
 *    of silently truncating. The turn is never interrupted either way.
 */
export type BackpressurePolicy = 'hold' | 'quarantine'

export interface BackpressureReport {
  held: boolean
  /** Why the scheduler is holding (for a UI hint; never a security decision). */
  reason: 'queue-full' | 'duration-cap' | null
  released: number
  discarded: number
}

export interface ResponseSpeechSchedulerOptions {
  mode?: ReplyScheduleMode
  backpressure?: BackpressurePolicy
  /** Called on every change of the holding state (and once per release). */
  onBackpressure?: (report: BackpressureReport) => void
  /** Called once if the source overflowed a hard text bound. */
  onQuarantine?: (reason: 'queue-overflow' | 'text-overflow' | 'notifying') => void
  /** Called when a fragment fails for a reason other than a stop or quarantine. */
  onFragmentError?: FragmentErrorReporter
  /** Must be explicitly true when `mode === 'incremental'`. */
  incrementalConsent?: boolean
  maxInFlight?: number
  maxQueuedSentences?: number
  maxBufferedDurationMs?: number
  maxTotalTextLength?: number
  /**
   * `onMeasuredDuration` reports the real audio duration as soon as the
   * transport knows it (after synthesis, before playback ends), so the cap can
   * act on measured audio instead of a character count.
   */
  speakFragment: (
    text: string,
    onReadingId?: (id: number) => void,
    onMeasuredDuration?: (durationMs: number) => void,
  ) => Promise<ScheduledFragmentResult>
  cancelFragment: (id: number) => void
}

export interface ResponseSchedulerState {
  mode: ReplyScheduleMode
  generationDone: boolean
  playbackDrained: boolean
  quarantined: boolean
  /** The producer is being held: nothing new is dispatched until playback drains. */
  backpressured: boolean
  queuedCount: number
  inFlightCount: number
  bufferedDurationMs: number
  /** Sentences spoken to completion. */
  spokenSentences: number
  /** Measured audio duration of the sentences actually heard. */
  spokenDurationMs: number
  /** Sentences never spoken because of a hold overflow or a stop. */
  discardedSentences: number
  /** Fragments the transport failed to play, excluding stops and quarantine. */
  failedSentences: number
}

interface QueuedSentence {
  text: string
  /** Admission estimate, replaced by the measured duration once reported. */
  estimatedMs: number
  /** Settled fragments must not be re-accounted by a late duration report. */
  done?: boolean
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Speech fragment failed'
}

/** Conservative speaking-rate estimate (~12 UTF-16 chars/sec, min 400ms per sentence). */
export function estimateSpeechDurationMs(text: string): number {
  return Math.max(400, Math.ceil((text.length / 12) * 1000))
}

export class ResponseSpeechScheduler {
  private readonly mode: ReplyScheduleMode
  private readonly maxInFlight: number
  private readonly maxQueuedSentences: number
  private readonly maxBufferedDurationMs: number
  private readonly prose: AssistantProseStream
  private readonly sentences: SentenceStream
  private readonly completedBlocks: string[] = []
  private readonly queue: QueuedSentence[] = []
  private readonly activeIds = new Set<number>()
  private inFlight = 0
  private inFlightDurationMs = 0
  private generationDone = false
  private quarantined = false
  private cancelled = false
  private drainWaiters: Array<() => void> = []
  private readonly backpressure: BackpressurePolicy
  private held: BackpressureReport['reason'] = null
  private releasedCount = 0
  private discardedCount = 0
  private spokenCount = 0
  private spokenDuration = 0
  private failedCount = 0

  constructor(private readonly options: ResponseSpeechSchedulerOptions) {
    const mode = options.mode ?? 'completed'
    if (mode === 'incremental' && options.incrementalConsent !== true) {
      throw new Error('Incremental reply audio requires explicit incremental consent')
    }
    this.mode = mode
    this.backpressure = options.backpressure === 'hold' ? 'hold' : 'quarantine'
    this.maxInFlight = Math.max(1, options.maxInFlight ?? 2)
    this.maxQueuedSentences = Math.max(1, options.maxQueuedSentences ?? 6)
    this.maxBufferedDurationMs = Math.max(1_000, options.maxBufferedDurationMs ?? 25_000)
    const maxLen = options.maxTotalTextLength ?? 20_000
    this.prose = new AssistantProseStream({ maxTotalLength: maxLen, maxBlockLength: Math.min(4096, maxLen) })
    this.sentences = new SentenceStream({ maxTotalLength: maxLen, maxSentenceLength: Math.min(4096, maxLen) })
  }

  state(): ResponseSchedulerState {
    const queuedDuration = this.queue.reduce((acc, item) => acc + item.estimatedMs, 0)
    return {
      mode: this.mode,
      generationDone: this.generationDone,
      playbackDrained: this.isDrained(),
      quarantined: this.quarantined,
      backpressured: this.held !== null,
      queuedCount: this.queue.length,
      inFlightCount: this.inFlight,
      bufferedDurationMs: queuedDuration + this.inFlightDurationMs,
      spokenSentences: this.spokenCount,
      spokenDurationMs: this.spokenDuration,
      discardedSentences: this.discardedCount,
      failedSentences: this.failedCount,
    }
  }

  push(event: AssistantResponseEvent): void {
    if (this.generationDone || this.quarantined || this.cancelled) return

    switch (event.type) {
      case 'response-start':
        return
      case 'text-delta': {
        try {
          const blocks = this.prose.push(event.text)
          if (this.mode === 'completed') {
            this.completedBlocks.push(...blocks)
          } else {
            for (const block of blocks) {
              const ready = this.sentences.push(block + '\n\n')
              for (const s of ready) {
                if (!this.enqueueSentence(s.text)) return
              }
            }
          }
        } catch {
          this.options.onQuarantine?.('text-overflow')
          this.quarantine()
        }
        return
      }
      case 'response-end': {
        if (event.outcome !== 'completed') {
          this.quarantine()
        }
        return
      }
      case 'run-end': {
        if (event.outcome !== 'completed') {
          this.stop()
          return
        }
        this.generationDone = true
        try {
          const tailBlocks = this.prose.finish(true)
          if (this.mode === 'completed') {
            this.completedBlocks.push(...tailBlocks)
            const full = this.completedBlocks.join('\n\n').trim()
            if (full) this.enqueueSentence(full, true)
          } else {
            for (const block of tailBlocks) {
              for (const s of this.sentences.push(block + '\n\n')) {
                if (!this.enqueueSentence(s.text)) return
              }
            }
            for (const s of this.sentences.finish(true)) {
              if (!this.enqueueSentence(s.text)) return
            }
          }
        } catch {
          this.options.onQuarantine?.('text-overflow')
          this.quarantine()
          return
        }
        this.notifyIfDrained()
        return
      }
      case 'source-error': {
        this.quarantine()
        return
      }
    }
  }

  stop(): void {
    if (this.cancelled) return
    this.cancelled = true
    this.generationDone = true
    this.prose.cancel()
    this.sentences.cancel()
    this.completedBlocks.length = 0
    this.discardedCount += this.queue.length
    this.queue.length = 0
    this.releaseBackpressure()
    for (const id of [...this.activeIds]) {
      this.activeIds.delete(id)
      try { this.options.cancelFragment(id) } catch { /* best-effort */ }
    }
    this.notifyIfDrained()
  }

  whenDrained(): Promise<void> {
    if (this.isDrained()) return Promise.resolve()
    return new Promise((resolve) => {
      this.drainWaiters.push(resolve)
    })
  }

  private enqueueSentence(raw: string, bypassDurationCap = false): boolean {
    const text = raw.trim()
    if (!text) return true
    const estimatedMs = estimateSpeechDurationMs(text)
    const queuedMs = this.queue.reduce((acc, item) => acc + item.estimatedMs, 0)
    const overQueue = this.queue.length >= this.maxQueuedSentences
    const overDuration = queuedMs + this.inFlightDurationMs + estimatedMs > this.maxBufferedDurationMs
    if (this.held === null && (overQueue || overDuration)) {
      const reason: BackpressureReport['reason'] = overQueue ? 'queue-full' : 'duration-cap'
      if (this.backpressure === 'hold') {
        // Real backpressure: keep the sentence, stop dispatching, and say so.
        // The turn, its tools and its approvals are untouched — only this
        // reply's audio waits.
        this.held = reason
        this.queue.push({ text, estimatedMs })
        this.emitBackpressure()
        return true
      }
      // Quarantine only voice scheduling, never the agent.
      this.options.onQuarantine?.('queue-overflow')
      this.quarantine()
      return false
    }
    if (!bypassDurationCap && this.held !== null) {
      // Already holding: queue behind the hold rather than dropping the text.
      // The queue is still bounded — a second overflow while holding discards,
      // which is counted (never silent).
      if (this.queue.length >= this.maxHeldQueue()) {
        this.discardedCount += 1
        return true
      }
      this.queue.push({ text, estimatedMs })
      return true
    }
    this.queue.push({ text, estimatedMs })
    this.pump()
    return !this.quarantined
  }

  /**
   * While holding, the queue may grow to twice the normal ceiling: the producer
   * has nowhere else to go, and dropping everything the moment a slow voice
   * model falls behind is the behaviour this mode exists to avoid. Past that
   * the oldest-unsent sentences are discarded and COUNTED, so "text generated"
   * and "text heard" stay separable.
   */
  private maxHeldQueue(): number {
    return this.maxQueuedSentences * 2
  }

  private emitBackpressure(): void {
    if (!this.options.onBackpressure) return
    try {
      this.options.onBackpressure({
        held: this.held !== null,
        reason: this.held,
        released: this.releasedCount,
        discarded: this.discardedCount,
      })
    } catch { /* a listener must not break scheduling */ }
  }

  private releaseBackpressure(): void {
    if (this.held === null) return
    this.held = null
    this.releasedCount += 1
    this.emitBackpressure()
  }

  private pump(): void {
    while (
      !this.cancelled &&
      !this.quarantined &&
      this.held === null &&
      this.inFlight < this.maxInFlight &&
      this.queue.length > 0
    ) {
      const next = this.queue.shift()!
      this.inFlight++
      this.inFlightDurationMs += next.estimatedMs
      let assignedId: number | undefined
      let pending: Promise<ScheduledFragmentResult>
      try {
        pending = Promise.resolve(
          this.options.speakFragment(
            next.text,
            (id) => {
              assignedId = id
              if (this.cancelled || this.quarantined) {
                try { this.options.cancelFragment(id) } catch { /* best-effort */ }
              } else {
                this.activeIds.add(id)
              }
            },
            (measurement) => this.noteMeasuredDuration(next, measurement, true),
          ),
        )
      } catch (error) {
        // A dead transport (destroyed window, replaced document) can refuse
        // before it ever returns a promise. That is one failed fragment, not a
        // text overflow and not an exception for the caller's event handler to
        // carry.
        pending = Promise.resolve({ finished: false, error: errorText(error) })
      }
      void pending
        .catch((error: unknown): ScheduledFragmentResult => ({ finished: false, error: errorText(error) }))
        .then((result) => {
          // Counted only when the fragment was confirmed as played: a cancelled
          // one was never heard, and pretending otherwise would inflate the
          // "spoken" number the accounting exists to keep honest.
          if (result?.finished && !this.cancelled && !this.quarantined) {
            this.noteMeasuredDuration(next, result.durationMs, false)
            this.spokenCount += 1
            this.spokenDuration += next.estimatedMs
          } else if (!this.cancelled && !this.quarantined) {
            this.failedCount += 1
            try { this.options.onFragmentError?.(result?.error ?? 'Speech fragment failed') } catch { /* listener must not throw */ }
          }
          return result
        })
        .finally(() => {
          next.done = true
          if (assignedId !== undefined) this.activeIds.delete(assignedId)
          this.inFlight = Math.max(0, this.inFlight - 1)
          this.inFlightDurationMs = Math.max(0, this.inFlightDurationMs - next.estimatedMs)
          if (!this.cancelled && !this.quarantined) {
            // Playback drained enough to take more: leave the holding state.
            if (this.held !== null && this.inFlight < this.maxInFlight) this.releaseBackpressure()
            this.pump()
          }
          this.notifyIfDrained()
        })
    }
  }

  /**
   * Replaces a fragment's text-length guess with the duration the transport
   * actually measured. Idempotent: repeating the same measurement is a no-op,
   * and a fragment that already settled is never re-accounted.
   *
   * `enforceCap` is only meaningful while the audio is still playing; at that
   * point a fragment longer than the whole buffered-duration budget means the
   * producer must wait for it instead of racing ahead of it.
   */
  private noteMeasuredDuration(item: QueuedSentence, rawMs: unknown, enforceCap: boolean): void {
    if (item.done) return
    if (typeof rawMs !== 'number' || !Number.isFinite(rawMs) || rawMs <= 0) return
    const delta = rawMs - item.estimatedMs
    if (delta === 0) return
    item.estimatedMs = rawMs
    this.inFlightDurationMs = Math.max(0, this.inFlightDurationMs + delta)
    if (!enforceCap || this.cancelled || this.quarantined || this.held !== null) return
    const queuedMs = this.queue.reduce((acc, entry) => acc + entry.estimatedMs, 0)
    if (this.inFlightDurationMs + queuedMs > this.maxBufferedDurationMs) {
      this.held = 'duration-cap'
      this.emitBackpressure()
    }
  }

  private quarantine(): void {
    this.quarantined = true
    this.stop()
    try { this.options.onQuarantine?.('notifying') } catch { /* listener must not throw */ }
  }

  private isDrained(): boolean {
    return (this.generationDone || this.cancelled || this.quarantined) && this.queue.length === 0 && this.inFlight === 0
  }

  private notifyIfDrained(): void {
    if (!this.isDrained()) return
    for (const resolve of this.drainWaiters.splice(0)) resolve()
  }
}
