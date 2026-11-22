import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../ipc-channels'

/**
 * IPC-SPEECH-02 — the last cluster of the IPC-CLASS-01 verdict-A list.
 *
 * The interesting result of this batch is that **the twenty-seven `speech:*`
 * handlers were already protected**: every one of them calls the module's own
 * `assertOwner(event)`, which is `documentFor(assertWorkspace(event))`, and
 * `assertWorkspace` calls `assertMainFrame(event)` and then requires
 * `event.sender === mainWindow().webContents` **and**
 * `event.senderFrame === mainWindow().webContents.mainFrame`.
 *
 * The inventory did not know that name, so it recorded all twenty-seven as
 * `EXPLICITLY_NO_GUARD` debt (SPEECH-01). This file proves the property by
 * behaviour instead of by reading the source: with `mainWindow()` returning a
 * window that is not the caller's, every channel must refuse, and with the real
 * main window every channel must be admitted. The inventory fix that follows
 * turns the same property into a rule.
 */

type Any = Record<string, unknown>

const state = vi.hoisted(() => ({
  calls: [] as string[],
  registered: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  dialogResponse: 0,
  config: {} as Any,
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app', getPath: () => '/state' },
  clipboard: {
    readText: () => {
      state.calls.push('clipboard.readText')
      return 'copied text'
    },
  },
  dialog: {
    showMessageBox: async () => {
      state.calls.push('dialog.showMessageBox')
      return { response: state.dialogResponse }
    },
  },
  globalShortcut: { register: () => true, unregister: () => {} },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      state.registered.set(channel, fn)
    },
  },
}))

const record = (name: string, value: unknown = undefined) => () => {
  state.calls.push(name)
  return value
}

vi.mock('../main-window', () => ({
  mainWindow: () => {
    state.calls.push('mainWindow()')
    return (globalThis as unknown as { __wosOwnerWindow?: unknown }).__wosOwnerWindow ?? null
  },
  sendToWindow: (channel: string) => {
    state.calls.push(`sendToWindow:${channel}`)
  },
}))
vi.mock('./speech-config', () => ({
  getConfig: () => {
    state.calls.push('getConfig')
    return structuredClone(state.config)
  },
  updateConfig: (patch: unknown) => {
    state.calls.push('updateConfig')
    state.config = { ...state.config, ...(patch as Any) }
  },
}))
vi.mock('./secrets', () => ({
  speechKeyStatus: () => {
    state.calls.push('speechKeyStatus')
    return { configured: false }
  },
  setSpeechKey: (name: string) => {
    state.calls.push(`setSpeechKey:${name}`)
  },
}))
vi.mock('./engines', () => ({ synthesizeFragment: async () => Buffer.from('audio') }))
vi.mock('./playback', () => ({
  PlaybackBroker: class {
    play() {
      state.calls.push('broker.play')
      return { done: Promise.resolve(true), cancel: () => {} }
    }
    complete() {
      state.calls.push('broker.complete')
      return { ok: true }
    }
    closeOwner() {}
  },
}))
vi.mock('./reading', () => ({
  ReadingController: class {
    read() {
      state.calls.push('controller.read')
      return { id: 1, result: Promise.resolve({ ok: true }) }
    }
    cancel(id: number) {
      state.calls.push(`controller.cancel:${id}`)
      return true
    }
    stop() {
      state.calls.push('controller.stop')
    }
    getStatus() {
      state.calls.push('controller.getStatus')
      return { speaking: false, engine: 'openai' }
    }
  },
}))
vi.mock('./replies', () => ({
  replyDestination: () => ({ engine: 'openai', voice: 'alloy', remote: true }),
  ReplyReadingSessions: class {
    open() {
      state.calls.push('replies.open')
      return { session: 's1' }
    }
    reserve() {
      state.calls.push('replies.reserve')
      return { ok: true }
    }
    finish() {
      state.calls.push('replies.finish')
      return { ok: true }
    }
    close() {
      state.calls.push('replies.close')
    }
    closeContext() {}
    closeAll() {}
    stopWork() {
      state.calls.push('replies.stopWork')
    }
  },
}))
vi.mock('./hotkey', () => ({
  VoiceHotkey: class {
    shortcut = ''
    set(v: string) {
      state.calls.push(`hotkey.set:${v}`)
      this.shortcut = v
    }
    dispose() {}
  },
}))
vi.mock('./paths', () => ({ speechEnginesDir: () => '/engines' }))
vi.mock('./engines/kokoro-setup', () => ({
  kokoroFilesStatus: () => {
    state.calls.push('kokoroFilesStatus')
    return { ready: true }
  },
  prepareKokoro: async () => {
    state.calls.push('prepareKokoro')
    return { prepared: true }
  },
}))
vi.mock('./engines/kokoro-install', () => ({
  KokoroDependencyInstaller: class {
    busy = false
    async install() {
      state.calls.push('installer.install')
    }
    cancel() {
      state.calls.push('installer.cancel')
    }
    async shutdown() {}
  },
}))
vi.mock('./local-stt', () => ({
  localSttStatus: () => {
    state.calls.push('localSttStatus')
    return { model: 'base' }
  },
  sttModelDir: () => '/stt',
  LocalStt: class {
    busy = false
    transcribe() {
      state.calls.push('stt.transcribe')
      return { text: 'hi' }
    }
    cancel() {
      state.calls.push('stt.cancel')
    }
  },
}))
vi.mock('./modelDiagnostics', () => ({
  modelDirFor: () => '/models',
  verifyReviewedSpeechModels: async () => {
    state.calls.push('verifyReviewedSpeechModels')
    return { ready: true, entries: [] }
  },
}))
vi.mock('./microphone-grant', () => ({
  microphoneGrant: {
    begin: (t: string) => state.calls.push(`grant.begin:${t}`),
    approve: () => {
      state.calls.push('grant.approve')
      return true
    },
    revokePending: record('grant.revokePending'),
    revoke: (t: string) => state.calls.push(`grant.revoke:${t}`),
    clear: record('grant.clear'),
  },
}))

