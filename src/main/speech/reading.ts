/** Serial reading orchestration, independent of Electron and playback implementation. */
import { sanitizeText } from '../../shared/speech/sanitize'
import { paginateText } from '../../shared/speech/paginate'
import type { AppConfig, SpeechStatus } from '../../shared/speech/types'
import type { PcmAudio } from './engines/wav'

export interface ReadingDependencies {
  synthesize(text: string, config: AppConfig, signal: AbortSignal): Promise<PcmAudio>
  play(audio: PcmAudio, text: string, signal: AbortSignal): Promise<void>
  onStatus(status: SpeechStatus): void
}
export type ReadingOutcome = { finished: true } | { finished: false; error: string }
interface Job { id: number; text: string; config: AppConfig; resolve: (outcome: ReadingOutcome) => void }
const MAX_QUEUE = 10

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
    let outcome: ReadingOutcome = { finished: false, error: 'Cancelled' }
    try {
      const text = sanitizeText(job.text, job.config.sanitization)
      if (!text.trim()) throw new Error('No speakable text remains after sanitization')
      const fragments = paginateText(text, job.config.pagination)
      const profile = job.config.tts.profiles.find((item) => item.id === job.config.tts.active_profile_id)
      this.update(job, { speaking: true, synthesizing: true, engine: job.config.tts.active_backend, profileName: profile?.name ?? null, fragmentTotal: fragments.length, readingId: job.id, paused: false })
      for (const fragment of fragments) {
        signal.throwIfAborted()
        this.update(job, { fragment: fragment.index + 1, synthesizing: true })
        const audio = await this.deps.synthesize(fragment.text, job.config, signal)
        signal.throwIfAborted()
        this.update(job, { synthesizing: false })
        await this.deps.play(audio, fragment.text, signal)
        signal.throwIfAborted()
      }
      outcome = { finished: true }
    } catch (error) {
      outcome = { finished: false, error: signal.aborted ? 'Cancelled' : error instanceof Error ? error.message : 'Speech failed' }
    } finally {
      this.update(job, { speaking: false, synthesizing: false, engine: null, profileName: null, fragment: 0, fragmentTotal: 0, readingId: 0, paused: false })
      if (this.active?.job === job) this.active = undefined
      job.resolve(outcome)
      this.startNext()
    }
  }
}
