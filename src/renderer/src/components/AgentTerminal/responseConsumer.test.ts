import { describe, expect, it, vi } from 'vitest'
import type { AssistantResponseEvent, AssistantRunOwner } from '../../../../shared/agentRun'
import { ResponseStreamConsumer } from './responseConsumer'

const owner: AssistantRunOwner = {
  sessionId: 'convo-1',
  runId: 'run-1',
  epoch: 'epoch-main-1',
}
const source = { provider: 'claude' as const, sessionId: '550e8400-e29b-41d4-a716-446655440000', turnId: null }

function makeEvent(seq: number, payload: Omit<AssistantResponseEvent, 'owner' | 'source' | 'sequence'> & Record<string, unknown>, customOwner = owner): AssistantResponseEvent {
  return { ...payload, owner: customOwner, source, sequence: seq } as AssistantResponseEvent
}

describe('ResponseStreamConsumer (VOX-A1d.2 & VOX-A1d.3)', () => {
  it('buffers early events for a claimed run until dispatch acknowledges the main-minted owner, then delivers in strict sequence', () => {
    const texts: string[] = []
    const finished: { runId: string; ok: boolean }[] = []
    const consumer = new ResponseStreamConsumer({
      onText: (runId, text) => texts.push(`${runId}:${text}`),
      onFinish: (runId, ok) => finished.push({ runId, ok }),
      onCancel: vi.fn(),
    })

    consumer.claim('run-1', 'convo-1')
    // Early events arrive over IPC BEFORE agent.run() promise resolves with responseOwner!
    consumer.push(makeEvent(1, { type: 'response-start', responseId: 'msg_1:b0' }))
    consumer.push(makeEvent(2, { type: 'text-delta', responseId: 'msg_1:b0', text: 'Buffered ' }))
    expect(texts).toEqual([])

    consumer.acknowledge('run-1', owner)
    expect(texts).toEqual(['run-1:Buffered '])

    consumer.push(makeEvent(3, { type: 'text-delta', responseId: 'msg_1:b0', text: 'and live.' }))
    consumer.push(makeEvent(4, { type: 'response-end', responseId: 'msg_1:b0', outcome: 'completed' }))
    consumer.push(makeEvent(5, { type: 'run-end', outcome: 'completed' }))

    expect(texts).toEqual(['run-1:Buffered ', 'run-1:and live.'])
    expect(finished).toEqual([{ runId: 'run-1', ok: true }])
  })

  it('rejects unsolicited runs, mismatched launch epochs, and non-monotonic sequence gaps by cancelling only owned speech', () => {
    const onCancel = vi.fn()
    const onText = vi.fn()
    const consumer = new ResponseStreamConsumer({
      onText,
      onFinish: vi.fn(),
      onCancel,
    })

    // Unsolicited event for unclaimed run is ignored completely
    consumer.push(makeEvent(1, { type: 'response-start', responseId: 'r1' }, { sessionId: 'convo-1', runId: 'unclaimed', epoch: 'e1' }))
    expect(onText).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()

    // Claimed run receives wrong epoch in early buffer -> discarded on acknowledge
    consumer.claim('run-1', 'convo-1')
    consumer.push(makeEvent(1, { type: 'response-start', responseId: 'r1' }, { sessionId: 'convo-1', runId: 'run-1', epoch: 'forged-epoch' }))
    consumer.acknowledge('run-1', owner)
    expect(onCancel).toHaveBeenCalledWith('run-1')

    // Valid run followed by sequence gap -> cancels owned speech immediately
    onCancel.mockClear()
    const owner2: AssistantRunOwner = { sessionId: 'convo-1', runId: 'run-2', epoch: 'epoch-2' }
    consumer.claim('run-2', 'convo-1')
    consumer.acknowledge('run-2', owner2)
    consumer.push(makeEvent(1, { type: 'response-start', responseId: 'r2' }, owner2))
    consumer.push(makeEvent(3, { type: 'text-delta', responseId: 'r2', text: 'skipped seq 2' }, owner2))
    expect(onText).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledWith('run-2')
  })

  it('cancels owned speech on source-error or incomplete response outcome without waiting', () => {
    const onCancel = vi.fn()
    const consumer = new ResponseStreamConsumer({
      onText: vi.fn(),
      onFinish: vi.fn(),
      onCancel,
    })

    consumer.claim('run-1', 'convo-1')
    consumer.acknowledge('run-1', owner)
    consumer.push(makeEvent(1, { type: 'response-start', responseId: 'r1' }))
    consumer.push(makeEvent(2, { type: 'source-error', reason: 'text-limit' }))
    expect(onCancel).toHaveBeenCalledExactlyOnceWith('run-1')
  })
})
