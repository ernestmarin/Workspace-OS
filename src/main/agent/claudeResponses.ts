/**
 * Claude stream-json → AssistantResponses adapter (VOX-A1c).
 *
 * Pins the Claude CLI `--output-format stream-json --include-partial-messages --verbose`
 * event schema without inventing missing session or message identities:
 *  - Subagent events (`parent_tool_use_id != null`) are never spoken.
 *  - `thinking`, `tool_use`, `server_tool_use`, and non-text content blocks are ignored.
 *  - `AssistantResponses` is instantiated ONLY once a valid UUID `session_id` is
 *    established by the Claude stream (`system` init, `stream_event`, or `result`).
 *  - Final-only `result` events (`!sawStreamedText && is_error === false`) emit a
 *    single deterministic `${sessionId}:result` response without duplicating streamed blocks.
 */
import { isValidClaudeSessionId } from '../agent-permissions'
import {
  isAssistantIdentity,
  isAssistantRunOwner,
  type AssistantResponseEvent,
  type AssistantRunOutcome,
  type AssistantRunOwner,
} from '../../shared/agentRun'
import { AssistantResponses } from './assistantResponses'

type QueuedOp =
  | { kind: 'text'; responseId: string; text: string }
  | { kind: 'complete'; responseId: string }

const MAX_EARLY_OPS = 256
const MAX_EARLY_UNITS = 100_000

export class ClaudeAssistantResponses {
  private readonly owner: AssistantRunOwner | null
  private responses: AssistantResponses | null = null
  private sessionId: string | null = null
  private currentMessageId: string | null = null
  /** Block index → responseId for active top-level text blocks in currentMessageId. */
  private readonly activeTextBlocks = new Map<number, string>()
  private sawStreamedText = false
  private sawResultError = false
  private ended = false
  private earlyOverflow = false
  private earlyUnits = 0
  private readonly earlyOps: QueuedOp[] = []

  constructor(
    owner: AssistantRunOwner | undefined,
    private readonly emit: (event: AssistantResponseEvent) => void,
  ) {
    this.owner = isAssistantRunOwner(owner) ? { ...owner } : null
  }

  consume(line: string): void {
    if (!this.owner || this.ended) return
    const trimmed = line.trim()
    if (!trimmed || trimmed[0] !== '{') return
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const obj = parsed as Record<string, unknown>

    // Subagent content belongs to an internal tool invocation, never the user-facing reply.
    if (obj.parent_tool_use_id != null) return

    if (!this.sessionId && isValidClaudeSessionId(obj.session_id)) {
      this.bindSession(obj.session_id)
    }

    if (obj.type === 'stream_event' && obj.event && typeof obj.event === 'object') {
      const ev = obj.event as Record<string, unknown>
      this.consumeStreamEvent(ev)
      return
    }

    if (obj.type === 'result') {
      if (obj.is_error === true) {
        this.sawResultError = true
        return
      }
      if (
        obj.is_error === false &&
        !this.sawStreamedText &&
        typeof obj.result === 'string' &&
        obj.result.length > 0 &&
        this.sessionId
      ) {
        const finalId = `${this.sessionId}:result`
        this.recordText(finalId, obj.result)
        this.recordComplete(finalId)
      }
    }
  }

  finish(exitCode: number | null, cancelled: boolean, hasFailure: boolean): void {
    if (!this.owner || this.ended) return
    this.ended = true
    this.earlyOps.length = 0
    this.activeTextBlocks.clear()
    if (!this.responses) return
    const outcome: AssistantRunOutcome = cancelled
      ? 'cancelled'
      : this.sawResultError || hasFailure || exitCode !== 0
        ? 'failed'
        : 'completed'
    this.responses.endRun(outcome)
  }

  private bindSession(sid: string): void {
    this.sessionId = sid
    if (!this.owner || this.earlyOverflow) return
    try {
      this.responses = new AssistantResponses(
        this.owner,
        { provider: 'claude', sessionId: sid, turnId: null },
        this.emit,
      )
      for (const op of this.earlyOps.splice(0)) {
        if (op.kind === 'text') this.responses.text(op.responseId, op.text)
        else this.responses.complete(op.responseId)
      }
    } catch {
      this.responses = null
      this.earlyOps.length = 0
    }
  }

  private consumeStreamEvent(ev: Record<string, unknown>): void {
    const evType = ev.type
    if (evType === 'message_start') {
      this.activeTextBlocks.clear()
      const msg = ev.message as Record<string, unknown> | undefined
      this.currentMessageId = msg && isAssistantIdentity(msg.id) ? msg.id : null
      return
    }

    if (evType === 'content_block_start') {
      const idx = ev.index
      const block = ev.content_block as Record<string, unknown> | undefined
      if (!Number.isSafeInteger(idx) || (idx as number) < 0) return
      if (block?.type === 'text' && this.currentMessageId) {
        this.activeTextBlocks.set(idx as number, `${this.currentMessageId}:b${idx as number}`)
      } else {
        this.activeTextBlocks.delete(idx as number)
      }
      return
    }

    if (evType === 'content_block_delta') {
      const idx = ev.index
      if (!Number.isSafeInteger(idx)) return
      const responseId = this.activeTextBlocks.get(idx as number)
      if (!responseId) return
      const delta = ev.delta as Record<string, unknown> | undefined
      if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
        this.sawStreamedText = true
        this.recordText(responseId, delta.text)
      }
      return
    }

    if (evType === 'content_block_stop') {
      const idx = ev.index
      if (!Number.isSafeInteger(idx)) return
      const responseId = this.activeTextBlocks.get(idx as number)
      if (!responseId) return
      this.activeTextBlocks.delete(idx as number)
      this.recordComplete(responseId)
      return
    }

    if (evType === 'message_stop') {
      for (const responseId of this.activeTextBlocks.values()) {
        this.recordComplete(responseId)
      }
      this.activeTextBlocks.clear()
      this.currentMessageId = null
    }
  }

  private recordText(responseId: string, text: string): void {
    if (this.responses) {
      this.responses.text(responseId, text)
      return
    }
    if (this.earlyOverflow) return
    if (this.earlyOps.length >= MAX_EARLY_OPS || this.earlyUnits + text.length > MAX_EARLY_UNITS) {
      this.earlyOverflow = true
      this.earlyOps.length = 0
      return
    }
    this.earlyUnits += text.length
    this.earlyOps.push({ kind: 'text', responseId, text })
  }

  private recordComplete(responseId: string): void {
    if (this.responses) {
      this.responses.complete(responseId)
      return
    }
    if (this.earlyOverflow || this.earlyOps.length >= MAX_EARLY_OPS) {
      this.earlyOverflow = true
      this.earlyOps.length = 0
      return
    }
    this.earlyOps.push({ kind: 'complete', responseId })
  }
}
