/** Bounded response provenance. No synthesis, playback, tools, networking or agent cancellation. */
import {
  ASSISTANT_RESPONSE_LIMITS as limits,
  isAssistantIdentity, isAssistantRunOwner, isAssistantResponseSource,
  type AssistantRunOwner, type AssistantResponseSource, type AssistantResponseEvent, type AssistantRunOutcome,
} from '../../shared/agentRun'

type Payload =
  | { type: 'response-start'; responseId: string }
  | { type: 'text-delta'; responseId: string; text: string }
  | { type: 'response-end'; responseId: string; outcome: AssistantRunOutcome | 'incomplete' }
  | { type: 'run-end'; outcome: AssistantRunOutcome }
  | { type: 'source-error'; reason: 'invalid-event' | 'response-limit' | 'text-limit' }

/**
 * One instance per response-established provider turn and WOS launch epoch.
 * Item completion is generation-only; only endRun reports the provider outcome.
 * Neither event proves queued audio drained or that a person heard any text.
 */
export class AssistantResponses {
  private readonly owner: AssistantRunOwner
  private readonly source: AssistantResponseSource
  /** false = live; true = completed tombstone, retained until this bounded source ends. */
  private readonly responses = new Map<string, boolean>()
  private sealed = false
  private observerFailed = false
  private sequence = 0
  private textUnits = 0

  constructor(owner: AssistantRunOwner, source: AssistantResponseSource, private readonly emit: (event: AssistantResponseEvent) => void) {
    if (!isAssistantRunOwner(owner) || !isAssistantResponseSource(source)) throw new Error('Invalid assistant response identity')
    this.owner = { ...owner }
    this.source = { ...source }
  }

  text(responseId: unknown, text: unknown): void {
    if (this.sealed) return
    if (!isAssistantIdentity(responseId)) { this.fail('invalid-event'); return }
    if (this.responses.get(responseId) === true) return
    if (typeof text !== 'string') { this.fail('invalid-event'); return }
    if (!text) return
    if (text.length > limits.delta || this.textUnits + text.length > limits.text) { this.fail('text-limit'); return }
    if (!this.ensure(responseId) || this.sealed || this.responses.get(responseId) === true) return
    this.textUnits += text.length
    this.publish({ type: 'text-delta', responseId, text })
  }

  complete(responseId: unknown): void {
    if (this.sealed) return
    if (!isAssistantIdentity(responseId)) { this.fail('invalid-event'); return }
    if (!this.ensure(responseId) || this.sealed || this.responses.get(responseId) === true) return
    this.responses.set(responseId, true)
    this.publish({ type: 'response-end', responseId, outcome: 'completed' })
  }

  endRun(outcome: AssistantRunOutcome): void {
    if (this.sealed) return
    if (outcome !== 'completed' && outcome !== 'failed' && outcome !== 'cancelled') { this.fail('invalid-event'); return }
    // Seal before notifying observers: re-entrant/late text cannot restart it.
    this.sealed = true
    for (const [responseId, completed] of this.responses) {
      if (!completed) this.publish({ type: 'response-end', responseId, outcome: outcome === 'completed' ? 'incomplete' : outcome })
    }
    this.responses.clear()
    this.publish({ type: 'run-end', outcome })
  }

  private ensure(responseId: string): boolean {
    if (this.responses.has(responseId)) return true
    if (this.responses.size >= limits.responses) { this.fail('response-limit'); return false }
    this.responses.set(responseId, false)
    this.publish({ type: 'response-start', responseId })
    return !this.sealed
  }

  private fail(reason: 'invalid-event' | 'response-limit' | 'text-limit'): void {
    this.sealed = true
    this.responses.clear()
    this.publish({ type: 'source-error', reason })
  }

  private publish(payload: Payload): void {
    if (this.observerFailed) return
    try {
      // An observer receives a snapshot, never our live owner/source objects.
      this.emit({ ...payload, owner: { ...this.owner }, source: { ...this.source }, sequence: ++this.sequence })
    } catch {
      // A broken voice observer must never abort the actual agent/tool path.
      this.observerFailed = true
      this.sealed = true
      this.responses.clear()
    }
  }
}
