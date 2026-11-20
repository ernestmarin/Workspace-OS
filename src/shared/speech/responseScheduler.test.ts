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
