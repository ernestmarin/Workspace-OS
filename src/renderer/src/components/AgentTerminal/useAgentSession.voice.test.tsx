// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReplySpeechResult, ReplySpeechSession } from '../../../../shared/speech/replies'

const mock = vi.hoisted(() => ({
  store: { get: vi.fn(() => ({ conversationId: 'existing-conversation', transcript: '', mode: 'safe' })), appendTranscript: vi.fn(), update: vi.fn() },
  review: { openRun: vi.fn(), patchRun: vi.fn() },
  activity: { clear: vi.fn(), record: vi.fn() },
}))
vi.mock('../../hooks/useSettings', () => ({ useSettings: () => ({ agentModel: 'claude:sonnet' }) }))
vi.mock('./sessionStore', () => ({ sessionStore: mock.store, newConversationId: () => 'new-conversation' }))
vi.mock('../Review/reviewStore', () => ({ reviewStore: mock.review }))
vi.mock('../Review/activityStore', () => ({ activityStore: mock.activity }))
import { useAgentSession, type AgentSession } from './useAgentSession'

let root: Root, element: HTMLDivElement, current: AgentSession, speech: any, agent: any
let callbacks: Record<string, (...args: any[]) => void>
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const lease: ReplySpeechSession = { id: 'lease', engine: 'kokoro', voice: 'af_heart', remote: false }
const tick = async (fn: () => void) => act(async () => { fn(); await flush() })
function Probe() {
  current = useAgentSession('tab-1', '/workspace/note.md', ['/workspace/context.md'], () => {})
  return null
}
beforeEach(async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks(); localStorage.clear(); callbacks = {}
  agent = { run: vi.fn(async () => ({ provider: 'claude' })), cancel: vi.fn() }
  for (const name of ['onOutput', 'onAssistantText', 'onDone', 'onActivity', 'onArtifact', 'onArtifacts', 'onRunMeta']) {
    agent[name] = vi.fn((cb: (...args: any[]) => void) => { callbacks[name] = cb; return vi.fn() })
  }
  speech = {
    openReplySession: vi.fn(async () => lease), reserveReply: vi.fn(async (_session: string, run: string) => ({ id: run })),
    finishReply: vi.fn(async (_session: string, _reply: string, text: string | null): Promise<ReplySpeechResult> => text === null ? { finished: false, error: 'Cancelled' } : { finished: true }),
    closeReplySession: vi.fn(async () => {}), speak: vi.fn(async () => ({ readingId: 99 })), stop: vi.fn(),
  }
  Object.defineProperty(window, 'workspace', { configurable: true, value: { agent, speech, skills: { list: vi.fn(async () => []) } } })
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  await tick(() => root.render(<Probe />))
})
afterEach(async () => { await tick(() => root.unmount()); element.remove(); vi.restoreAllMocks() })
const start = async () => {
  await tick(() => current.setSpeakReplies(true))
  await tick(() => current.submit('Keep the existing conversation'))
  return agent.run.mock.calls[0][0] as string
}

describe('existing agent-session reply speech integration', () => {
  it('preserves normal submission context/grants mode and reads only after owned success without global Speak', async () => {
    const run = await start()
    expect(agent.run).toHaveBeenCalledWith(run, 'Keep the existing conversation', ['/workspace/context.md'], '/workspace/note.md', 'safe', null, 'existing-conversation', null)
    await tick(() => {
      callbacks.onAssistantText('foreign-run', 'private')
      callbacks.onAssistantText(run, 'Hello **world**.')
    })
    expect(speech.finishReply).not.toHaveBeenCalled()
    await tick(() => callbacks.onDone(run, 0, 'checkpoint'))
    expect(speech.finishReply).toHaveBeenCalledExactlyOnceWith('lease', run, 'Hello world.')
    expect(speech.speak).not.toHaveBeenCalled()
    expect(mock.review.patchRun).toHaveBeenCalledWith(run, expect.objectContaining({ status: 'pending', checkpointId: 'checkpoint' }))
  })
  it('does not read a run that started before consent or one that failed', async () => {
    await tick(() => current.submit('Before consent'))
    const before = agent.run.mock.calls[0][0]
    await tick(() => current.setSpeakReplies(true))
    await tick(() => { callbacks.onAssistantText(before, 'private'); callbacks.onDone(before, 0, null) })
    expect(speech.finishReply).not.toHaveBeenCalled()
    await tick(() => current.submit('Failure'))
    const run = agent.run.mock.calls[1][0]
    await tick(() => { callbacks.onAssistantText(run, 'Partial.'); callbacks.onDone(run, 1, null) })
    expect(speech.finishReply).toHaveBeenCalledExactlyOnceWith('lease', run, null)
  })
  it('disabling cancels draining speech without stopping the agent or unrelated readings', async () => {
    const run = await start()
    let resolve!: (value: ReplySpeechResult) => void
    speech.finishReply.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    await tick(() => { callbacks.onAssistantText(run, 'Playing.'); callbacks.onDone(run, 0, null) })
    await tick(() => current.setSpeakReplies(false))
    expect(speech.closeReplySession).toHaveBeenCalledExactlyOnceWith('lease')
    expect(agent.cancel).not.toHaveBeenCalled(); expect(speech.stop).not.toHaveBeenCalled()
    await tick(() => resolve({ finished: false, error: 'Cancelled' }))
    expect(current.speakReplies).toBe(false)
  })
  it('offers speech-only stop for an existing run, without cancelling agent actions', async () => {
    const run = await start()
    await tick(() => callbacks.onAssistantText(run, 'Waiting.'))
    await tick(() => current.stopReplySpeech())
    await tick(() => callbacks.onDone(run, 0, null))
    expect(speech.finishReply).toHaveBeenCalledExactlyOnceWith('lease', run, null)
    expect(agent.cancel).not.toHaveBeenCalled(); expect(speech.stop).not.toHaveBeenCalled()
    expect(current.speakReplies).toBe(true)
  })
  it('discards reply ownership on clear and on hidden-document lifecycle', async () => {
    const run = await start()
    await tick(() => current.submit('/clear'))
    await tick(() => { callbacks.onAssistantText(run, 'Old conversation.'); callbacks.onDone(run, 0, null) })
    expect(speech.finishReply.mock.calls.some(([, , text]: any[]) => text !== null)).toBe(false)
    await tick(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(current.speakReplies).toBe(false)
    expect(speech.closeReplySession).toHaveBeenCalledExactlyOnceWith('lease')
    expect(agent.cancel).not.toHaveBeenCalled()
  })
  it('releases native consent that resolves after unmount, never arming a replacement session', async () => {
    let resolve!: (value: ReplySpeechSession) => void
    speech.openReplySession.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    await tick(() => current.setSpeakReplies(true))
    await tick(() => root.render(null))
    await tick(() => resolve(lease))
    expect(speech.closeReplySession).toHaveBeenCalledExactlyOnceWith('lease')
    expect(speech.reserveReply).not.toHaveBeenCalled()
  })
})
