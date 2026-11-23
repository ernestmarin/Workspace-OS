// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReplySpeechResult, ReplySpeechSession } from '../../../../shared/speech/replies'

/*
 * VOX-REACH-04 — the shipped agent pane must actually host the reply reader.
 *
 * `OwnedReplies` had a thorough unit suite and no reachable caller: it was built
 * for `AgentTerminal/TerminalSession.tsx`, a component the landscape shell
 * stopped mounting. This drives the pane the dock really renders and asserts the
 * reader is bound to the lib/sessions run lifecycle, that consent stays opt-in
 * and per tab, and that stopping the reading never touches the agent.
 */
const mock = vi.hoisted(() => ({
  replyListeners: [] as ((e: unknown) => void)[],
  send: vi.fn(),
}))
vi.mock('../AgentTerminal/VoiceDictation', () => ({ VoiceDictation: () => null }))
vi.mock('../PromptBar/PromptBar', () => ({ PromptBar: () => null }))
vi.mock('../AgentTerminal/RunTrace', () => ({ RunTrace: () => null }))
vi.mock('../Landscape/session/SessionPane', () => ({ useSessions: () => {} }))
vi.mock('../Landscape/agentActions', () => ({ openRail: vi.fn() }))
vi.mock('../../lib/sessions/sessionStore', () => ({
  sessionStore: {
    get: () => ({ messages: [], files: [] }),
    live: () => ({ running: false, steps: [] }),
    create: vi.fn(),
    send: mock.send,
    onReplyEvents: (handler: (e: unknown) => void) => {
      mock.replyListeners.push(handler)
      return () => { mock.replyListeners = mock.replyListeners.filter((h) => h !== handler) }
    },
  },
}))
import { dockSessionId, TerminalAgentPane } from './TerminalAgentPane'

/** The pane's own session id: `dockSessionId('tab-1')`. */
const TAB = dockSessionId('tab-1')

const speech = {
  openReplySession: vi.fn(async (_tab: string): Promise<ReplySpeechSession | null> => ({
    id: 'lease-1', engine: 'kokoro', voice: 'af_heart', remote: false,
  })),
  reserveReply: vi.fn(async (_s: string, run: string) => ({ id: `reply-${run}` })),
  finishReply: vi.fn(async (_s: string, _r: string, text: string | null): Promise<ReplySpeechResult> =>
    text === null ? { finished: false, error: 'Cancelled' } : { finished: true }),
  closeReplySession: vi.fn(async (_s: string) => {}),
}
/** Only main may cancel an agent; the pane holds no such call. */
const agent = { cancel: vi.fn(async () => {}) }

let root: Root, element: HTMLDivElement
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const render = async (active = true): Promise<void> => act(async () => {
  root.render(<TerminalAgentPane sessionId="tab-1" active={active} context={{ root: null, surface: null, openFile: null, folder: null }} />)
  await flush()
})
const button = (text: string): HTMLButtonElement | undefined =>
  [...element.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
/** Feeds the pane a lifecycle event as lib/sessions would. */
const emit = async (e: Record<string, unknown>): Promise<void> => {
  await act(async () => { for (const h of mock.replyListeners) h(e); await flush() })
}
/** A complete successful reply for one run of this tab. */
const reply = async (runId: string, text: string, sessionId: string = TAB): Promise<void> => {
  await emit({ type: 'begin', sessionId, runId })
  await emit({ type: 'text', sessionId, runId, text })
  await emit({ type: 'finish', sessionId, runId, ok: true })
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollTo = () => {}
  vi.clearAllMocks()
  mock.replyListeners = []
  Object.defineProperty(window, 'workspace', {
    configurable: true,
    value: { skills: { list: vi.fn(async () => []) }, speech, agent },
  })
  element = document.createElement('div')
  document.body.append(element)
  root = createRoot(element)
})
afterEach(async () => { await act(async () => root.unmount()); element.remove() })

