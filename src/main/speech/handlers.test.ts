import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../ipc-channels'
import { defaultConfig } from '../../shared/speech/defaults'

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, ...args: any[]) => any>(),
  cleanups: [] as (() => Promise<void>)[],
  win: null as any,
  config: null as any,
  installerBusy: false,
  install: vi.fn(async () => {}),
  updateConfig: vi.fn(),
  showMessageBox: vi.fn(),
  synthesize: vi.fn(),
  sttCancel: vi.fn(),
  grant: { begin: vi.fn(), approve: vi.fn(() => true), revoke: vi.fn(), revokePending: vi.fn(), clear: vi.fn() },
  assertMainFrame: vi.fn((event: any) => { if (!event.senderFrame?.trusted) throw new Error('untrusted frame') }),
}))
vi.mock('electron', () => ({ app: {}, clipboard: {}, dialog: { showMessageBox: mock.showMessageBox }, globalShortcut: {} }))
vi.mock('../main-window', () => ({ mainWindow: () => mock.win, sendToWindow: (channel: string, ...args: unknown[]) => mock.win?.webContents.send(channel, ...args) }))
vi.mock('../security', () => ({ assertMainFrame: mock.assertMainFrame }))
vi.mock('../ipc-registry', () => ({ ipcHandle: (_ipc: unknown, channel: string, handler: any) => mock.handlers.set(channel, handler), registerCleanup: (_name: string, cleanup: () => Promise<void>) => mock.cleanups.push(cleanup) }))
vi.mock('./speech-config', async () => {
  const { defaultConfig } = await import('../../shared/speech/defaults')
  return { getConfig: () => mock.config ?? defaultConfig(), updateConfig: mock.updateConfig }
})
vi.mock('./secrets', () => ({ speechKeyStatus: vi.fn(), setSpeechKey: vi.fn() }))
vi.mock('./engines', () => ({ synthesizeFragment: mock.synthesize }))
vi.mock('./hotkey', () => ({ VoiceHotkey: class { dispose() {} } }))
vi.mock('./engines/kokoro-install', () => ({ KokoroDependencyInstaller: class { get busy() { return mock.installerBusy }; install = mock.install; cancel() {}; async shutdown() {} } }))
vi.mock('./local-stt', () => ({ LocalStt: class { cancel = mock.sttCancel }, localSttStatus: vi.fn() }))
vi.mock('./microphone-grant', () => ({ microphoneGrant: mock.grant }))

import { registerSpeechHandlers } from './handlers'

const makeWindow = (id = 10): any => {
  const frame = { trusted: true, parent: null, url: 'file:///app/index.html' }
  const contents = Object.assign(new EventEmitter(), { id, mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url, send: vi.fn() })
  return { webContents: contents, isDestroyed: () => false }
}
const owner = (): any => ({ sender: mock.win.webContents, senderFrame: mock.win.webContents.mainFrame })
const invoke = (channel: string, event: unknown, ...args: unknown[]): any => mock.handlers.get(channel)!(event, ...args)
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const audio = { pcm: Buffer.alloc(4), sampleRate: 24000, channels: 1, bitsPerSample: 16 }

