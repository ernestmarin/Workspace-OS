/**
 * VOX-A2b — the acknowledged response-playback transport.
 *
 * Binds the bounded `ResponseSpeechScheduler` (shared) to the real
 * `PlaybackBroker` and to the renderer sink that actually plays audio
 * (`src/renderer/src/components/Voice/VoicePlayback.tsx`). Both sides were ambiguous
 * before, and the ambiguity only ever made speech look healthier than it was:
 *
 *  - ENQUEUED is not DELIVERED. The scheduler queues sentences; nothing has
 *    reached a speaker at that point.
 *  - SENT is not PLAYED. `PlaybackBroker.play()` is deliberately acknowledged:
 *    the renderer answers `speech:playback-done` when its buffer source ends.
 *    This transport therefore forwards the broker's promise unchanged and
 *    never resolves `finished: true` on a bare `send`.
 *  - ENDED is not CANCELLED and not ERROR. A stop, a timeout, a rejected
 *    acknowledgement, a replaced document and a synthesis failure all resolve
 *    `finished: false` with a reason; only a confirmed acknowledgement counts
 *    as heard.
 *
 * The renderer holds ONE `AudioBufferSourceNode` at a time and acknowledges any
 * second concurrent `play` with `ok: false`. So the transport advertises that
 * capacity (`RESPONSE_PLAYBACK_SLOTS`) and serialises fragments behind a single
 * slot rather than letting the sink reject audio the user never heard. The
 * scheduler must be built with `maxInFlight: RESPONSE_PLAYBACK_SLOTS`; a wider
 * value does not lose text, it just waits here instead of at the sink.
 *
 * Durations reported here are MEASURED from the synthesized PCM, not estimated
 * from text length. They are reported as soon as they are known (before
 * playback ends) so backpressure can act on real audio length.
 */
import type { ScheduledFragmentResult } from '../../shared/speech/responseScheduler'
import type { PcmAudio } from './engines/wav'

export interface ResponseTransportDependencies {
  synthesize(text: string, signal: AbortSignal): Promise<PcmAudio>
  /** Must resolve only when playback was confirmed, not when it was requested. */
  play(audio: PcmAudio, text: string, signal: AbortSignal): Promise<void>
}

export interface ResponseTransportOptions {
  /** Measured duration of a fragment, reported before playback ends. */
  onDuration?: (readingId: number, durationMs: number) => void
}

/** One audio slot: the renderer plays a single buffer at a time. */
export const RESPONSE_PLAYBACK_SLOTS = 1

interface PendingFragment {
  id: number
  abort: AbortController
  settled: boolean
  holdsSlot: boolean
  grant?: () => void
  resolve: (result: ScheduledFragmentResult) => void
}

/** Real duration of PCM audio in milliseconds; 0 when the audio is unusable. */
export function measuredDurationMs(audio: PcmAudio): number {
  const bytesPerFrame = audio.channels * (audio.bitsPerSample / 8)
  if (!audio?.pcm?.length || !(audio.sampleRate > 0) || !(bytesPerFrame > 0)) return 0
  return (audio.pcm.length / bytesPerFrame / audio.sampleRate) * 1000
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Speech fragment failed'
}

export class ResponsePlaybackTransport {
  private readonly pending = new Map<number, PendingFragment>()
  private readonly waiters: PendingFragment[] = []
  private busy = false
  private nextId = 1
  private closed = false

  constructor(
    private readonly deps: ResponseTransportDependencies,
    private readonly options: ResponseTransportOptions = {},
  ) {}

  /** Fragments that have been handed to the transport and not yet settled. */
  get pendingCount(): number {
    return this.pending.size
  }

