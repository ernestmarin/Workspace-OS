/**
 * Renderer response provenance consumer (VOX-A1d.2 & VOX-A1d.3).
 *
 * Enforces main-acknowledged `AssistantRunOwner` (`sessionId`, `runId`, `epoch`),
 * bounded early-event buffering while `agent.run(...)` is resolving, strict
 * monotonic sequence checks (`1, 2, 3, ...`), and voice-only quarantine on
 * `source-error` / incomplete / failed outcomes (never cancelling the agent).
 */
import {
  isAssistantResponseEvent,
  isAssistantRunOwner,
  type AssistantResponseEvent,
  type AssistantRunOwner,
} from '../../../../shared/agentRun'

const MAX_CLAIMED_RUNS = 8
const MAX_EARLY_EVENTS = 64
const MAX_EARLY_UNITS = 64_000

interface ClaimedRun {
  expectedSessionId: string
  acknowledgedOwner: AssistantRunOwner | null
  lastSequence: number
  earlyEvents: AssistantResponseEvent[]
  earlyUnits: number
  activeResponses: Set<string>
  completedResponses: Set<string>
  quarantined: boolean
}

export interface ResponseConsumerCallbacks {
  onText(runId: string, text: string): void
  onFinish(runId: string, success: boolean): void
  onCancel(runId: string): void
  onEvent?(event: AssistantResponseEvent): void
}

export class ResponseStreamConsumer {
  private readonly runs = new Map<string, ClaimedRun>()

  constructor(private readonly callbacks: ResponseConsumerCallbacks) {}

  claim(runId: string, expectedSessionId: string): void {
    if (!runId || !expectedSessionId || this.runs.has(runId)) return
    if (this.runs.size >= MAX_CLAIMED_RUNS) {
      const oldest = this.runs.keys().next().value
      if (oldest) this.discard(oldest)
    }
    this.runs.set(runId, {
      expectedSessionId,
      acknowledgedOwner: null,
      lastSequence: 0,
      earlyEvents: [],
      earlyUnits: 0,
      activeResponses: new Set(),
      completedResponses: new Set(),
      quarantined: false,
    })
  }

  hasAcknowledged(runId: string): boolean {
    return Boolean(this.runs.get(runId)?.acknowledgedOwner)
  }

  hasClaim(runId: string): boolean {
    return this.runs.has(runId)
  }

  acknowledge(runId: string, owner: unknown): boolean {
    const state = this.runs.get(runId)
    if (!state || state.quarantined) return false
    if (
      !isAssistantRunOwner(owner) ||
      owner.runId !== runId ||
      owner.sessionId !== state.expectedSessionId
    ) {
      this.quarantine(runId)
      return false
    }
    state.acknowledgedOwner = { ...owner }
    const buffered = state.earlyEvents.splice(0)
    state.earlyUnits = 0
    for (const ev of buffered) {
      this.applyVerified(runId, state, ev)
      if (!this.runs.has(runId) || state.quarantined) break
    }
    return true
  }

  push(rawEvent: unknown): void {
    if (!isAssistantResponseEvent(rawEvent)) return
    const runId = rawEvent.owner.runId
    const state = this.runs.get(runId)
    // Unsolicited events for runs this session never claimed are ignored completely.
    if (!state || state.quarantined) return

    if (!state.acknowledgedOwner) {
      const deltaUnits = rawEvent.type === 'text-delta' ? rawEvent.text.length : 0
      if (
        rawEvent.owner.sessionId !== state.expectedSessionId ||
        state.earlyEvents.length >= MAX_EARLY_EVENTS ||
        state.earlyUnits + deltaUnits > MAX_EARLY_UNITS
      ) {
        this.quarantine(runId)
        return
      }
      state.earlyUnits += deltaUnits
      state.earlyEvents.push(rawEvent)
      return
    }

    this.applyVerified(runId, state, rawEvent)
  }

  discard(runId: string): void {
    if (!this.runs.delete(runId)) return
    this.callbacks.onCancel(runId)
  }

  /** Detach a claim without cancelling legacy reply buffers when main omits responseOwner. */
  releaseClaim(runId: string): void {
    this.runs.delete(runId)
  }

  clear(): void {
    for (const runId of [...this.runs.keys()]) {
      this.discard(runId)
    }
  }

  private applyVerified(runId: string, state: ClaimedRun, event: AssistantResponseEvent): void {
    const expected = state.acknowledgedOwner
    if (
      !expected ||
      event.owner.runId !== expected.runId ||
      event.owner.sessionId !== expected.sessionId ||
      event.owner.epoch !== expected.epoch ||
      event.sequence !== state.lastSequence + 1
    ) {
      this.quarantine(runId)
      return
    }
    state.lastSequence = event.sequence
    this.callbacks.onEvent?.(event)

    switch (event.type) {
      case 'response-start': {
        if (state.activeResponses.has(event.responseId) || state.completedResponses.has(event.responseId)) {
          this.quarantine(runId)
          return
        }
        state.activeResponses.add(event.responseId)
        return
      }
      case 'text-delta': {
        if (!state.activeResponses.has(event.responseId)) {
          this.quarantine(runId)
          return
        }
        this.callbacks.onText(runId, event.text)
        return
      }
      case 'response-end': {
        if (!state.activeResponses.delete(event.responseId)) {
          this.quarantine(runId)
          return
        }
        if (event.outcome !== 'completed') {
          this.quarantine(runId)
          return
        }
        state.completedResponses.add(event.responseId)
        return
      }
      case 'run-end': {
        const cleanSuccess = event.outcome === 'completed' && state.activeResponses.size === 0
        this.runs.delete(runId)
        if (cleanSuccess) this.callbacks.onFinish(runId, true)
        else this.callbacks.onCancel(runId)
        return
      }
      case 'source-error': {
        this.quarantine(runId)
        return
      }
    }
  }

  private quarantine(runId: string): void {
    const state = this.runs.get(runId)
    if (!state) return
    state.quarantined = true
    state.earlyEvents.length = 0
    this.runs.delete(runId)
    this.callbacks.onCancel(runId)
  }
}
