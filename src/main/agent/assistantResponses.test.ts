import { describe, expect, it, vi } from 'vitest'
import { AssistantResponses } from './assistantResponses'
import { ASSISTANT_RESPONSE_LIMITS as limits, isAssistantResponseEvent, type AssistantResponseEvent, type AssistantRunOwner } from '../../shared/agentRun'

const owner = (): AssistantRunOwner => ({ sessionId: 'wos-conversation', runId: 'run-1', epoch: 'epoch-1' })
const source = () => ({ provider: 'codex' as const, sessionId: 'rpc-thread', turnId: 'rpc-turn' })
const harness = () => {
  const emit = vi.fn<(event: AssistantResponseEvent) => void>()
  const stream = new AssistantResponses(owner(), source(), emit)
  return { stream, emit, events: () => emit.mock.calls.map(([event]) => event) }
}

describe('assistant response lifecycle (no audio or agent execution)', () => {
  it('preserves owner, source, response boundaries and monotonic event order', () => {
    const h = harness()
    h.stream.text('a', 'Same.'); h.stream.complete('a')
    h.stream.text('b', 'Same.'); h.stream.text('b', 'Same.'); h.stream.complete('b')
    h.stream.endRun('completed')
    expect(h.events().map((event) => event.type)).toEqual(['response-start', 'text-delta', 'response-end', 'response-start', 'text-delta', 'text-delta', 'response-end', 'run-end'])
    expect(h.events().map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(h.events().every((event) => isAssistantResponseEvent(event) && JSON.stringify(event.owner) === JSON.stringify(owner()) && JSON.stringify(event.source) === JSON.stringify(source()))).toBe(true)
    expect(h.events().filter((event) => event.type === 'text-delta').map((event) => event.responseId)).toEqual(['a', 'b', 'b'])
  })
  it('does not confuse item completion, run success or future playback drain', () => {
    const h = harness()
    h.stream.text('a', 'Generated.'); h.stream.complete('a')
    expect(h.events().at(-1)).toMatchObject({ type: 'response-end', outcome: 'completed' })
    expect(h.events().some((event) => event.type === 'run-end')).toBe(false)
    h.stream.endRun('failed')
    expect(h.events().at(-1)).toMatchObject({ type: 'run-end', outcome: 'failed' })
    expect(h.events().some((event) => 'audio' in event)).toBe(false)
  })
  it('keeps completed-response tombstones and seals run completion against replay', () => {
    const h = harness()
    h.stream.text('a', 'Once.'); h.stream.complete('a')
    h.stream.complete('a'); h.stream.text('a', 'replay')
    h.stream.endRun('completed'); h.stream.text('b', 'late'); h.stream.endRun('failed')
    expect(h.events()).toHaveLength(4)
    expect(h.events().at(-1)).toMatchObject({ type: 'run-end', outcome: 'completed' })
  })
  it('can close an empty item without inventing text and ignores empty deltas', () => {
    const h = harness()
    h.stream.text('a', ''); expect(h.events()).toEqual([])
    h.stream.complete('a')
    expect(h.events().map((event) => event.type)).toEqual(['response-start', 'response-end'])
  })
  it('marks an unclosed response incomplete even if the provider turn succeeds', () => {
    const h = harness()
    h.stream.text('a', 'Unclosed.'); h.stream.endRun('completed')
    expect(h.events().at(-2)).toMatchObject({ type: 'response-end', responseId: 'a', outcome: 'incomplete' })
    expect(h.events().at(-1)).toMatchObject({ type: 'run-end', outcome: 'completed' })
  })
  it.each(['failed', 'cancelled'] as const)('closes live items on %s without changing earlier generation outcomes', (outcome) => {
    const h = harness()
    h.stream.complete('done'); h.stream.text('live', 'Partial.'); h.stream.endRun(outcome)
    expect(h.events().filter((event) => event.type === 'response-end').map((event) => [event.responseId, event.outcome])).toEqual([['done', 'completed'], ['live', outcome]])
    expect(h.events().at(-1)).toMatchObject({ type: 'run-end', outcome })
  })
  it('bounds response history including completed tombstones and fails closed without cancelling an agent', () => {
    const h = harness()
    for (let i = 0; i < limits.responses; i++) h.stream.complete(`item-${i}`)
    h.stream.text('overflow', 'not emitted')
    h.stream.text('later', 'not emitted'); h.stream.endRun('completed')
    expect(h.events().at(-1)).toMatchObject({ type: 'source-error', reason: 'response-limit' })
    expect(h.events().filter((event) => event.type === 'response-start')).toHaveLength(limits.responses)
    expect(h.events().filter((event) => event.type === 'source-error')).toHaveLength(1)
  })
  it('bounds each delta and cumulative raw text without truncating an offending chunk', () => {
    const h = harness()
    for (let i = 0; i < limits.text / limits.delta; i++) h.stream.text('a', 'x'.repeat(limits.delta))
    h.stream.text('a', 'overflow')
    expect(h.events().at(-1)).toMatchObject({ type: 'source-error', reason: 'text-limit' })
    expect(h.events().filter((event) => event.type === 'text-delta')).toHaveLength(limits.text / limits.delta)
    const oversized = harness()
    oversized.stream.text('a', 'x'.repeat(limits.delta + 1))
    expect(oversized.events()).toHaveLength(1)
    expect(oversized.events()[0]).toMatchObject({ type: 'source-error', reason: 'text-limit' })
  })
  it('rejects malformed identities and non-text rather than inventing a response', () => {
    for (const id of ['', '../wrong', 'x'.repeat(limits.identity + 1), null, {}]) {
      const h = harness(); h.stream.text(id, 'private')
      expect(h.events()).toHaveLength(1)
      expect(h.events()[0]).toMatchObject({ type: 'source-error', reason: 'invalid-event' })
    }
    const h = harness(); h.stream.text('a', { text: 'not text' })
    expect(h.events()[0]).toMatchObject({ type: 'source-error', reason: 'invalid-event' })
  })
  it('snapshots identities and does not expose internal mutable state to an observer', () => {
    const o = owner(), s = source(), events: AssistantResponseEvent[] = []
    const stream = new AssistantResponses(o, s, (event) => { events.push(structuredClone(event)); event.owner.epoch = 'observer-mutation'; event.source.sessionId = 'observer-mutation' })
    o.epoch = 'caller-mutation'; s.sessionId = 'caller-mutation'
    stream.text('a', 'A.'); stream.complete('a')
    expect(events.every((event) => event.owner.epoch === 'epoch-1' && event.source.sessionId === 'rpc-thread')).toBe(true)
  })
  it('does not leak epochs between simultaneous streams or throw from a broken observer', () => {
    const a = harness(), events: AssistantResponseEvent[] = []
    const b = new AssistantResponses({ ...owner(), epoch: 'epoch-2' }, source(), (event) => events.push(event))
    a.stream.text('same', 'A.'); a.stream.endRun('cancelled')
    b.text('same', 'B.'); b.endRun('completed')
    expect(events.every((event) => event.owner.epoch === 'epoch-2')).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'run-end', outcome: 'completed' })
    const broken = new AssistantResponses(owner(), source(), () => { throw new Error('observer unavailable') })
    expect(() => { broken.text('a', 'A.'); broken.endRun('failed') }).not.toThrow()
  })
  it('runtime-validates the discriminated contract instead of trusting TypeScript annotations', () => {
    const h = harness(); h.stream.text('a', 'Good.'); h.stream.endRun('completed')
    for (const event of h.events()) expect(isAssistantResponseEvent(structuredClone(event))).toBe(true)
    const good = h.events()[1]
    for (const bad of [null, [], {}, { ...good, type: 'tool' }, { ...good, sequence: 0 }, { ...good, sequence: 1.5 }, { ...good, text: {} }, { ...good, text: '' }, { ...good, text: 'x'.repeat(limits.delta + 1) }, { ...good, owner: { ...owner(), epoch: 1 } }, { ...good, source: { ...source(), turnId: null } }, { ...good, execute: 'shell' }, { ...good, responseId: '../invalid' }]) expect(isAssistantResponseEvent(bad)).toBe(false)
    expect(() => new AssistantResponses({ ...owner(), sessionId: '' }, source(), vi.fn())).toThrow(/identity/i)
  })
})