describe('TerminalAgentPane reply reading (VOX-REACH-04)', () => {
  it('reads nothing until the person turns it on, and asks consent for this tab only', async () => {
    await render()
    await reply('run-1', 'No leído.')
    expect(speech.openReplySession).not.toHaveBeenCalled()
    expect(speech.reserveReply).not.toHaveBeenCalled()

    await act(async () => { button('Read replies')!.click(); await flush() })
    expect(speech.openReplySession).toHaveBeenCalledExactlyOnceWith(TAB)
  })

  it('speaks a completed reply of its own session once, through the frozen main lease', async () => {
    await render()
    await act(async () => { button('Read replies')!.click(); await flush() })
    await reply('run-2', 'Hecho.')

    expect(speech.reserveReply).toHaveBeenCalledExactlyOnceWith('lease-1', 'run-2')
    expect(speech.finishReply).toHaveBeenCalledExactlyOnceWith('lease-1', 'reply-run-2', 'Hecho.')
  })

  it('never reads a reply that belongs to another tab', async () => {
    await render()
    await act(async () => { button('Read replies')!.click(); await flush() })
    await reply('run-3', 'Ajeno.', 'dock-someone-else')

    expect(speech.reserveReply).not.toHaveBeenCalled()
    expect(speech.finishReply).not.toHaveBeenCalled()
  })

  it('stays off and reserves nothing when the person cancels the consent dialog', async () => {
    speech.openReplySession.mockResolvedValueOnce(null)
    await render()
    await act(async () => { button('Read replies')!.click(); await flush() })
    await reply('run-4', 'Cancelado.')

    expect(speech.reserveReply).not.toHaveBeenCalled()
    expect(speech.finishReply).not.toHaveBeenCalled()
    expect(button('Read replies')).toBeDefined() // still offered, never silently "on"
  })

  it('closes this tab’s lease when the tab is hidden, without touching the agent', async () => {
    await render()
    await act(async () => { button('Read replies')!.click(); await flush() })
    await render(false)

    expect(speech.closeReplySession).toHaveBeenCalledExactlyOnceWith('lease-1')
    expect(agent.cancel).not.toHaveBeenCalled()
    expect(mock.send).not.toHaveBeenCalled()
  })

  it('closes the lease on unmount', async () => {
    await render()
    await act(async () => { button('Read replies')!.click(); await flush() })
    await act(async () => root.unmount())

    expect(speech.closeReplySession).toHaveBeenCalledExactlyOnceWith('lease-1')
    expect(agent.cancel).not.toHaveBeenCalled()
  })

  it('stops only this tab’s pending reply audio on demand, leaving consent in place', async () => {
    await render()
    await act(async () => { button('Read replies')!.click(); await flush() })
    await emit({ type: 'begin', sessionId: TAB, runId: 'run-5' })
    await emit({ type: 'text', sessionId: TAB, runId: 'run-5', text: 'Largo…' })
    speech.finishReply.mockClear()

    await act(async () => { button('Stop reply audio')!.click(); await flush() })
    expect(speech.finishReply).toHaveBeenCalledExactlyOnceWith('lease-1', 'reply-run-5', null)
    // Consent survives: the next completed reply of this tab is still read.
    expect(speech.closeReplySession).not.toHaveBeenCalled()
    await reply('run-6', 'Siguiente.')
    expect(speech.finishReply).toHaveBeenCalledWith('lease-1', 'reply-run-6', 'Siguiente.')
  })

  it('turning it off closes the lease, so nothing queued is ever spoken', async () => {
    await render()
    await act(async () => { button('Read replies')!.click(); await flush() })
    await emit({ type: 'begin', sessionId: TAB, runId: 'run-7' })
    await emit({ type: 'text', sessionId: TAB, runId: 'run-7', text: 'A medias' })
    speech.finishReply.mockClear()

    await act(async () => { button('Replies on')!.click(); await flush() })
    // One lease close, not one cancel per reply: main's registry discards the
    // reservations of a closed lease, so the queued prose is never spoken.
    expect(speech.closeReplySession).toHaveBeenCalledExactlyOnceWith('lease-1')
    expect(speech.finishReply.mock.calls.some(([, , text]) => text !== null)).toBe(false)
    expect(agent.cancel).not.toHaveBeenCalled()
    // And the queued run is gone: its late finish reads nothing.
    await emit({ type: 'finish', sessionId: TAB, runId: 'run-7', ok: true })
    expect(speech.finishReply.mock.calls.some(([, , text]) => text !== null)).toBe(false)
  })

  it('discards a reply whose run failed instead of speaking a half answer', async () => {
    await render()
    await act(async () => { button('Read replies')!.click(); await flush() })
    await emit({ type: 'begin', sessionId: TAB, runId: 'run-8' })
    await emit({ type: 'text', sessionId: TAB, runId: 'run-8', text: 'Parcial' })
    await emit({ type: 'finish', sessionId: TAB, runId: 'run-8', ok: false })

    expect(speech.finishReply).toHaveBeenCalledExactlyOnceWith('lease-1', 'reply-run-8', null)
  })
})
