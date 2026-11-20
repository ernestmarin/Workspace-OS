import { describe, expect, it } from 'vitest'
import { ClaudeAssistantText } from './assistantText'
const line = (x: unknown) => JSON.stringify(x)
const delta = (text: string, parent_tool_use_id: string | null = null) => line({ type: 'stream_event', parent_tool_use_id, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })

describe('Claude assistant text', () => {
  it('excludes warnings, tools, reasoning, errors, malformed data and subagents', () => {
    const parser = new ClaudeAssistantText()
    for (const input of ['warning', '{', line({ type: 'result', is_error: true, result: 'secret' }), line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: 'secret' } } }), line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'secret' } } }), delta('child', 'tool-1')]) expect(parser.consume(input)).toBeNull()
    expect(parser.consume(delta('Hello'))).toBe('Hello')
    expect(parser.consume(line({ type: 'result', is_error: false, result: 'Hello' }))).toBeNull()
  })
  it('uses final successful text when streaming deltas are absent, once', () => {
    const parser = new ClaudeAssistantText()
    const result = line({ type: 'result', is_error: false, result: 'Done' })
    expect(parser.consume(result)).toBe('Done')
    expect(parser.consume(result)).toBeNull()
  })
})