const { registerSpeechHandlers } = await import('./handlers')

const handlers = state.registered

function makeOwnerWindow() {
  const contents = {
    id: 11,
    isDestroyed: () => false,
    getURL: () => 'app://workspace',
    send: vi.fn(),
    once: () => {},
    on: () => {},
    removeListener: () => {},
  }
  const frame = { url: 'app://workspace', parent: null }
  const win = {
    isDestroyed: () => false,
    webContents: Object.assign(contents, { mainFrame: frame }),
  }
  return { win, contents, frame }
}

let ownerWin: ReturnType<typeof makeOwnerWindow>

beforeAll(() => {
  registerSpeechHandlers({
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn),
  } as never)
})

beforeEach(() => {
  state.config = {
    trigger: { max_text_length: 500 },
    tts: {
      active_profile_id: 'wos-openai',
      active_backend: 'openai',
      profiles: [{ id: 'wos-openai', engine: 'openai', voice: 'alloy', name: 'OpenAI', voice_label: null, engine_options: {} }],
    },
    hotkey: { enabled: false, shortcut: '' },
    playback: { volume: 1, prefetch_next_fragment: false },
  }
  state.calls = []
  state.dialogResponse = 0
  ownerWin = makeOwnerWindow()
  ;(globalThis as unknown as { __wosOwnerWindow?: unknown }).__wosOwnerWindow = ownerWin.win
})
afterEach(() => {
  ;(globalThis as unknown as { __wosOwnerWindow?: unknown }).__wosOwnerWindow = null
})

function ownerEvent() {
  return { sender: ownerWin.contents, senderFrame: ownerWin.frame }
}

const unauthorized = [
  { kind: 'a missing frame', event: () => ({ sender: ownerWin.contents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: ownerWin.contents, senderFrame: { parent: {} } }) },
  { kind: 'a foreign sender', event: () => ({ sender: { id: 99 }, senderFrame: ownerWin.frame }) },
  {
    kind: 'a foreign main frame',
    event: () => ({ sender: ownerWin.contents, senderFrame: { url: 'app://other', parent: null } }),
  },
]

