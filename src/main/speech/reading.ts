/** Serial reading orchestration, independent of Electron and playback implementation. */
import { sanitizeText } from '../../shared/speech/sanitize'
import { paginateText } from '../../shared/speech/paginate'
import type { AppConfig, SpeechStatus } from '../../shared/speech/types'
import type { PcmAudio } from './engines/wav'

export interface ReadingDependencies {
  synthesize(text: string, config: AppConfig, signal: AbortSignal): Promise<PcmAudio>
  play(audio: PcmAudio, text: string, signal: AbortSignal, config: AppConfig): Promise<void>
  onStatus(status: SpeechStatus): void
}
export type ReadingOutcome = { finished: true } | { finished: false; error: string }
interface Job { id: number; text: string; config: AppConfig; resolve: (outcome: ReadingOutcome) => void }
const MAX_QUEUE = 10
const OPENAI_MAX_UTF16 = 4096

/** Provider limits apply even when user pagination is disabled or a token is huge. */
export function splitProviderText(text: string, limit: number): string[] {
  if (!Number.isInteger(limit) || limit < 2) throw new RangeError('Invalid provider text limit')
  const result: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + limit, text.length)
    if (end < text.length) {
      // Never split a UTF-16 surrogate pair.
      const before = text.charCodeAt(end - 1)
      const after = text.charCodeAt(end)
      if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end--
      const boundary = text.lastIndexOf(' ', end - 1)
      if (boundary > start + limit / 2) end = boundary + 1
    }
    const part = text.slice(start, end).trim()
    if (part) result.push(part)
    start = end
  }
  return result
}

export class ReadingController {
  private active: { job: Job; abort: AbortController } | undefined
  private queue: Job[] = []
  private nextId = 1
  private status: SpeechStatus = { speaking: false, synthesizing: false, engine: null, profileName: null, fragment: 0, fragmentTotal: 0, readingId: 0, paused: false }
  constructor(private readonly deps: ReadingDependencies) {}

  getStatus(): SpeechStatus { return { ...this.status } }

  read(text: string, config: AppConfig): { id: number; result: Promise<ReadingOutcome> } {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Speech text is empty')
    if (text.length > config.trigger.max_text_length) throw new Error('Speech text exceeds configured limit')
    if (this.active && config.playback.on_retrigger === 'queue' && this.queue.length >= MAX_QUEUE) throw new Error('Speech queue is full')
    const id = this.nextId++
    let resolve!: (result: ReadingOutcome) => void
    const result = new Promise<ReadingOutcome>((done) => { resolve = done })
    const job: Job = { id, text, config: structuredClone(config), resolve }
    if (this.active && config.playback.on_retrigger === 'interrupt') {
      this.stop()
    }
    this.queue.push(job)
    this.startNext()
    return { id, result }
  }

  stop(): void {
    for (const job of this.queue.splice(0)) job.resolve({ finished: false, error: 'Cancelled' })
    this.active?.abort.abort()
  }

  /** Cancel one reading only; does not stop other queued jobs or any agent run. */
  cancel(id: number): boolean {
    if (!Number.isSafeInteger(id) || id < 1) return false
    if (this.active?.job.id === id) {
      if (this.active.abort.signal.aborted) return false
      this.active.abort.abort()
      return true
    }
    const index = this.queue.findIndex((job) => job.id === id)
    if (index < 0) return false
    const [job] = this.queue.splice(index, 1)
    job.resolve({ finished: false, error: 'Cancelled' })
    return true
  }

  private startNext(): void {
    if (this.active || !this.queue.length) return
    const job = this.queue.shift()!
    const abort = new AbortController()
    this.active = { job, abort }
    void this.run(job, abort.signal)
  }

  private update(job: Job, patch: Partial<SpeechStatus>): void {
    if (this.active?.job !== job) return
    this.status = { ...this.status, ...patch }
    try { this.deps.onStatus(this.getStatus()) } catch { /* observers must not interrupt playback */ }
  }

  private async run(job: Job, signal: AbortSignal): Promise<void> {
    // A scoped signal also cancels lookahead when playback fails without a user stop.
    const synthesisAbort = new AbortController()
    const abortSynthesis = (): void => synthesisAbort.abort()
    signal.addEventListener('abort', abortSynthesis, { once: true })
    if (signal.aborted) synthesisAbort.abort()
    type Prepared = { audio: PcmAudio } | { error: unknown }
    let pending: Promise<Prepared> | undefined
    const prepare = (text: string): Promise<Prepared> => {
      this.update(job, { synthesizing: true })
      // Always handle a rejection immediately: lookahead may fail during playback.
      return (async (): Promise<Prepared> => {
        try {
          synthesisAbort.signal.throwIfAborted()
          return { audio: await this.deps.synthesize(text, job.config, synthesisAbort.signal) }
        } catch (error) { return { error } }
        finally { this.update(job, { synthesizing: false }) }
      })()
    }
    let outcome: ReadingOutcome = { finished: false, error: 'Cancelled' }
    try {
      const text = sanitizeText(job.text, job.config.sanitization)
      if (!text.trim()) throw new Error('No speakable text remains after sanitization')
      const profile = job.config.tts.profiles.find((item) => item.id === job.config.tts.active_profile_id)
      const engine = profile?.engine ?? job.config.tts.active_backend
      const parts = paginateText(text, job.config.pagination).flatMap((fragment) =>
        engine === 'openai' ? splitProviderText(fragment.text, OPENAI_MAX_UTF16) : [fragment.text],
      )
      const fragments = parts.map((fragment, index) => ({ text: fragment, index }))
      this.update(job, { speaking: true, synthesizing: true, engine: profile?.engine ?? job.config.tts.active_backend, profileName: profile?.name ?? null, fragmentTotal: fragments.length, readingId: job.id, paused: false })
      for (const fragment of fragments) {
        signal.throwIfAborted()
        this.update(job, { fragment: fragment.index + 1 })
        pending ??= prepare(fragment.text)
        const prepared = await pending
        pending = undefined
        signal.throwIfAborted()
        if ('error' in prepared) throw prepared.error
        // Bounded lookahead: one synthesis, one active playback, never a whole
        // reading buffered in advance. Off retains strictly serial behavior.
        const next = fragments[fragment.index + 1]
        if (job.config.playback.prefetch_next_fragment && next) pending = prepare(next.text)
        await this.deps.play(prepared.audio, fragment.text, signal, job.config)
        signal.throwIfAborted()
      }
      outcome = { finished: true }
    } catch (error) {
      outcome = { finished: false, error: signal.aborted ? 'Cancelled' : error instanceof Error ? error.message : 'Speech failed' }
    } finally {
      signal.removeEventListener('abort', abortSynthesis)
      synthesisAbort.abort()
      // Do not let a cancelled local child overlap the next reading's engine.
      if (pending) await pending
      this.update(job, { speaking: false, synthesizing: false, engine: null, profileName: null, fragment: 0, fragmentTotal: 0, readingId: 0, paused: false })
      if (this.active?.job === job) this.active = undefined
      job.resolve(outcome)
      this.startNext()
    }
  }
}
