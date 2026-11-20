import { describe, expect, it } from 'vitest'
import type { AssistantResponseEvent, AssistantRunOwner } from '../../shared/agentRun'
import { ClaudeAssistantResponses } from './claudeResponses'

const owner: AssistantRunOwner = {
  sessionId: 'wos-convo-1',
  runId: 'run-claude-1',
  epoch: 'epoch-uuid-1',
}
const validSid = '550e8400-e29b-41d4-a716-446655440000'

describe('ClaudeAssistantResponses adapter (VOX-A1c)', () => {
  it('streams multi-block assistant prose with response-start/text-delta/response-end/run-end and excludes thinking/tool/subagent blocks', () => {
    const events: AssistantResponseEvent[] = []
    const adapter = new ClaudeAssistantResponses(owner, (ev) => events.push(ev))

    adapter.consume(JSON.stringify({ type: 'system', subtype: 'init', session_id: validSid }))
    adapter.consume(JSON.stringify({
      type: 'stream_event',
      session_id: validSid,
      event: { type: 'message_start', message: { id: 'msg_01A' } },
    }))
    // Block 0: thinking (must be ignored)
    adapter.consume(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    }))
    adapter.consume(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'secret plan' } },
    }))
    adapter.consume(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_stop', index: 0 },
    }))
    // Block 1: text (must emit response-start, text-delta, response-end)
    adapter.consume(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    }))
    adapter.consume(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hola, ' } },
    }))
    // Subagent delta with parent_tool_use_id must be ignored completely
    adapter.consume(JSON.stringify({
      parent_tool_use_id: 'toolu_99',
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'SUBAGENT NOISE' } },
    }))
    adapter.consume(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'mundo.' } },
    }))
    adapter.consume(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_stop', index: 1 },
    }))
    adapter.consume(JSON.stringify({
      type: 'result',
      session_id: validSid,
      is_error: false,
      result: 'Hola, mundo.',
    }))
    adapter.finish(0, false, false)

    expect(events.map((e) => e.type)).toEqual([
      'response-start',
      'text-delta',
      'text-delta',
      'response-end',
      'run-end',
    ])
    expect(events[0]).toMatchObject({
      type: 'response-start',
      owner,
      source: { provider: 'claude', sessionId: validSid, turnId: null },
      responseId: 'msg_01A:b1',
      sequence: 1,
    })
    expect(events[1]).toMatchObject({ type: 'text-delta', responseId: 'msg_01A:b1', text: 'Hola, ', sequence: 2 })
    expect(events[2]).toMatchObject({ type: 'text-delta', responseId: 'msg_01A:b1', text: 'mundo.', sequence: 3 })
    expect(events[3]).toMatchObject({ type: 'response-end', responseId: 'msg_01A:b1', outcome: 'completed', sequence: 4 })
    expect(events[4]).toMatchObject({ type: 'run-end', outcome: 'completed', sequence: 5 })
  })

  it('supports final-only result compatibility without inventing fake message ids and never duplicates streamed text', () => {
    const events: AssistantResponseEvent[] = []
    const adapter = new ClaudeAssistantResponses(owner, (ev) => events.push(ev))

    adapter.consume(JSON.stringify({
      type: 'result',
      session_id: validSid,
      is_error: false,
      result: 'Final answer only.',
    }))
    adapter.finish(0, false, false)

    expect(events.map((e) => e.type)).toEqual(['response-start', 'text-delta', 'response-end', 'run-end'])
    expect(events[1]).toMatchObject({ type: 'text-delta', text: 'Final answer only.' })
    expect(events[3]).toMatchObject({ type: 'run-end', outcome: 'completed' })
  })

  it('emits nothing when Claude never establishes a valid session_id (never invents missing identities)', () => {
    const events: AssistantResponseEvent[] = []
    const adapter = new ClaudeAssistantResponses(owner, (ev) => events.push(ev))
    adapter.consume(JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'msg_01A' } },
    }))
    adapter.consume(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    }))
    adapter.consume(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Unverified' } },
    }))
    adapter.finish(1, false, true)
    expect(events).toEqual([])
  })

  it('distinguishes cancelled vs failed run outcomes and marks unclosed blocks accordingly', () => {
    const events: AssistantResponseEvent[] = []
    const adapter = new ClaudeAssistantResponses(owner, (ev) => events.push(ev))
    adapter.consume(JSON.stringify({ type: 'system', subtype: 'init', session_id: validSid }))
    adapter.consume(JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'msg_cancel' } },
    }))
    adapter.consume(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    }))
    adapter.consume(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Cut off' } },
    }))
    adapter.finish(143, true, false)

    expect(events.at(-2)).toMatchObject({ type: 'response-end', responseId: 'msg_cancel:b0', outcome: 'cancelled' })
    expect(events.at(-1)).toMatchObject({ type: 'run-end', outcome: 'cancelled' })
  })
})