beforeEach(() => {
  vi.clearAllMocks()
  mock.handlers.clear()
  mock.cleanups = []
  mock.win = makeWindow()
  mock.config = defaultConfig()
  mock.installerBusy = false
  mock.synthesize.mockImplementation((_text: string, _config: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new Error('aborted'))
    else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  registerSpeechHandlers({} as any)
})
afterEach(async () => { for (const cleanup of mock.cleanups) await cleanup(); await flush() })

describe('speech IPC reading controls', () => {
  it('checks the workspace frame and sender before cancelling a reading', () => {
    const reading = invoke(IPC.SPEECH_SPEAK, owner(), 'Hello')
    expect(() => invoke(IPC.SPEECH_CANCEL_READING, { ...owner(), senderFrame: { trusted: false } }, reading.readingId)).toThrow('untrusted frame')
    expect(() => invoke(IPC.SPEECH_CANCEL_READING, { ...owner(), sender: { id: 11 } }, reading.readingId)).toThrow('workspace window')
    for (const id of [0, -1, 1.1, NaN, Infinity, '1', null]) expect(() => invoke(IPC.SPEECH_CANCEL_READING, owner(), id)).toThrow('Invalid reading identity')
    expect(invoke(IPC.SPEECH_CANCEL_READING, owner(), reading.readingId)).toBe(true)
    expect(invoke(IPC.SPEECH_CANCEL_READING, owner(), reading.readingId)).toBe(false)
  })
  it('rejects a stale main frame even if the WebContents id and URL match', () => {
    const stale = { ...owner(), senderFrame: { trusted: true, parent: null, url: mock.win.webContents.getURL() } }
    expect(() => invoke(IPC.SPEECH_SPEAK, stale, 'private')).toThrow('workspace')
    expect(mock.synthesize).not.toHaveBeenCalled()
  })
  it('authorizes lookahead configuration and accepts only booleans', () => {
    expect(() => invoke(IPC.SPEECH_SET_LOOKAHEAD, { ...owner(), sender: { id: 11 } }, true)).toThrow('workspace window')
    expect(() => invoke(IPC.SPEECH_SET_LOOKAHEAD, owner(), 'true')).toThrow('Invalid speech lookahead setting')
    expect(mock.updateConfig).not.toHaveBeenCalled()
    invoke(IPC.SPEECH_SET_LOOKAHEAD, owner(), true)
    expect(mock.updateConfig).toHaveBeenCalledExactlyOnceWith({ playback: { ...defaultConfig().playback, prefetch_next_fragment: true } })
  })
})

describe('Kokoro setup and synthesis exclusion', () => {
  it('uses the active reading engine, not changed settings, to exclude dependency installation', async () => {
    invoke(IPC.SPEECH_SPEAK, owner(), 'active Kokoro')
    mock.config.tts.profiles[0].engine = 'openai'
    await expect(invoke(IPC.SPEECH_KOKORO_INSTALL, owner())).rejects.toThrow('Stop Kokoro')
    expect(mock.install).not.toHaveBeenCalled()
  })
  it('allows an unrelated engine while Kokoro dependency installation is busy', () => {
    mock.config.tts.profiles[0].engine = 'openai'
    mock.installerBusy = true
    expect(invoke(IPC.SPEECH_SPEAK, owner(), 'other engine').readingId).toBeGreaterThan(0)
    expect(mock.synthesize).toHaveBeenCalledOnce()
  })
  it('rechecks installer exclusion when a queued Kokoro job actually reaches synthesis', async () => {
    let reject!: (error: Error) => void
    mock.config.playback.on_retrigger = 'queue'
    mock.config.tts.profiles[0].engine = 'openai'
    mock.synthesize.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    invoke(IPC.SPEECH_SPEAK, owner(), 'active other engine')
    mock.config.tts.profiles[0].engine = 'kokoro'
    const queued = invoke(IPC.SPEECH_SPEAK, owner(), 'queued Kokoro')
    mock.config.tts.profiles[0].engine = 'openai'
    mock.installerBusy = true
    reject(new Error('first job ended'))
    await flush()
    expect(mock.synthesize).toHaveBeenCalledTimes(1)
    expect(mock.win.webContents.send).toHaveBeenCalledWith(IPC.SPEECH_EVENT, expect.objectContaining({
      type: 'result', readingId: queued.readingId, result: { finished: false, error: expect.stringContaining('dependency setup') },
    }))
  })
})

describe('speech document lifetime', () => {
  it.each(['destroyed', 'render-process-gone', 'reload'])('cancels synthesis, STT and armed permissions on %s; late audio cannot reach a replacement', async (event) => {
    let release!: (value: typeof audio) => void
    let signal!: AbortSignal
    mock.synthesize.mockImplementationOnce((_text, _config, current: AbortSignal) => { signal = current; return new Promise((resolve) => { release = resolve }) })
    const previous = mock.win
    invoke(IPC.SPEECH_SPEAK, owner(), 'private old reply')
    if (event === 'reload') previous.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    else previous.webContents.emit(event)
    if (event !== 'reload') mock.win = makeWindow(11)
    expect(signal.aborted).toBe(true)
    expect(mock.sttCancel).toHaveBeenCalled()
    expect(mock.grant.clear).toHaveBeenCalled()
    release(audio)
    await flush()
    expect(previous.webContents.send).not.toHaveBeenCalledWith(IPC.SPEECH_PLAYBACK, expect.objectContaining({ type: 'play' }))
    expect(mock.win.webContents.send).not.toHaveBeenCalledWith(IPC.SPEECH_PLAYBACK, expect.objectContaining({ type: 'play' }))
    if (event !== 'reload') expect(mock.win.webContents.send).not.toHaveBeenCalledWith(IPC.SPEECH_EVENT, expect.objectContaining({ type: 'result' }))
  })
  it('cancels active renderer playback before a same-URL reload and rejects its late acknowledgement', async () => {
    mock.synthesize.mockResolvedValueOnce(audio)
    invoke(IPC.SPEECH_SPEAK, owner(), 'hello')
    await flush()
    const play = mock.win.webContents.send.mock.calls.find(([channel, message]: any[]) => channel === IPC.SPEECH_PLAYBACK && message.type === 'play')?.[1]
    expect(play?.id).toBeTruthy()
    mock.win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    await flush()
    expect(mock.win.webContents.send).toHaveBeenCalledWith(IPC.SPEECH_PLAYBACK, { type: 'cancel', id: play.id })
    expect(invoke(IPC.SPEECH_PLAYBACK_DONE, owner(), play.id, true)).toBe(false)
  })
  it('does not stop work for subframe or same-document navigation', async () => {
    invoke(IPC.SPEECH_SPEAK, owner(), 'hello')
    const signal = mock.synthesize.mock.calls[0][2] as AbortSignal
    mock.win.webContents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    mock.win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    await flush()
    expect(signal.aborted).toBe(false)
  })
  it('rejects a microphone approval after a same-URL reload while its native prompt was open', async () => {
    let approve!: (value: { response: number }) => void
    mock.showMessageBox.mockImplementationOnce(() => new Promise((resolve) => { approve = resolve }))
    const result = invoke(IPC.SPEECH_MICROPHONE_AUTHORIZE, owner(), '11111111-1111-4111-8111-111111111111').catch((e: Error) => e.message)
    mock.win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    approve({ response: 1 })
    expect(await result).not.toBe(true)
    expect(mock.grant.approve).not.toHaveBeenCalled()
  })
})

describe('owned completed-reply speech IPC', () => {
  const open = async (tab = 'tab-1'): Promise<{ id: string }> => {
    mock.showMessageBox.mockResolvedValueOnce({ response: 1 })
    return invoke(IPC.SPEECH_REPLY_OPEN, owner(), tab)
  }
  const reserve = (id: string, run: string) => invoke(IPC.SPEECH_REPLY_RESERVE, owner(), id, run)
  const read = (id: string, reply: string, text = 'Hello.') => invoke(IPC.SPEECH_REPLY_FINISH, owner(), id, reply, text)

  it('authorizes all four lifecycle endpoints before accepting input', async () => {
    for (const channel of [IPC.SPEECH_REPLY_OPEN, IPC.SPEECH_REPLY_RESERVE, IPC.SPEECH_REPLY_FINISH, IPC.SPEECH_REPLY_CLOSE]) {
      await expect(Promise.resolve().then(() => invoke(channel, { ...owner(), sender: { id: 11 } }, 'tab', 'run', 'private'))).rejects.toThrow('workspace')
    }
    expect(mock.showMessageBox).not.toHaveBeenCalled()
    expect(mock.synthesize).not.toHaveBeenCalled()
  })
  it('asks native consent for the exact frozen destination, including cloud transmission', async () => {
    let approve!: (value: { response: number }) => void
    mock.config.tts.profiles[0].engine = 'openai'
    mock.config.tts.profiles[0].voice = 'alloy'
    mock.showMessageBox.mockImplementationOnce(() => new Promise((resolve) => { approve = resolve }))
    const opening = invoke(IPC.SPEECH_REPLY_OPEN, owner(), 'tab')
    expect(mock.showMessageBox.mock.calls[0][1]).toEqual(expect.objectContaining({ defaultId: 0, cancelId: 0, detail: expect.stringContaining('sent to OpenAI') }))
    mock.config.tts.profiles[0].engine = 'kokoro'
    mock.config.tts.profiles[0].voice = 'changed'
    approve({ response: 1 })
    const session = await opening
    expect(session).toMatchObject({ engine: 'openai', voice: 'alloy', remote: true })
    const reply = reserve(session.id, 'run')
    const result = read(session.id, reply.id)
    await flush()
    expect(mock.synthesize.mock.calls[0][1].tts.profiles[0]).toMatchObject({ engine: 'openai', voice: 'alloy' })
    invoke(IPC.SPEECH_REPLY_CLOSE, owner(), session.id)
    expect(await result).toEqual({ finished: false, error: 'Cancelled' })
  })
  it('declined or stale approval cannot create a session; simultaneous prompts are bounded', async () => {
    mock.showMessageBox.mockResolvedValueOnce({ response: 0 })
    expect(await invoke(IPC.SPEECH_REPLY_OPEN, owner(), 'tab')).toBeNull()
    let approve!: (value: { response: number }) => void
    mock.showMessageBox.mockImplementationOnce(() => new Promise((resolve) => { approve = resolve }))
    const opening = invoke(IPC.SPEECH_REPLY_OPEN, owner(), 'tab')
    await expect(invoke(IPC.SPEECH_REPLY_OPEN, owner(), 'other')).rejects.toThrow('already open')
    mock.win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    approve({ response: 1 })
    expect(await opening).toBeNull()
    expect(mock.synthesize).not.toHaveBeenCalled()
  })
  it('rejects malformed tab identities before showing native consent', async () => {
    for (const id of [null, 1, '', 'x'.repeat(129), '../private']) await expect(invoke(IPC.SPEECH_REPLY_OPEN, owner(), id)).rejects.toThrow('identity')
    expect(mock.showMessageBox).not.toHaveBeenCalled()
  })
  it('queues two reply sessions without interrupting, then cancels only the closed session', async () => {
    const a = await open('tab-a'), b = await open('tab-b')
    const ar = reserve(a.id, 'run-a'), br = reserve(b.id, 'run-b')
    const first = read(a.id, ar.id), second = read(b.id, br.id)
    const firstSignal = mock.synthesize.mock.calls[0][2]
    expect(firstSignal.aborted).toBe(false)
    expect(mock.synthesize).toHaveBeenCalledTimes(1)
    invoke(IPC.SPEECH_REPLY_CLOSE, owner(), a.id)
    expect(await first).toEqual({ finished: false, error: 'Cancelled' })
    await flush()
    expect(mock.synthesize).toHaveBeenCalledTimes(2)
    expect(mock.synthesize.mock.calls[1][2].aborted).toBe(false)
    invoke(IPC.SPEECH_REPLY_CLOSE, owner(), b.id)
    expect(await second).toEqual({ finished: false, error: 'Cancelled' })
  })
  it('closing a queued reply does not interrupt manual reading', async () => {
    invoke(IPC.SPEECH_SPEAK, owner(), 'Manual reading')
    const manualSignal = mock.synthesize.mock.calls[0][2]
    const session = await open(), reply = reserve(session.id, 'run')
    const result = read(session.id, reply.id)
    invoke(IPC.SPEECH_REPLY_CLOSE, owner(), session.id)
    expect(await result).toEqual({ finished: false, error: 'Cancelled' })
    expect(manualSignal.aborted).toBe(false)
    expect(mock.synthesize).toHaveBeenCalledTimes(1)
  })
  it('global Stop invalidates reserved completions but still allows future prompt reservations', async () => {
    const session = await open(), reply = reserve(session.id, 'run')
    invoke(IPC.SPEECH_STOP, owner())
    await expect(read(session.id, reply.id, 'late')).rejects.toThrow('reservation')
    expect(reserve(session.id, 'next').id).toBeTruthy()
    expect(mock.synthesize).not.toHaveBeenCalled()
  })
  it('waits for acknowledged playback drain and rejects duplicate text completion', async () => {
    const session = await open(), reply = reserve(session.id, 'run')
    mock.synthesize.mockResolvedValueOnce(audio)
    let finished = false
    const result = read(session.id, reply.id).then((value: unknown) => { finished = true; return value })
    await flush()
    expect(finished).toBe(false)
    const play = mock.win.webContents.send.mock.calls.find(([channel, message]: any[]) => channel === IPC.SPEECH_PLAYBACK && message.type === 'play')?.[1]
    expect(play?.id).toBeTruthy()
    expect(invoke(IPC.SPEECH_PLAYBACK_DONE, owner(), play.id, true)).toBe(true)
    expect(await result).toEqual({ finished: true })
    await expect(read(session.id, reply.id, 'replay')).rejects.toThrow('reservation')
  })
  it('document teardown closes reservations and playback before a replacement can use their IDs', async () => {
    const session = await open(), reply = reserve(session.id, 'run')
    mock.synthesize.mockResolvedValueOnce(audio)
    const result = read(session.id, reply.id)
    await flush()
    mock.win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(await result).toEqual({ finished: false, error: 'Cancelled' })
    expect(() => reserve(session.id, 'late')).toThrow('session')
    await expect(read(session.id, reply.id, 'late')).rejects.toThrow('session')
  })
})
