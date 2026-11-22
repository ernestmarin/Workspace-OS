// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * VOX-REACH-01 — the shipped agent surface must actually host voice.
 *
 * The dictation control, the voice interface-command card and the reply reader
 * were all built inside `AgentTerminal/TerminalSession.tsx`, which the
 * landscape shell stopped mounting (docs/landscape/PROGRESS.md, phase 7:
 * "AgentTerminal … only mounted by the classic layout"). Their unit tests mount
 * the component directly, so every voice check stayed green while none of it
 * was reachable from the running app. This suite drives the pane the dock
 * really renders.
 */
const mock = vi.hoisted(() => ({
  voice: null as null | {
    active: boolean
    onTranscript?: (text: string) => void
    onFinalCommand?: (capture: { text: string; language: 'es' | 'en'; transcriptId: string }) => void
  },
  prompt: null as null | Record<string, unknown>,
  openRail: vi.fn(),
  send: vi.fn(),
}))
vi.mock('../AgentTerminal/VoiceDictation', () => ({
  VoiceDictation: (props: { active: boolean; onTranscript?: (t: string) => void; onFinalCommand?: (c: { text: string; language: 'es' | 'en'; transcriptId: string }) => void }) => {
    mock.voice = props
    return null
  },
}))
vi.mock('../PromptBar/PromptBar', () => ({
  PromptBar: (props: Record<string, unknown>) => { mock.prompt = props; return null },
}))
vi.mock('../AgentTerminal/RunTrace', () => ({ RunTrace: () => null }))
vi.mock('../Landscape/session/SessionPane', () => ({ useSessions: () => {} }))
vi.mock('../Landscape/agentActions', () => ({ openRail: mock.openRail }))
vi.mock('../../lib/sessions/sessionStore', () => ({
  sessionStore: {
    get: () => ({ messages: [], files: [] }),
    live: () => ({ running: false, steps: [] }),
    create: vi.fn(),
    send: mock.send,
    // Reply lifecycle (VOX-REACH-04): this suite never opts in, so no events.
    onReplyEvents: () => () => {},
  },
}))
import { TerminalAgentPane } from './TerminalAgentPane'

let root: Root, element: HTMLDivElement
const flush = async (): Promise<void> => { for (let i = 0; i < 15; i++) await Promise.resolve() }
const render = async (active = true): Promise<void> => act(async () => {
  root.render(<TerminalAgentPane sessionId="tab-1" active={active} context={{ root: null, surface: null, openFile: null, folder: null }} />)
  await flush()
})
const button = (text: string): HTMLButtonElement =>
  [...element.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!
const region = (): Element | null => element.querySelector('[aria-label="Voice command confirmation"]')

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom implements no scrolling; the pane's log follows the last message.
  Element.prototype.scrollTo = () => {}
  vi.clearAllMocks()
  mock.voice = null
  mock.prompt = null
  Object.defineProperty(window, 'workspace', { configurable: true, value: { skills: { list: vi.fn(async () => []) } } })
  element = document.createElement('div')
  document.body.append(element)
  root = createRoot(element)
})
afterEach(async () => { await act(async () => root.unmount()); element.remove() })

describe('TerminalAgentPane voice (VOX-REACH-01)', () => {
  it('mounts push-to-talk dictation and puts a final transcript in the composer for review, never straight to the agent', async () => {
    await render()
    expect(mock.voice).not.toBeNull()
    expect(typeof mock.voice!.onTranscript).toBe('function')
    expect(mock.voice!.active).toBe(true)

    await act(async () => { mock.voice!.onTranscript!('hola agente'); await flush() })
    expect(mock.prompt!.dictatedText).toBe('hola agente')
    // Recognition/dictation is not submission: the reviewed send path is the only one.
    expect(mock.send).not.toHaveBeenCalled()

    await act(async () => { (mock.prompt!.onDictationConsumed as () => void)(); await flush() })
    expect(mock.prompt!.dictatedText).toBeNull()
  })

  it('proposes an exact command only after final speech, performs it once on explicit confirmation, and never sends it as a prompt', async () => {
    await render()
    await act(async () => {
      mock.voice!.onFinalCommand!({ text: 'abre archivos', language: 'es', transcriptId: 'tr-1' })
      await flush()
    })
    expect(region()?.textContent).toContain('Mostrar archivos')
    expect(mock.openRail).not.toHaveBeenCalled()
    expect(mock.send).not.toHaveBeenCalled()

    await act(async () => { button('Confirmar comando').click(); await flush() })
    expect(mock.openRail).toHaveBeenCalledExactlyOnceWith('files')
    expect(mock.send).not.toHaveBeenCalled()
    expect(region()).toBeNull()
  })

  it('never proposes a command this surface cannot perform, so Confirm is never a silent no-op', async () => {
    await render()
    await act(async () => {
      mock.voice!.onFinalCommand!({ text: 'abre ajustes de voz', language: 'es', transcriptId: 'tr-2' })
      await flush()
    })
    expect(region()).toBeNull()
    expect(mock.openRail).not.toHaveBeenCalled()
    expect(button('Confirmar comando')).toBeUndefined()
  })

  it('revokes a pending command and deactivates the microphone when its tab is hidden', async () => {
    await render()
    await act(async () => {
      mock.voice!.onFinalCommand!({ text: 'open files', language: 'en', transcriptId: 'tr-3' })
      await flush()
    })
    expect(region()).not.toBeNull()

    await render(false)
    expect(region()).toBeNull()
    expect(mock.openRail).not.toHaveBeenCalled()
    expect(mock.voice!.active).toBe(false)
  })

  it('dismisses a proposal without performing it', async () => {
    await render()
    await act(async () => {
      mock.voice!.onFinalCommand!({ text: 'open browser', language: 'en', transcriptId: 'tr-4' })
      await flush()
    })
    await act(async () => { button('Dismiss').click(); await flush() })
    expect(region()).toBeNull()
    expect(mock.openRail).not.toHaveBeenCalled()
  })
})