const channels: { channel: string; args: () => unknown[]; result: unknown }[] = [
  { channel: IPC.SPEECH_REPLY_OPEN, args: () => ['tab-1'], result: null },
  { channel: IPC.SPEECH_REPLY_RESERVE, args: () => ['s1', 'r1'], result: { ok: true } },
  { channel: IPC.SPEECH_REPLY_FINISH, args: () => ['s1', 'r1', 'text'], result: { ok: true } },
  { channel: IPC.SPEECH_REPLY_CLOSE, args: () => ['s1'], result: undefined },
  { channel: IPC.SPEECH_MICROPHONE_AUTHORIZE, args: () => ['tok'], result: false },
  { channel: IPC.SPEECH_MICROPHONE_REVOKE, args: () => ['tok'], result: undefined },
  { channel: IPC.SPEECH_STT_STATUS, args: () => [], result: { model: 'base', busy: false } },
  { channel: IPC.SPEECH_STT_TRANSCRIBE, args: () => [[0.1, 0.2], 'es', 'id-1'], result: { text: 'hi' } },
  { channel: IPC.SPEECH_STT_CANCEL, args: () => ['id-1'], result: undefined },
  { channel: IPC.SPEECH_SPEAK, args: () => ['hola'], result: { readingId: 1 } },
  { channel: IPC.SPEECH_READ_CLIPBOARD, args: () => [], result: { readingId: 1 } },
  { channel: IPC.SPEECH_SET_HOTKEY, args: () => ['CommandOrControl+Shift+Y'], result: { shortcut: 'CommandOrControl+Shift+Y' } },
  { channel: IPC.SPEECH_STOP, args: () => [], result: undefined },
  { channel: IPC.SPEECH_CANCEL_READING, args: () => [1], result: true },
  { channel: IPC.SPEECH_KOKORO_INSTALL_STATUS, args: () => [], result: { busy: false } },
  { channel: IPC.SPEECH_KOKORO_INSTALL_CANCEL, args: () => [], result: undefined },
  { channel: IPC.SPEECH_KOKORO_INSTALL, args: () => [], result: { ready: true } },
  { channel: IPC.SPEECH_KOKORO_STATUS, args: () => [], result: { ready: true } },
  { channel: IPC.SPEECH_MODEL_DIAGNOSTICS, args: () => [], result: { ready: true, entries: [] } },
  { channel: IPC.SPEECH_KOKORO_PREPARE, args: () => [], result: { prepared: true } },
  { channel: IPC.SPEECH_SET_LOOKAHEAD, args: () => [true], result: undefined },
  { channel: IPC.SPEECH_STATUS, args: () => [], result: { speaking: false, engine: 'openai' } },
  {
    channel: IPC.SPEECH_CONFIG,
    args: () => [],
    result: {
      trigger: { max_text_length: 500 },
      tts: {
        active_profile_id: 'wos-openai',
        profiles: [{ id: 'wos-openai', engine: 'openai', voice: 'alloy' }],
      },
      hotkey: { enabled: false, shortcut: '' },
      playback: { prefetch_next_fragment: false },
    },
  },
  { channel: IPC.SPEECH_KEY_STATUS, args: () => [], result: { configured: false } },
  { channel: IPC.SPEECH_SET_KEY, args: () => ['sk-test'], result: { configured: false } },
  { channel: IPC.SPEECH_SELECT_ENGINE, args: () => ['piper', 'en_US-amy'], result: undefined },
  { channel: IPC.SPEECH_PLAYBACK_DONE, args: () => ['play-1', true], result: { ok: true } },
]

describe.each(channels)('$channel', ({ channel, args, result }) => {
  it.each(unauthorized)('refuses $kind without reading the clipboard or a secret', async ({ event }) => {
    // Two layers refuse, and both are the module's own: `assertMainFrame` turns
    // away a missing/child frame, and `assertWorkspace` turns away any top-level
    // frame or sender that is not the window `mainWindow()` reports.
    await expect(handlers.get(channel)!(event(), ...args())).rejects.toThrow(/IPC call rejected|not the workspace window/)
    expect(state.calls.filter((c) => c !== 'mainWindow()')).toEqual([])
  })

  it('admits the registered main window and reaches the engine', async () => {
    const value = await handlers.get(channel)!(ownerEvent(), ...args())
    expect(value).toEqual(result)
    expect(state.calls.filter((c) => c !== 'mainWindow()').length).toBeGreaterThan(0)
  })
})

describe('the guard the module actually uses', () => {
  it('is a thin wrapper over the frame check plus the main-window identity', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./handlers.ts', import.meta.url), 'utf8'))
    // `assertOwner` = documentFor(assertWorkspace(event)) — no second, weaker path.
    expect(source).toMatch(/const assertOwner = \(event: IpcMainInvokeEvent\): SpeechDocument => documentFor\(assertWorkspace\(event\)\)/)
    // `assertWorkspace` calls the shared frame check AND compares sender + frame.
    const block = source.slice(source.indexOf('function assertWorkspace'), source.indexOf('export function registerSpeechHandlers'))
    expect(block).toContain('assertMainFrame(event)')
    expect(block).toContain('event.sender !== win.webContents')
    expect(block).toContain('event.senderFrame !== win.webContents.mainFrame')
  })

  it('is called by all twenty-seven handlers', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./handlers.ts', import.meta.url), 'utf8'))
    const registered = [...source.matchAll(/ipcHandle\(ipc, IPC\.SPEECH_([A-Z_]+)/g)].map((m) => m[1])
    expect(registered).toHaveLength(27)
    for (const name of registered) {
      const at = source.indexOf(`IPC.SPEECH_${name}`)
      const next = source.indexOf('ipcHandle(ipc, IPC.SPEECH_', at + 10)
      const body = source.slice(at, next > 0 ? next : undefined)
      expect(body, `speech:${name} no llama a assertOwner`).toContain('assertOwner(event)')
    }
  })
})
