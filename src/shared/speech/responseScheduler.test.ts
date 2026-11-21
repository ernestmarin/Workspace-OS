import { describe, expect, it, vi } from 'vitest'
import type { AssistantResponseEvent, AssistantRunOwner } from '../agentRun'
import { ResponseSpeechScheduler } from './responseScheduler'

const owner: AssistantRunOwner = { sessionId: 'convo-1', runId: 'run-1', epoch: 'epoch-1' }
const source = { provider: 'claude' as const, sessionId: '550e8400-e29b-41d4-a716-446655440000', turnId: null }

function ev(seq: number, payload: Record<string, unknown>): AssistantResponseEvent {
  return { ...payload, owner, source, sequence: seq } as AssistantResponseEvent
}

describe('ResponseSpeechScheduler (VOX-A2 & VOX-A3)', () => {
  it('defaults to completed mode unless explicit incrementalConsent is frozen on the session', async () => {
    const spoken: string[] = []
    const scheduler = new ResponseSpeechScheduler({
      mode: 'completed',
      incrementalConsent: false,
      speakFragment: async (text) => { spoken.push(text); return { finished: true } },
      cancelFragment: vi.fn(),
    })

    scheduler.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    scheduler.push(ev(2, { type: 'text-delta', responseId: 'r1', text: 'First sentence. Second sentence.\n\n' }))
    // Completed mode must NOT dispatch sentences before run-end!
    expect(spoken).toEqual([])

    scheduler.push(ev(3, { type: 'response-end', responseId: 'r1', outcome: 'completed' }))
    scheduler.push(ev(4, { type: 'run-end', outcome: 'completed' }))
    await scheduler.whenDrained()
    expect(spoken).toEqual(['First sentence. Second sentence.'])
  })

  it('refuses incremental mode if incrementalConsent was not explicitly granted', () => {
    expect(() => new ResponseSpeechScheduler({
      mode: 'incremental',
      incrementalConsent: false,
      speakFragment: async () => ({ finished: true }),
      cancelFragment: vi.fn(),
    })).toThrow(/incremental consent/i)
  })

  it('streams stable prose sentences incrementally with distinct generationDone vs playbackDrained, and cancels in-flight audio on run failure', async () => {
    const pendingResolvers: Array<(res: { finished: boolean; error?: string }) => void> = []
    const cancelledIds: number[] = []
    let nextId = 1

    const scheduler = new ResponseSpeechScheduler({
      mode: 'incremental',
      incrementalConsent: true,
      maxInFlight: 2,
      maxQueuedSentences: 4,
      maxBufferedDurationMs: 25_000,
      speakFragment: (_text, onId) => {
        const id = nextId++
        onId?.(id)
        return new Promise((resolve) => { pendingResolvers.push(resolve) })
      },
      cancelFragment: (id) => { cancelledIds.push(id) },
    })

    scheduler.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    // Blank line closes stable Markdown prose block so SentenceStream emits completed sentence
    scheduler.push(ev(2, { type: 'text-delta', responseId: 'r1', text: 'Hello there. Next part.\n\n' }))
    expect(pendingResolvers.length).toBeGreaterThanOrEqual(1)
    expect(scheduler.state().generationDone).toBe(false)
    expect(scheduler.state().playbackDrained).toBe(false)

    // Turn fails mid-stream -> must cancel in-flight audio and never resume
    scheduler.push(ev(3, { type: 'run-end', outcome: 'failed' }))
    expect(cancelledIds.length).toBeGreaterThanOrEqual(1)
    for (const resolve of pendingResolvers) resolve({ finished: false, error: 'Cancelled' })
    await scheduler.whenDrained()
    expect(scheduler.state().playbackDrained).toBe(true)
  })

  it('applies bounded duration/queue backpressure by sealing only the voice scheduler on runaway output', async () => {
    const cancelledIds: number[] = []
    let nextId = 1
    const scheduler = new ResponseSpeechScheduler({
      mode: 'incremental',
      incrementalConsent: true,
      maxInFlight: 1,
      maxQueuedSentences: 2,
      maxBufferedDurationMs: 5_000,
      speakFragment: (_text, onId) => {
        onId?.(nextId++)
        return new Promise(() => { /* never drains during burst */ })
      },
      cancelFragment: (id) => { cancelledIds.push(id) },
    })

    scheduler.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    scheduler.push(ev(2, {
      type: 'text-delta',
      responseId: 'r1',
      text: 'Sentence one is spoken now. Sentence two queues up. Sentence three queues up. Sentence four overflows the bounded queue.\n\n',
    }))

    expect(scheduler.state().quarantined).toBe(true)
    expect(cancelledIds).toEqual([1])
  })
})

