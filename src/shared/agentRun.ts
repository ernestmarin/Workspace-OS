export interface AgentRunFailure {
  kind: 'output-limit' | 'provider-error'
  message: string
  /** Main confirms that this run captured a session that can be resumed. */
  canResume?: boolean
}

export const documentOutputGuidance = 'For long documents, work in small sections and save each section to the file before continuing. Keep tool calls and generated specifications small too. Verify the finished file, then give a brief chat summary with its path instead of repeating the document.'

/** What a paused run is told when the person resumes it (same session, same conversation). */
export const continuePausedWorkPrompt = [
  'You were paused by the person in the middle of this task; they have now resumed you.',
  'First inspect the existing files, case notes, and completed actions. Preserve completed work and any edits made while you were paused; repair any incomplete last write before proceeding.',
  'Continue from where you stopped. Do not repeat completed external actions, create duplicate files or case attachments, or restart the task from scratch.',
].join('\n')

/**
 * The resume prompt for a paused run. A provider session keeps only finished
 * turns, so whatever the run was writing when it was paused is not in it (seen
 * live: a resumed count restarted from one). The app kept that text, so it is
 * handed back: the agent continues from the actual last words.
 */
export function pausedResumePrompt(tail?: string | null): string {
  const last = (tail ?? '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim().slice(-800)
  if (!last) return continuePausedWorkPrompt
  return [
    continuePausedWorkPrompt,
    '',
    'Your previous turn was cut off by the pause, so the task is NOT finished. The conversation history does not contain what you wrote in that turn; this is exactly how far you got:',
    `«${last}»`,
    'Continue the task from the very next step after that text. Do not repeat it, and do not say the task is complete unless you have just finished it now.',
  ].join('\n')
}

export const continueUnfinishedWorkPrompt = [
  'Continue the unfinished work from this conversation after the response limit was reached.',
  'First inspect the existing files, case notes, and completed actions. Preserve completed work and user edits; repair any incomplete last write before proceeding.',
  'Finish only what remains. Do not repeat completed external actions, create duplicate files or case attachments, or restart the original task from scratch.',
  documentOutputGuidance,
].join('\n')

/** Voice-source metadata, not agent grants or proof of audible playback. */
export const ASSISTANT_RESPONSE_LIMITS = Object.freeze({ identity: 256, responses: 128, delta: 20_000, text: 100_000 })
export interface AssistantRunOwner {
  /** Existing WOS conversation/session, not a new provider history. */
  sessionId: string
  runId: string
  /** Unique per launch; the future main transport must mint it, never a notification. */
  epoch: string
}
export type AssistantResponseSource =
  | { provider: 'codex'; sessionId: string; turnId: string }
  | { provider: 'claude'; sessionId: string; turnId: null }
export type AssistantRunOutcome = 'completed' | 'failed' | 'cancelled'
export type AssistantResponseOutcome = AssistantRunOutcome | 'incomplete'
interface AssistantResponseBase {
  owner: AssistantRunOwner
  source: AssistantResponseSource
  /** Strictly increasing within this owner/epoch, not an audio sample offset. */
  sequence: number
}
export type AssistantResponseEvent = AssistantResponseBase & (
  | { type: 'response-start'; responseId: string }
  | { type: 'text-delta'; responseId: string; text: string }
  | { type: 'response-end'; responseId: string; outcome: AssistantResponseOutcome }
  | { type: 'run-end'; outcome: AssistantRunOutcome }
  /** Seal/discard this voice source; this does NOT terminate the actual agent run. */
  | { type: 'source-error'; reason: 'invalid-event' | 'response-limit' | 'text-limit' }
)

export function isAssistantIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,256}$/.test(value)
}
function responseRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return (proto === Object.prototype || proto === null) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}
export function isAssistantRunOwner(value: unknown): value is AssistantRunOwner {
  return responseRecord(value, ['sessionId', 'runId', 'epoch']) && isAssistantIdentity(value.sessionId) && isAssistantIdentity(value.runId) && isAssistantIdentity(value.epoch)
}
export function isAssistantResponseSource(value: unknown): value is AssistantResponseSource {
  return responseRecord(value, ['provider', 'sessionId', 'turnId']) && isAssistantIdentity(value.sessionId) &&
    (value.provider === 'codex' ? isAssistantIdentity(value.turnId) : value.provider === 'claude' && value.turnId === null)
}
/** Runtime boundary guard for future IPC/consumers; annotations alone are not validation. */
export function isAssistantResponseEvent(value: unknown): value is AssistantResponseEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const e = value as Record<string, unknown>
  if (!isAssistantRunOwner(e.owner) || !isAssistantResponseSource(e.source) || !Number.isSafeInteger(e.sequence) || (e.sequence as number) < 1) return false
  const base = ['type', 'owner', 'source', 'sequence']
  const runOutcome = (v: unknown): boolean => v === 'completed' || v === 'failed' || v === 'cancelled'
  switch (e.type) {
    case 'response-start': return responseRecord(e, [...base, 'responseId']) && isAssistantIdentity(e.responseId)
    case 'text-delta': return responseRecord(e, [...base, 'responseId', 'text']) && isAssistantIdentity(e.responseId) && typeof e.text === 'string' && e.text.length > 0 && e.text.length <= ASSISTANT_RESPONSE_LIMITS.delta
    case 'response-end': return responseRecord(e, [...base, 'responseId', 'outcome']) && isAssistantIdentity(e.responseId) && (runOutcome(e.outcome) || e.outcome === 'incomplete')
    case 'run-end': return responseRecord(e, [...base, 'outcome']) && runOutcome(e.outcome)
    case 'source-error': return responseRecord(e, [...base, 'reason']) && (e.reason === 'invalid-event' || e.reason === 'response-limit' || e.reason === 'text-limit')
    default: return false
  }
}
