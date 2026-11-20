import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../main/ipc-channels'
import type { ReplySpeechApi } from '../shared/speech/replies'
const mock = vi.hoisted(() => ({
  expose: vi.fn(),
  invoke: vi.fn(async () => undefined),
  on: vi.fn(),
  removeListener: vi.fn(),
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mock.expose },
  ipcRenderer: { invoke: mock.invoke, on: mock.on, removeListener: mock.removeListener },
}))
let speech: ReplySpeechApi & { selectEngine: (engine: 'kokoro' | 'openai' | 'piper', voice: string) => Promise<unknown> }
let agentApi: { onAssistantResponse: (cb: (ev: unknown) => void) => () => void }
beforeEach(async () => {
  vi.clearAllMocks(); vi.resetModules()
  await import('./index')
  const exposed = mock.expose.mock.calls.find(([name]) => name === 'workspace')![1]
  speech = exposed.speech
  agentApi = exposed.agent
})
describe('narrow completed-reply and provenance preload contract', () => {
  it('maps session/reservation lifecycle without exposing config or generic IPC', async () => {
    await speech.openReplySession('tab')
    await speech.reserveReply('lease', 'run')
    await speech.finishReply('lease', 'reply', 'Prose.')
    await speech.finishReply('lease', 'reply', null)
    await speech.closeReplySession('lease')
    expect(mock.invoke.mock.calls).toEqual([
      [IPC.SPEECH_REPLY_OPEN, 'tab'], [IPC.SPEECH_REPLY_RESERVE, 'lease', 'run'],
      [IPC.SPEECH_REPLY_FINISH, 'lease', 'reply', 'Prose.'], [IPC.SPEECH_REPLY_FINISH, 'lease', 'reply', null],
      [IPC.SPEECH_REPLY_CLOSE, 'lease'],
    ])
  })

  it('filters AGENT_ASSISTANT_RESPONSE payloads at the preload boundary and maps Piper engine selection (VOX-A1d.2 & VOX-A4e)', async () => {
    const received: unknown[] = []
    const off = agentApi.onAssistantResponse((ev) => received.push(ev))
    const handler = mock.on.mock.calls.find(([ch]) => ch === IPC.AGENT_ASSISTANT_RESPONSE)![1]

    // Malformed payloads are dropped at preload
    handler({}, { type: 'text-delta', bad: true })
    expect(received).toEqual([])

    const valid = {
      type: 'response-start',
      owner: { sessionId: 'convo-1', runId: 'run-1', epoch: 'epoch-1' },
      source: { provider: 'claude', sessionId: '550e8400-e29b-41d4-a716-446655440000', turnId: null },
      sequence: 1,
      responseId: 'msg_1:b0',
    }
    handler({}, valid)
    expect(received).toEqual([valid])
    off()
    expect(mock.removeListener).toHaveBeenCalledWith(IPC.AGENT_ASSISTANT_RESPONSE, handler)

    await speech.selectEngine('piper', 'es_ES-davefx-medium')
    expect(mock.invoke).toHaveBeenLastCalledWith(IPC.SPEECH_SELECT_ENGINE, 'piper', 'es_ES-davefx-medium')
  })
})