/**
 * VOX-A2a — bounded live planner with REAL backpressure.
 *
 * The pre-A2a scheduler had one reaction to a producer that outran the voice: it
 * quarantined the whole reply, so a slightly slow TTS model silently swallowed
 * the rest of the answer. These are the invariants of the alternative: the
 * listener is told, nothing is dropped silently, playback accounting separates
 * "text generated" from "text heard", and the agent is never touched.
 */
describe('ResponseSpeechScheduler — backpressure (VOX-A2a)', () => {
  function harness(opts: {
    backpressure?: 'hold' | 'quarantine'
    maxQueued?: number
    maxBuffered?: number
    maxInFlight?: number
  } = {}) {
    const pending: Array<{ text: string; resolve: (r: { finished: boolean; error?: string }) => void }> = []
    const cancelled: number[] = []
    const reports: Array<{ held: boolean; reason: string | null; released: number; discarded: number }> = []
    let nextId = 1
    const scheduler = new ResponseSpeechScheduler({
      mode: 'incremental',
      incrementalConsent: true,
      backpressure: opts.backpressure ?? 'hold',
      maxInFlight: opts.maxInFlight ?? 1,
      maxQueuedSentences: opts.maxQueued ?? 2,
      maxBufferedDurationMs: opts.maxBuffered ?? 25_000,
      onBackpressure: (r) => reports.push({ ...r }),
      speakFragment: (text, onId) => {
        const id = nextId++
        onId?.(id)
        return new Promise((resolve) => { pending.push({ text, resolve }) })
      },
      cancelFragment: (id) => { cancelled.push(id) },
    })
    return { scheduler, pending, cancelled, reports }
  }

  const finish = async (p: { resolve: (r: { finished: boolean }) => void }, finished = true): Promise<void> => {
    p.resolve({ finished })
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
  }

  it('holds instead of quarantining, and reports the hold', async () => {
    const { scheduler, pending, reports } = harness({ maxQueued: 3 })
    scheduler.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    // Four sentences, one in flight, one queued, then the ceiling.
    scheduler.push(ev(2, { type: 'text-delta', responseId: 'r1', text: 'One is here. Two is here. Three is here. Four is here. Five is here. Six is here.\n\n' }))

    expect(pending).toHaveLength(1)
    expect(scheduler.state().backpressured).toBe(true)
    expect(scheduler.state().quarantined).toBe(false)
    expect(reports.some((r) => r.held && r.reason !== null)).toBe(true)
    // Nothing was thrown away to make room: the sentences are still queued.
    expect(scheduler.state().queuedCount).toBeGreaterThan(0)

    // Everything that was generated is either spoken or still queued; a hold
    // never silently drops text.
    while (pending.length) await finish(pending.shift()!)
    expect(scheduler.state().discardedSentences).toBe(0)
    expect(scheduler.state().spokenSentences).toBeGreaterThan(1)
    expect(reports.some((r) => !r.held)).toBe(true)
  })

  it('quarantines under the legacy policy, and says so exactly once', () => {
    const { scheduler } = harness({ backpressure: 'quarantine', maxQueued: 1 })
    const reasons: string[] = []
    const s2 = new ResponseSpeechScheduler({
      mode: 'incremental',
      incrementalConsent: true,
      backpressure: 'quarantine',
      maxInFlight: 1,
      maxQueuedSentences: 1,
      speakFragment: async () => new Promise(() => {}),
      cancelFragment: vi.fn(),
      onQuarantine: (r) => reasons.push(r),
    })
    s2.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    s2.push(ev(2, { type: 'text-delta', responseId: 'r1', text: 'One is here. Two is here. Three is here. Four is here. Five is here.\n\n' }))
    expect(s2.state().quarantined).toBe(true)
    expect(reasons).toContain('queue-overflow')
    // The legacy path still produced what it could.
    expect(scheduler.state().quarantined).toBe(false)
  })

  it('counts what it discarded when the hold itself overflows, never silently', async () => {
    const { scheduler, pending } = harness({ maxQueued: 1 })
    scheduler.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    const many = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} is here.`).join(' ')
    scheduler.push(ev(2, { type: 'text-delta', responseId: 'r1', text: many + '\n\n' }))
    // 1 in flight + a bounded held queue; the rest are counted as discarded.
    expect(scheduler.state().discardedSentences).toBeGreaterThan(0)
    while (pending.length) await finish(pending.shift()!)
    expect(scheduler.state().spokenSentences).toBeGreaterThan(0)
  })

  it('separates generationDone from playbackDrained while holding', async () => {
    const { scheduler, pending } = harness({ maxQueued: 1 })
    scheduler.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    scheduler.push(ev(2, { type: 'text-delta', responseId: 'r1', text: 'One is here. Two is here.\n\n' }))
    scheduler.push(ev(3, { type: 'response-end', responseId: 'r1', outcome: 'completed' }))
    scheduler.push(ev(4, { type: 'run-end', outcome: 'completed' }))
    expect(scheduler.state().generationDone).toBe(true)
    // Text is complete, audio is not: the two are NOT the same event.
    expect(scheduler.state().playbackDrained).toBe(false)
    while (pending.length) await finish(pending.shift()!)
    await scheduler.whenDrained()
    expect(scheduler.state().playbackDrained).toBe(true)
  })

  it('a stop discards the queue, cancels audio, and never touches the run', async () => {
    const { scheduler, pending, cancelled } = harness({ maxQueued: 4 })
    scheduler.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    scheduler.push(ev(2, { type: 'text-delta', responseId: 'r1', text: 'One is here. Two is here. Three is here. Four is here.\n\n' }))
    const queuedBefore = scheduler.state().queuedCount
    expect(queuedBefore).toBeGreaterThan(1)
    scheduler.stop()
    expect(scheduler.state().queuedCount).toBe(0)
    // Queued text is discarded (and counted); the in-flight fragment is
    // cancelled instead — it was never heard, so it is not "spoken" either.
    expect(scheduler.state().discardedSentences).toBe(queuedBefore)
    expect(cancelled.length).toBeGreaterThan(0)
    // A fragment that settles AFTER the stop is not counted as heard.
    while (pending.length) await finish(pending.shift()!, true)
    expect(scheduler.state().spokenSentences).toBe(0)
  })

  it('a failed source discards queued audio and stops speaking immediately', async () => {
    const { scheduler, pending, cancelled } = harness({ maxQueued: 4 })
    scheduler.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    scheduler.push(ev(2, { type: 'text-delta', responseId: 'r1', text: 'One is here. Two is here.\n\n' }))
    scheduler.push(ev(3, { type: 'source-error', responseId: 'r1', message: 'provider closed' }))
    expect(scheduler.state().quarantined).toBe(true)
    expect(scheduler.state().queuedCount).toBe(0)
    expect(cancelled.length).toBeGreaterThan(0)
    while (pending.length) await finish(pending.shift()!)
    expect(scheduler.state().spokenSentences).toBe(0)
  })

  it('ignores deltas that arrive after generation is done', async () => {
    const { scheduler, pending } = harness({ maxQueued: 4 })
    scheduler.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    scheduler.push(ev(2, { type: 'text-delta', responseId: 'r1', text: 'One is here.\n\n' }))
    scheduler.push(ev(3, { type: 'run-end', outcome: 'completed' }))
    const before = scheduler.state()
    scheduler.push(ev(4, { type: 'text-delta', responseId: 'r1', text: 'Late text. More late text.\n\n' }))
    expect(scheduler.state().queuedCount).toBe(before.queuedCount)
    while (pending.length) await finish(pending.shift()!)
  })

  it('releases the hold when playback catches up, exactly once per hold', async () => {
    const { scheduler, pending, reports } = harness({ maxQueued: 1 })
    scheduler.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    scheduler.push(ev(2, { type: 'text-delta', responseId: 'r1', text: 'One is here. Two is here. Three is here. Four is here. Five is here.\n\n' }))
    expect(scheduler.state().backpressured).toBe(true)
    while (pending.length) await finish(pending.shift()!)
    const held = reports.filter((r) => r.held).length
    const released = reports.filter((r) => !r.held).length
    expect(held).toBeGreaterThan(0)
    expect(released).toBe(held)
    expect(scheduler.state().backpressured).toBe(false)
  })
})

/**
 * VOX-A2b — the transport contract.
 *
 * A scheduler that only ever talks to a promise-returning stub cannot tell the
 * difference between three things the real path does differently:
 *
 *  - a transport that THROWS synchronously (the existing main-side play guard
 *    does exactly this when the document is gone),
 *  - a fragment whose real audio is far longer than its text estimate,
 *  - a fragment that never confirmed playback.
 *
 * These are the invariants of the boundary, not of the audio itself.
 */
describe('ResponseSpeechScheduler — transport boundary (VOX-A2b)', () => {
  const flush = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve) })

  it('treats a synchronous transport throw as a failed fragment, never as a spoken one, and still drains', async () => {
    const cancelled: number[] = []
    const failures: string[] = []
    const scheduler = new ResponseSpeechScheduler({
      mode: 'completed',
      maxInFlight: 1,
      speakFragment: () => { throw new Error('Playback document is unavailable') },
      cancelFragment: (id) => { cancelled.push(id) },
      onFragmentError: (message) => { failures.push(message) },
    })

    scheduler.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    scheduler.push(ev(2, { type: 'text-delta', responseId: 'r1', text: 'Only one sentence here.\n\n' }))
    scheduler.push(ev(3, { type: 'response-end', responseId: 'r1', outcome: 'completed' }))
    // A dead transport must not escape as an exception into the caller: this is
    // reached from an IPC/event handler whose failure would be a crash, not a
    // dropped sentence.
    expect(() => scheduler.push(ev(4, { type: 'run-end', outcome: 'completed' }))).not.toThrow()
    await flush()

    // A transport refusal is NOT a text overflow: the reply is healthy and the
    // scheduler must not quarantine it over a dead audio sink.
    expect(scheduler.state().quarantined).toBe(false)
    expect(scheduler.state().inFlightCount).toBe(0)
    expect(scheduler.state().spokenSentences).toBe(0)
    expect(scheduler.state().failedSentences).toBe(1)
    expect(failures).toEqual(['Playback document is unavailable'])
    expect(cancelled).toEqual([])
    // In-flight accounting was leaked before this contract existed, so the
    // drain promise never resolved and every later await hung.
    await scheduler.whenDrained()
    expect(scheduler.state().playbackDrained).toBe(true)
  })

  it('holds on the measured audio duration, not on the text estimate', async () => {
    const pending: Array<{ resolve: (r: { finished: boolean }) => void; prepared?: (durationMs: number) => void }> = []
    const reports: Array<{ held: boolean; reason: string | null }> = []
    let nextId = 1
    const scheduler = new ResponseSpeechScheduler({
      mode: 'incremental',
      incrementalConsent: true,
      backpressure: 'hold',
      maxInFlight: 1,
      maxQueuedSentences: 4,
      maxBufferedDurationMs: 25_000,
      onBackpressure: (report) => { reports.push({ held: report.held, reason: report.reason }) },
      speakFragment: (_text, onId, onPrepared) => {
        const id = nextId++
        onId?.(id)
        return new Promise((resolve) => { pending.push({ resolve, prepared: onPrepared }) })
      },
      cancelFragment: vi.fn(),
    })

    scheduler.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    scheduler.push(ev(2, {
      type: 'text-delta',
      responseId: 'r1',
      text: 'Short one. Short two. Short three. Short four.\n\n',
    }))
    expect(pending).toHaveLength(1)
    expect(scheduler.state().backpressured).toBe(false)

    // The first sentence is 10 characters of text but 30 seconds of audio.
    pending[0].prepared?.(30_000)
    expect(scheduler.state().bufferedDurationMs).toBeGreaterThanOrEqual(30_000)
    expect(scheduler.state().backpressured).toBe(true)
    expect(reports.at(-1)).toEqual({ held: true, reason: 'duration-cap' })
    // Nothing further was dispatched on the strength of a 400ms guess.
    expect(pending).toHaveLength(1)

    // Once the audio really ends, the hold releases and speech continues.
    pending.shift()!.resolve({ finished: true })
    await flush()
    expect(scheduler.state().backpressured).toBe(false)
    expect(pending).toHaveLength(1)
  })

  it('loses only the fragment the transport refused, not the rest of the reply', async () => {
    const spoken: string[] = []
    const failures: string[] = []
    const scheduler = new ResponseSpeechScheduler({
      mode: 'incremental',
      incrementalConsent: true,
      maxInFlight: 1,
      maxQueuedSentences: 4,
      speakFragment: (text) => {
        if (text.startsWith('First')) return Promise.reject(new Error('Synthesis failed'))
        spoken.push(text)
        return Promise.resolve({ finished: true, durationMs: 900 })
      },
      cancelFragment: vi.fn(),
      onFragmentError: (message) => { failures.push(message) },
    })

    scheduler.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    scheduler.push(ev(2, { type: 'text-delta', responseId: 'r1', text: 'First line is lost. Second line is heard.\n\n' }))
    scheduler.push(ev(3, { type: 'response-end', responseId: 'r1', outcome: 'completed' }))
    scheduler.push(ev(4, { type: 'run-end', outcome: 'completed' }))
    await flush()

    expect(scheduler.state().quarantined).toBe(false)
    expect(scheduler.state().failedSentences).toBe(1)
    expect(scheduler.state().spokenSentences).toBe(1)
    expect(spoken).toEqual(['Second line is heard.'])
    expect(failures).toEqual(['Synthesis failed'])
    expect(scheduler.state().spokenDurationMs).toBe(900)
  })

  it('records the measured duration of what was actually heard, not the text estimate', async () => {
    let nextId = 1
    const scheduler = new ResponseSpeechScheduler({
      mode: 'incremental',
      incrementalConsent: true,
      maxInFlight: 1,
      maxQueuedSentences: 4,
      maxBufferedDurationMs: 25_000,
      speakFragment: async (_text, onId) => {
        onId?.(nextId++)
        return { finished: true, durationMs: 40_000 }
      },
      cancelFragment: vi.fn(),
    })

    scheduler.push(ev(1, { type: 'response-start', responseId: 'r1' }))
    scheduler.push(ev(2, { type: 'text-delta', responseId: 'r1', text: 'First short line. Second short line.\n\n' }))
    await flush()
    // "One short line." is a 400ms estimate and 40s of real audio. A scheduler
    // that reports the estimate cannot tell the listener (or the caller) how
    // much was actually spoken.
    expect(scheduler.state().spokenSentences).toBe(1)
    expect(scheduler.state().spokenDurationMs).toBe(40_000)
  })
})
