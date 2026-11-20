// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ session: null as any, record: { runMode: 'prompt' }, update: vi.fn() }))
vi.mock('./useAgentSession', () => ({ useAgentSession: () => mock.session }))
vi.mock('../../hooks/useAgentMenu', () => ({ useAgentMenu: () => {} }))
vi.mock('../../lib/agentModels', () => ({ useAgentModels: () => [{ id: '', label: 'Default' }] }))
vi.mock('./sessionStore', () => ({ sessionStore: { get: () => mock.record, update: mock.update } }))
vi.mock('./budgetLedger', () => ({ formatLedger: () => '' }))
vi.mock('./AgentXterm', () => ({ AgentXterm: () => null }))
vi.mock('./VoiceDictation', () => ({ VoiceDictation: () => null }))
vi.mock('./TerminalInput', () => ({ TerminalInput: () => null }))
vi.mock('./ArtifactCards', () => ({ ArtifactCards: () => null }))
vi.mock('./NewAgentForm', () => ({ NewAgentForm: () => null }))
vi.mock('./AgentPtySession', () => ({ AgentPtySession: () => <div>Interactive session</div> }))
vi.mock('../Checkpoints/DiffSheet', () => ({ DiffSheet: () => null }))
import { TerminalSession } from './TerminalSession'

let root: Root, element: HTMLDivElement
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
const render = async (active = true) => act(async () => {
  root.render(<TerminalSession sessionId="tab" activeFile={null} active={active} onWorkspaceChanged={() => {}} onOpenFile={() => {}} />)
  await flush()
})
const button = (text: string) => [...element.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mock.record = { runMode: 'prompt' }
  mock.session = {
    attachTerminal: vi.fn(), history: [], status: 'idle', runningCount: 0, lastExitCode: null, lastPrompt: null,
    canRevert: false, lastCheckpointId: null, reverted: false, mode: 'safe', setMode: vi.fn(), model: '', setModel: vi.fn(),
    agentName: null, setAgentName: vi.fn(), ledger: {}, artifacts: [], submit: vi.fn(),
    speakReplies: false, setSpeakReplies: vi.fn(), stopReplySpeech: vi.fn(), cancelAll: vi.fn(), rerun: vi.fn(), revertLast: vi.fn(),
    replySpeechState: { enabled: false, pending: false, activeCount: 0, destination: null },
  }
  Object.defineProperty(window, 'workspace', { configurable: true, value: { agents: { list: vi.fn(async () => []) } } })
  element = document.createElement('div'); document.body.append(element); root = createRoot(element)
})
afterEach(async () => { await act(async () => root.unmount()); element.remove() })

describe('prompt-tab speech controls', () => {
  it('requests opt-in through the native-consent path, with no microphone action', async () => {
    await render()
    const read = button('Read replies')
    expect(read.getAttribute('aria-pressed')).toBe('false')
    await act(async () => read.click())
    expect(mock.session.setSpeakReplies).toHaveBeenCalledExactlyOnceWith(true)
    expect(mock.session.cancelAll).not.toHaveBeenCalled()
  })
  it('shows pending consent as busy and prevents duplicate dialog requests', async () => {
    mock.session.replySpeechState.pending = true
    await render()
    const read = button('Reply permission')
    expect(read.disabled).toBe(true)
    expect(read.getAttribute('aria-busy')).toBe('true')
    await act(async () => read.click())
    expect(mock.session.setSpeakReplies).not.toHaveBeenCalled()
  })
  it('offers a distinct speech-only stop and shows the approved fixed destination', async () => {
    mock.session.speakReplies = true
    mock.session.replySpeechState = { enabled: true, pending: false, activeCount: 1, destination: { engine: 'openai', voice: 'alloy', remote: true } }
    await render()
    expect(button('Replies on').title).toContain('openai · alloy')
    await act(async () => button('Stop reply audio').click())
    expect(mock.session.stopReplySpeech).toHaveBeenCalledOnce()
    expect(mock.session.cancelAll).not.toHaveBeenCalled()
    await act(async () => button('Replies on').click())
    expect(mock.session.setSpeakReplies).toHaveBeenCalledExactlyOnceWith(false)
  })
  it('revokes reply reading on tab deactivation and never rearms it on return', async () => {
    await render()
    await render(false)
    expect(mock.session.setSpeakReplies).toHaveBeenCalledExactlyOnceWith(false)
    expect(button('Read replies').disabled).toBe(true)
    await render(true)
    expect(mock.session.setSpeakReplies).toHaveBeenCalledTimes(1)
  })
  it('revokes reply reading before switching to the unsupported PTY broker', async () => {
    await render()
    await act(async () => { button('Interactive').click(); await flush() })
    expect(mock.session.setSpeakReplies).toHaveBeenCalledExactlyOnceWith(false)
    expect(element.textContent).toContain('Interactive session')
  })
})
