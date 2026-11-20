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
 */
import type { AssistantResponseEvent } from '../agentRun'
import { AssistantProseStream } from './assistantProse'
import { SentenceStream } from './sentenceStream'

export type ReplyScheduleMode = 'completed' | 'incremental'

export interface ScheduledFragmentResult {
  finished: boolean
  error?: string
}

export interface ResponseSpeechSchedulerOptions {
  mode?: ReplyScheduleMode
  /** Must be explicitly true when `mode === 'incremental'`. */
  incrementalConsent?: boolean
  maxInFlight?: number
  maxQueuedSentences?: number
  maxBufferedDurationMs?: number
  maxTotalTextLength?: number
  speakFragment: (text: string, onReadingId?: (id: number) => void) => Promise<ScheduledFragmentResult>
  cancelFragment: (id: number) => void
}

export interface ResponseSchedulerState {
  mode: ReplyScheduleMode
  generationDone: boolean
  playbackDrained: boolean
  quarantined: boolean
  queuedCount: number
  inFlightCount: number
  bufferedDurationMs: number
}

interface QueuedSentence {
  text: string
  estimatedMs: number
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

  constructor(private readonly options: ResponseSpeechSchedulerOptions) {
    const mode = options.mode ?? 'completed'
    if (mode === 'incremental' && options.incrementalConsent !== true) {
      throw new Error('Incremental reply audio requires explicit incremental consent')
    }
    this.mode = mode
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
      queuedCount: this.queue.length,
      inFlightCount: this.inFlight,
      bufferedDurationMs: queuedDuration + this.inFlightDurationMs,
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
    this.queue.length = 0
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
    if (
      !bypassDurationCap &&
      (this.queue.length >= this.maxQueuedSentences ||
        queuedMs + this.inFlightDurationMs + estimatedMs > this.maxBufferedDurationMs)
    ) {
      // Backpressure ceiling exceeded: quarantine only voice scheduling, never the agent.
      this.quarantine()
      return false
    }
    this.queue.push({ text, estimatedMs })
    this.pump()
    return !this.quarantined
  }

  private pump(): void {
    while (!this.cancelled && !this.quarantined && this.inFlight < this.maxInFlight && this.queue.length > 0) {
      const next = this.queue.shift()!
      this.inFlight++
      this.inFlightDurationMs += next.estimatedMs
      let assignedId: number | undefined
      void this.options
        .speakFragment(next.text, (id) => {
          assignedId = id
          if (this.cancelled || this.quarantined) {
            try { this.options.cancelFragment(id) } catch { /* best-effort */ }
          } else {
            this.activeIds.add(id)
          }
        })
        .catch(() => ({ finished: false }))
        .finally(() => {
          if (assignedId !== undefined) this.activeIds.delete(assignedId)
          this.inFlight = Math.max(0, this.inFlight - 1)
          this.inFlightDurationMs = Math.max(0, this.inFlightDurationMs - next.estimatedMs)
          if (!this.cancelled && !this.quarantined) this.pump()
          this.notifyIfDrained()
        })
    }
  }

  private quarantine(): void {
    this.quarantined = true
    this.stop()
  }

  private isDrained(): boolean {
    return (this.generationDone || this.cancelled || this.quarantined) && this.queue.length === 0 && this.inFlight === 0
  }

  private notifyIfDrained(): void {
    if (!this.isDrained()) return
    for (const resolve of this.drainWaiters.splice(0)) resolve()
  }
}
