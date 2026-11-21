import { describe, expect, it, vi } from 'vitest'
import type { AssistantResponseEvent, AssistantRunOwner } from '../../shared/agentRun'
import type { ScheduledFragmentResult } from '../../shared/speech/responseScheduler'
import { ResponseSpeechScheduler } from '../../shared/speech/responseScheduler'
import type { PlaybackMessage } from '../../shared/speech/playback'
import { PlaybackBroker } from './playback'
import { RESPONSE_PLAYBACK_SLOTS, ResponsePlaybackTransport, measuredDurationMs } from './responseTransport'
import type { PcmAudio } from './engines/wav'

/**
 * VOX-A2b — duration and acknowledgement contract, exercised against the REAL
 * broker and synthetic PCM bytes. The renderer is simulated only at the
 * Chromium boundary (`AudioBufferSourceNode`), which is where the ack comes
 * from; nothing about the transport, the broker or the scheduler is stubbed.
 */

const OWNER = 7
const flush = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve) })

function pcmFor(durationMs: number, sampleRate = 24_000): PcmAudio {
  const frames = Math.round((durationMs / 1000) * sampleRate)
  return { pcm: Buffer.alloc(frames * 2, 0x11), sampleRate, channels: 1, bitsPerSample: 16 }
}

function harness(options: { durationMs?: number; synthesize?: (text: string, signal: AbortSignal) => Promise<PcmAudio> } = {}) {
  const sent: PlaybackMessage[] = []
  const broker = new PlaybackBroker((_owner: number, message: PlaybackMessage) => { sent.push(message) })
  const durations: Array<{ readingId: number; durationMs: number }> = []
  const transport = new ResponsePlaybackTransport(
    {
      synthesize: options.synthesize ?? (async () => pcmFor(options.durationMs ?? 1_500)),
      play: (audio, text, signal) => broker.play(OWNER, audio, text, 80, signal),
    },
    { onDuration: (readingId, durationMs) => durations.push({ readingId, durationMs }) },
  )
  const plays = (): Array<Extract<PlaybackMessage, { type: 'play' }>> =>
    sent.filter((message): message is Extract<PlaybackMessage, { type: 'play' }> => message.type === 'play')
  const cancels = (): Array<Extract<PlaybackMessage, { type: 'cancel' }>> =>
    sent.filter((message): message is Extract<PlaybackMessage, { type: 'cancel' }> => message.type === 'cancel')
  return { broker, transport, sent, plays, cancels, durations }
}

describe('measured duration', () => {
  it('is derived from real PCM bytes, never from text length', () => {
    expect(measuredDurationMs(pcmFor(1_500))).toBeCloseTo(1_500, 6)
    expect(measuredDurationMs(pcmFor(60_000))).toBeCloseTo(60_000, 6)
    // Stereo frames are twice the bytes for the same duration.
    const stereo: PcmAudio = { pcm: Buffer.alloc(48_000 * 4), sampleRate: 24_000, channels: 2, bitsPerSample: 16 }
    expect(measuredDurationMs(stereo)).toBeCloseTo(2_000, 6)
    // Unusable audio has no duration to report.
    expect(measuredDurationMs({ pcm: Buffer.alloc(0), sampleRate: 24_000, channels: 1, bitsPerSample: 16 })).toBe(0)
    expect(measuredDurationMs({ pcm: Buffer.alloc(8), sampleRate: 0, channels: 1, bitsPerSample: 16 })).toBe(0)
  })
})

