import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../main/ipc-channels'
import type { ReplySpeechApi } from '../shared/speech/replies'
const mock = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(async () => undefined) }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mock.expose }, ipcRenderer: { invoke: mock.invoke } }))
let speech: ReplySpeechApi
beforeEach(async () => {
  vi.clearAllMocks(); vi.resetModules()
  await import('./index')
  speech = mock.expose.mock.calls.find(([name]) => name === 'workspace')![1].speech
})
describe('narrow completed-reply preload contract', () => {
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
})