  /**
   * Never resolves `finished: true` without the sink's acknowledgement. Throws
   * synchronously only when the transport is already closed, which the
   * scheduler treats as a failed fragment.
   */
  speakFragment(
    text: string,
    onReadingId?: (id: number) => void,
    onMeasuredDuration?: (durationMs: number) => void,
  ): Promise<ScheduledFragmentResult> {
    if (this.closed) throw new Error('Playback transport is closed')
    if (typeof text !== 'string' || !text.trim()) {
      return Promise.resolve({ finished: false, error: 'Empty speech fragment' })
    }
    const id = this.nextId++
    let deliver!: (result: ScheduledFragmentResult) => void
    const promise = new Promise<ScheduledFragmentResult>((resolve) => { deliver = resolve })
    const fragment: PendingFragment = {
      id,
      abort: new AbortController(),
      settled: false,
      holdsSlot: false,
      resolve: (result) => {
        // Exactly one outcome per fragment: a late acknowledgement, a second
        // cancel or a duplicate close can never rewrite what was already heard.
        if (fragment.settled) return
        fragment.settled = true
        this.pending.delete(id)
        this.removeWaiter(fragment)
        deliver(result)
      },
    }
    this.pending.set(id, fragment)
    try {
      onReadingId?.(id)
    } catch { /* the caller's bookkeeping must not break dispatch */ }
    // The scheduler cancels re-entrantly from `onReadingId` when it is already
    // stopping; a fragment cancelled at that instant must start no work.
    if (!fragment.settled) void this.run(fragment, text, onMeasuredDuration)
    return promise
  }

  /** Cancels one fragment only. Unknown ids never cancel somebody else's audio. */
  cancelFragment(id: number): void {
    const fragment = this.pending.get(id)
    if (!fragment) return
    fragment.resolve({ finished: false, error: 'Cancelled' })
    // The broker sends the renderer `cancel` for this id and rejects its own
    // promise; the rejection is already accounted for above.
    fragment.abort.abort()
  }

  /** Document replaced, window destroyed or voice stopped: nothing survives. */
  closeAll(reason = 'Playback document replaced'): void {
    this.closed = true
    for (const fragment of [...this.pending.values()]) {
      fragment.resolve({ finished: false, error: reason })
      fragment.abort.abort()
    }
  }

  private async run(
    fragment: PendingFragment,
    text: string,
    onMeasuredDuration?: (durationMs: number) => void,
  ): Promise<void> {
    const signal = fragment.abort.signal
    try {
      signal.throwIfAborted()
      const audio = await this.deps.synthesize(text, signal)
      signal.throwIfAborted()
      if (fragment.settled) return
      const durationMs = measuredDurationMs(audio)
      if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('Synthesized audio has no measurable duration')
      try { onMeasuredDuration?.(durationMs) } catch { /* accounting must not break audio */ }
      try { this.options.onDuration?.(fragment.id, durationMs) } catch { /* listener must not break audio */ }
      await this.acquire(fragment)
      signal.throwIfAborted()
      if (fragment.settled) return
      await this.deps.play(audio, text, signal)
      fragment.resolve({ finished: true, durationMs })
    } catch (error) {
      fragment.resolve({ finished: false, error: signal.aborted ? 'Cancelled' : errorText(error) })
    } finally {
      if (fragment.holdsSlot) {
        fragment.holdsSlot = false
        this.busy = false
        this.grantNext()
      }
      this.removeWaiter(fragment)
    }
  }

  private acquire(fragment: PendingFragment): Promise<void> {
    if (!this.busy) {
      this.busy = true
      fragment.holdsSlot = true
      return Promise.resolve()
    }
    return new Promise<void>((grant) => {
      fragment.grant = grant
      this.waiters.push(fragment)
    })
  }

  private grantNext(): void {
    while (!this.busy && this.waiters.length) {
      const next = this.waiters.shift()!
      const grant = next.grant
      next.grant = undefined
      // A cancelled waiter is skipped; its slot was never taken.
      if (next.settled || next.abort.signal.aborted) continue
      this.busy = true
      next.holdsSlot = true
      grant?.()
      return
    }
  }

  private removeWaiter(fragment: PendingFragment): void {
    const index = this.waiters.indexOf(fragment)
    if (index >= 0) this.waiters.splice(index, 1)
    fragment.grant = undefined
  }
}