describe('ResponsePlaybackTransport (VOX-A2b)', () => {
  it('confirms a fragment only after the renderer acknowledges it, and reports the measured duration', async () => {
    const { broker, transport, plays, durations } = harness({ durationMs: 1_500 })
    let readingId = 0
    let settled: ScheduledFragmentResult | undefined
    const promise = transport.speakFragment('Hello there.', (id) => { readingId = id }).then((result) => {
      settled = result
      return result
    })

    await flush()
    // Delivered to the renderer, NOT played: no acknowledgement yet.
    expect(plays()).toHaveLength(1)
    expect(settled).toBeUndefined()
    expect(transport.pendingCount).toBe(1)
    expect(durations).toEqual([{ readingId, durationMs: 1_500 }])

    broker.complete(OWNER, plays()[0].id, true)
    await expect(promise).resolves.toEqual({ finished: true, durationMs: 1_500 })
    expect(transport.pendingCount).toBe(0)
  })

  it('treats a rejected acknowledgement as a failure, not as silence or success', async () => {
    const { broker, transport, plays } = harness()
    const promise = transport.speakFragment('Hello there.')
    await flush()
    broker.complete(OWNER, plays()[0].id, false)
    await expect(promise).resolves.toEqual({ finished: false, error: 'Audio playback failed' })
  })

  it('cancels the transport, settles exactly once, and a late acknowledgement cannot resurrect it', async () => {
    const { broker, transport, plays, cancels } = harness()
    let readingId = 0
    const promise = transport.speakFragment('Hello there.', (id) => { readingId = id })
    await flush()
    const transportId = plays()[0].id

    transport.cancelFragment(readingId)
    await expect(promise).resolves.toEqual({ finished: false, error: 'Cancelled' })
    expect(cancels()).toEqual([{ type: 'cancel', id: transportId }])
    expect(transport.pendingCount).toBe(0)
    // The renderer's ack arrives after the fact: it belongs to nobody.
    expect(broker.complete(OWNER, transportId, true)).toBe(false)
  })

  it('a replaced document cancels every pending fragment and refuses new work', async () => {
    const { transport, plays } = harness()
    const first = transport.speakFragment('One sentence.')
    const second = transport.speakFragment('Two sentence.')
    await flush()
    expect(plays()).toHaveLength(1)

    transport.closeAll()
    await expect(first).resolves.toEqual({ finished: false, error: 'Playback document replaced' })
    await expect(second).resolves.toEqual({ finished: false, error: 'Playback document replaced' })
    expect(transport.pendingCount).toBe(0)
    // Closed is terminal for this document; the scheduler reports it as a
    // failed fragment instead of throwing into an event handler.
    expect(() => transport.speakFragment('Three sentence.')).toThrow('closed')
  })

  it('never overlaps two fragments on the single renderer slot', async () => {
    const { broker, transport, plays } = harness()
    expect(RESPONSE_PLAYBACK_SLOTS).toBe(1)
    const first = transport.speakFragment('One sentence.')
    await flush()
    expect(plays()).toHaveLength(1)

    // The sink holds one AudioBufferSourceNode; a second concurrent play would
    // be acknowledged `ok: false` and never heard.
    const second = transport.speakFragment('Two sentence.')
    await flush()
    expect(plays()).toHaveLength(1)

    broker.complete(OWNER, plays()[0].id, true)
    await first
    await flush()
    expect(plays()).toHaveLength(2)
    broker.complete(OWNER, plays()[1].id, true)
    await expect(second).resolves.toMatchObject({ finished: true })
  })

  it('ignores cancellation of unknown or foreign identities', async () => {
    const { broker, transport, plays, cancels } = harness()
    let readingId = 0
    const promise = transport.speakFragment('One sentence.', (id) => { readingId = id })
    await flush()

    transport.cancelFragment(readingId + 99)
    transport.cancelFragment(-1)
    transport.cancelFragment(Number.NaN)
    expect(cancels()).toHaveLength(0)

    broker.complete(OWNER, plays()[0].id, true)
    await expect(promise).resolves.toMatchObject({ finished: true })
  })

  it('cancelling during slow synthesis never reaches the renderer', async () => {
    const { transport, plays } = harness({
      synthesize: (_text, signal) => new Promise<PcmAudio>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
    })
    let readingId = 0
    const promise = transport.speakFragment('One sentence.', (id) => { readingId = id })
    await flush()
    expect(plays()).toHaveLength(0)

    transport.cancelFragment(readingId)
    await expect(promise).resolves.toEqual({ finished: false, error: 'Cancelled' })
    expect(plays()).toHaveLength(0)
    expect(transport.pendingCount).toBe(0)
  })

  it('a fragment cancelled synchronously from onReadingId starts no work at all', async () => {
    const synthesize = vi.fn(async () => pcmFor(1_000))
    const { transport, plays } = harness({ synthesize })
    const result = await transport.speakFragment('One sentence.', (id) => { transport.cancelFragment(id) })
    expect(result).toEqual({ finished: false, error: 'Cancelled' })
    expect(synthesize).not.toHaveBeenCalled()
    expect(plays()).toHaveLength(0)
  })
})

