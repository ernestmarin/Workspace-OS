import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../ipc-channels'
import { defaultConfig } from '../../shared/speech/defaults'

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, ...args: any[]) => any>(),
  updateConfig: vi.fn(),
  assertMainFrame: vi.fn((event: any) => { if (!event.senderFrame?.trusted) throw new Error('untrusted frame') }),
}))
vi.mock('electron', () => ({ app: {}, clipboard: {}, dialog: {}, globalShortcut: {} }))
vi.mock('../main-window', () => ({ mainWindow: () => ({ webContents: { id: 10 } }), sendToWindow: vi.fn() }))
vi.mock('../security', () => ({ assertMainFrame: mock.assertMainFrame }))
vi.mock('../ipc-registry', () => ({ ipcHandle: (_ipc: unknown, channel: string, handler: any) => mock.handlers.set(channel, handler), registerCleanup: vi.fn() }))
vi.mock('./speech-config', async () => {
  const { defaultConfig } = await import('../../shared/speech/defaults')
  return { getConfig: () => defaultConfig(), updateConfig: mock.updateConfig }
})
vi.mock('./secrets', () => ({ speechKeyStatus: vi.fn(), setSpeechKey: vi.fn() }))
vi.mock('./engines', () => ({ synthesizeFragment: (_text: string, _config: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
  if (signal.aborted) reject(new Error('aborted'))
  else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
}) }))
vi.mock('./hotkey', () => ({ VoiceHotkey: class { dispose() {} } }))
vi.mock('./engines/kokoro-install', () => ({ KokoroDependencyInstaller: class { busy = false } }))
vi.mock('./local-stt', () => ({ LocalStt: class {}, localSttStatus: vi.fn() }))
vi.mock('./microphone-grant', () => ({ microphoneGrant: {} }))

import { registerSpeechHandlers } from './handlers'

const owner = { sender: { id: 10 }, senderFrame: { trusted: true } }
const invoke = (channel: string, event: unknown, ...args: unknown[]): any => mock.handlers.get(channel)!(event, ...args)

beforeEach(() => {
  mock.handlers.clear()
  mock.updateConfig.mockClear()
  registerSpeechHandlers({} as any)
})

describe('speech IPC reading controls', () => {
  it('checks the workspace frame and sender before cancelling a reading', () => {
    const reading = invoke(IPC.SPEECH_SPEAK, owner, 'Hello')
    expect(() => invoke(IPC.SPEECH_CANCEL_READING, { sender: { id: 10 }, senderFrame: { trusted: false } }, reading.readingId)).toThrow('untrusted frame')
    expect(() => invoke(IPC.SPEECH_CANCEL_READING, { sender: { id: 11 }, senderFrame: { trusted: true } }, reading.readingId)).toThrow('workspace window')
    for (const id of [0, -1, 1.1, NaN, Infinity, '1', null]) expect(() => invoke(IPC.SPEECH_CANCEL_READING, owner, id)).toThrow('Invalid reading identity')
    expect(invoke(IPC.SPEECH_CANCEL_READING, owner, reading.readingId)).toBe(true)
    expect(invoke(IPC.SPEECH_CANCEL_READING, owner, reading.readingId)).toBe(false)
  })
  it('authorizes lookahead configuration and accepts only booleans', () => {
    expect(() => invoke(IPC.SPEECH_SET_LOOKAHEAD, { sender: { id: 11 }, senderFrame: { trusted: true } }, true)).toThrow('workspace window')
    expect(() => invoke(IPC.SPEECH_SET_LOOKAHEAD, owner, 'true')).toThrow('Invalid speech lookahead setting')
    expect(mock.updateConfig).not.toHaveBeenCalled()
    invoke(IPC.SPEECH_SET_LOOKAHEAD, owner, true)
    expect(mock.updateConfig).toHaveBeenCalledExactlyOnceWith({ playback: { ...defaultConfig().playback, prefetch_next_fragment: true } })
  })
})
