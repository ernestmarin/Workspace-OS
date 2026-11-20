/** Extract only top-level Claude assistant text; never terminal diagnostics or tool payloads. */
export class ClaudeAssistantText {
  private sawDelta = false
  private ended = false

  consume(line: string): string | null {
    if (this.ended) return null
    let value: unknown
    try { value = JSON.parse(line) } catch { return null }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const obj = value as Record<string, any>
    // Subagent content is not the selected agent's reply.
    if (obj.parent_tool_use_id != null) return null
    if (obj.type === 'stream_event' && obj.event?.type === 'content_block_delta' && obj.event.delta?.type === 'text_delta' && typeof obj.event.delta.text === 'string') {
      if (!obj.event.delta.text) return null
      this.sawDelta = true
      return obj.event.delta.text
    }
    // Some CLI versions only return a successful final result. Do not duplicate streamed text.
    if (obj.type === 'result') {
      this.ended = true
      if (obj.is_error === false && !this.sawDelta && typeof obj.result === 'string' && obj.result) return obj.result
    }
    return null
  }
}