describe('scheduler over the real transport (VOX-A2b)', () => {
  const owner: AssistantRunOwner = { sessionId: 'convo-1', runId: 'run-1', epoch: 'epoch-1' }
  const source = { provider: 'claude' as const, sessionId: '550e8400-e29b-41d4-a716-446655440000', turnId: null }
  const ev = (sequence: number, payload: Record<string, unknown>): AssistantResponseEvent =>
    ({ ...payload, owner, source, sequence }) as AssistantResponseEvent

  it('the last piece is not drained, and not counted as heard, until the renderer acknowledges it', async () => {
    const { broker, transport, plays } = harness({ durationMs: 800 })
    const scheduler = new ResponseSpeechScheduler({
      speakFragment: (text, onReadingId, onMeasuredDuration) =>
        transport.speakFragment(text, onReadingId, onMeasuredDuration),
      cancelFragment: (id) => transport.cancelFragment(id),
    })

    scheduler.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    scheduler.push(ev(2, { type: 'text-delta', responseId: 'r1', text: 'The answer is ready.\n\n' }))
    scheduler.push(ev(3, { type: 'response-end', responseId: 'r1', outcome: 'completed' }))
    scheduler.push(ev(4, { type: 'run-end', outcome: 'completed' }))
    await flush()

    // Text generation finished; the audio was delivered but not played.
    expect(plays()).toHaveLength(1)
    expect(scheduler.state().generationDone).toBe(true)
    expect(scheduler.state().playbackDrained).toBe(false)
    expect(scheduler.state().spokenSentences).toBe(0)
    let drained = false
    const drainedPromise = scheduler.whenDrained().then(() => { drained = true })
    await flush()
    expect(drained).toBe(false)

    broker.complete(OWNER, plays()[0].id, true)
    await drainedPromise
    expect(scheduler.state().playbackDrained).toBe(true)
    expect(scheduler.state().spokenSentences).toBe(1)
    // The measured 800ms of audio, not the ~1s text estimate.
    expect(scheduler.state().spokenDurationMs).toBeCloseTo(800, 6)
  })

  it('a renderer that stops answering leaves the reply unfinished instead of falsely heard', async () => {
    vi.useFakeTimers()
    try {
      const { transport, plays } = harness({ durationMs: 500 })
      const scheduler = new ResponseSpeechScheduler({
        speakFragment: (text, onReadingId, onMeasuredDuration) =>
          transport.speakFragment(text, onReadingId, onMeasuredDuration),
        cancelFragment: (id) => transport.cancelFragment(id),
        onFragmentError: vi.fn(),
      })
      scheduler.push(ev(1, { type: 'response-start', responseId: 'r2' }))
      scheduler.push(ev(2, { type: 'text-delta', responseId: 'r2', text: 'No answer arrives.\n\n' }))
      scheduler.push(ev(3, { type: 'response-end', responseId: 'r2', outcome: 'completed' }))
      scheduler.push(ev(4, { type: 'run-end', outcome: 'completed' }))
      await vi.advanceTimersByTimeAsync(1)
      expect(plays()).toHaveLength(1)

      // PlaybackBroker gives up after max(30s, duration + 30s) and reports a
      // timeout: the fragment is a failure, never a spoken sentence.
      await vi.advanceTimersByTimeAsync(31_000)
      await vi.runAllTimersAsync()
      expect(scheduler.state().failedSentences).toBe(1)
      expect(scheduler.state().spokenSentences).toBe(0)
      await scheduler.whenDrained()
      expect(scheduler.state().playbackDrained).toBe(true)
    } finally { vi.useRealTimers() }
  })
})
