import { app, clipboard, dialog, globalShortcut, type IpcMain, type IpcMainInvokeEvent, type BrowserWindow, type WebContents } from 'electron'
import path from 'node:path'
import { defaultKokoroProfile } from '../../shared/speech/defaults'
import type { AppConfig, VoiceProfile } from '../../shared/speech/types'
import { mainWindow, sendToWindow } from '../main-window'
import { ipcHandle, registerCleanup } from '../ipc-registry'
import { IPC } from '../ipc-channels'
import { assertMainFrame } from '../security'
import { getConfig, updateConfig } from './speech-config'
import { speechKeyStatus, setSpeechKey } from './secrets'
import { synthesizeFragment } from './engines'
import { PlaybackBroker } from './playback'
import { ReadingController } from './reading'
import { ReplyReadingSessions, replyDestination } from './replies'
import { VoiceHotkey } from './hotkey'
import { speechEnginesDir } from './paths'
import { kokoroFilesStatus, prepareKokoro } from './engines/kokoro-setup'
import { KokoroDependencyInstaller } from './engines/kokoro-install'
import { LocalStt, localSttStatus, sttModelDir } from './local-stt'
import { modelDirFor, verifyReviewedSpeechModels } from './modelDiagnostics'
import { microphoneGrant } from './microphone-grant'

interface SpeechDocument {
  window: BrowserWindow
  contents: WebContents
  active: boolean
  invalidate(): void
}

function assertWorkspace(event: IpcMainInvokeEvent): BrowserWindow {
  assertMainFrame(event)
  const win = mainWindow()
  if (!win || win.webContents.isDestroyed() || event.sender !== win.webContents ||
      !event.senderFrame || event.senderFrame !== win.webContents.mainFrame) {
    throw new Error('Speech IPC rejected: not the workspace window/main frame')
  }
  return win
}

export function registerSpeechHandlers(ipc: IpcMain): void {
  const installer = new KokoroDependencyInstaller()
  const stt = new LocalStt()
  let microphonePromptOpen = false
  let document: SpeechDocument | undefined
  const send = (scope: SpeechDocument | undefined, channel: string, message: unknown): void => {
    if (!scope?.active || mainWindow() !== scope.window || scope.contents.isDestroyed()) return
    try { scope.contents.send(channel, message) } catch { /* raced with teardown */ }
  }
  const broker = new PlaybackBroker((owner, message) => {
    const contents = document?.contents
    if (!contents || contents.id !== owner || contents.isDestroyed()) throw new Error('Playback window is unavailable')
    contents.send(IPC.SPEECH_PLAYBACK, message)
  })
  const assertEngineAvailable = (config: AppConfig): void => {
    const engine = config.tts.profiles.find((profile) => profile.id === config.tts.active_profile_id)?.engine ?? config.tts.active_backend
    if (installer.busy && engine === 'kokoro') throw new Error('Wait for Kokoro dependency setup to finish before speaking')
  }
  const controller = new ReadingController<SpeechDocument>({
    synthesize: (text, config, signal) => { assertEngineAvailable(config); return synthesizeFragment(text, config, signal) },
    play: (audio, text, signal, config, scope) => {
      if (!scope?.active || mainWindow() !== scope.window || scope.contents.isDestroyed()) throw new Error('Playback document is unavailable')
      return broker.play(scope.contents.id, audio, text, config.playback.volume, signal)
    },
    onStatus: (status, scope) => send(scope, IPC.SPEECH_EVENT, { type: 'state', status }),
  })
  const enqueue = (text: string, config: AppConfig, scope: SpeechDocument) => {
    if (!scope.active || mainWindow() !== scope.window || scope.contents.isDestroyed()) throw new Error('Speech document is unavailable')
    assertEngineAvailable(config)
    const reading = controller.read(text, config, scope)
    void reading.result.then((result) => send(scope, IPC.SPEECH_EVENT, { type: 'result', readingId: reading.id, result }))
    return reading
  }
  const replies = new ReplyReadingSessions<SpeechDocument>({ enqueue, cancel: (id) => controller.cancel(id) })
  let replyPromptOpen = false
  // Bind all pending work to the document that authorized it, not whichever
  // window happens to be current after synthesis or a native prompt resolves.
  const documentFor = (win: BrowserWindow): SpeechDocument => {
    if (document?.active && document.window === win) return document
    document?.invalidate()
    const contents = win.webContents
    const scope: SpeechDocument = { window: win, contents, active: true, invalidate: () => {
      if (!scope.active) return
      scope.active = false
      contents.removeListener('destroyed', scope.invalidate)
      contents.removeListener('render-process-gone', scope.invalidate)
      contents.removeListener('did-start-navigation', navigation)
      replies.closeContext(scope)
      controller.stop()
      broker.closeOwner(contents.id)
      stt.cancel()
      microphoneGrant.clear()
      installer.cancel()
    } }
    const navigation = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => {
      if (details.isMainFrame && !details.isSameDocument) scope.invalidate()
    }
    contents.once('destroyed', scope.invalidate)
    contents.once('render-process-gone', scope.invalidate)
    contents.on('did-start-navigation', navigation)
    document = scope
    return scope
  }
  const assertOwner = (event: IpcMainInvokeEvent): SpeechDocument => documentFor(assertWorkspace(event))
  const start = (text: string, scope: SpeechDocument): { readingId: number } => {
    const reading = enqueue(text, getConfig(), scope)
    return { readingId: reading.id }
  }
  const startClipboard = (scope: SpeechDocument): { readingId: number } => start(clipboard.readText(), scope)
  const hotkey = new VoiceHotkey(globalShortcut, () => {
    try {
      // Don't read or transmit clipboard text while no workspace window is open.
      const win = mainWindow()
      if (win) startClipboard(documentFor(win))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read clipboard'
      sendToWindow(IPC.SPEECH_EVENT, { type: 'error', message })
    }
  })
  try {
    const cfg = getConfig()
    if (cfg.hotkey.enabled) hotkey.set(cfg.hotkey.shortcut)
  } catch (error) {
    // An unavailable shortcut must not prevent the rest of the app from starting.
    console.warn('[speech] could not initialize voice shortcut:', error instanceof Error ? error.message : 'unknown error')
  }
  ipcHandle(ipc, IPC.SPEECH_REPLY_OPEN, async (event, tabId) => {
    const scope = assertOwner(event)
    if (typeof tabId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(tabId)) throw new Error('Invalid reply reading identity')
    if (replyPromptOpen) throw new Error('A reply reading permission request is already open')
    const config = structuredClone(getConfig())
    const destination = replyDestination(config)
    replyPromptOpen = true
    try {
      const result = await dialog.showMessageBox(scope.window, {
        type: 'question', buttons: ['Cancel', 'Read replies'], defaultId: 0, cancelId: 0, noLink: true,
        title: 'Agent reply reading', message: 'Read future completed agent replies aloud in this tab?',
        detail: `Engine: ${destination.engine}. Voice: ${destination.voice}. ` +
          (destination.remote ? 'Reply text will be sent to OpenAI. ' : 'This uses the configured local command; its network access is not sandboxed. ') +
          'This engine, voice and playback configuration stay fixed until you turn reply reading off and on again. ' +
          'Only successfully completed prompt runs are read. Turning this off or leaving the tab stops its pending and playing replies, not agent actions or unrelated readings. No microphone is enabled.',
      })
      if (result.response !== 1 || !scope.active) return null
      if (assertOwner(event) !== scope) throw new Error('Reply reading document changed during approval')
      return replies.open(scope, tabId, config)
    } finally { replyPromptOpen = false }
  })
  ipcHandle(ipc, IPC.SPEECH_REPLY_RESERVE, (event, sessionId, runId) => replies.reserve(assertOwner(event), sessionId, runId))
  ipcHandle(ipc, IPC.SPEECH_REPLY_FINISH, (event, sessionId, replyId, text) => replies.finish(assertOwner(event), sessionId, replyId, text))
  ipcHandle(ipc, IPC.SPEECH_REPLY_CLOSE, (event, sessionId) => replies.close(assertOwner(event), sessionId))
  ipcHandle(ipc, IPC.SPEECH_MICROPHONE_AUTHORIZE, async (event, token) => {
    const scope = assertOwner(event)
    if (microphonePromptOpen) throw new Error('A microphone permission request is already open')
    const win = mainWindow()
    if (!win) throw new Error('Workspace window is unavailable')
    const owner = event.sender.id
    const frame = event.senderFrame
    if (!frame) throw new Error('Workspace frame is unavailable')
    const url = frame.url
    if (typeof token !== 'string') throw new Error('Invalid microphone request identity')
    microphoneGrant.begin(token)
    microphonePromptOpen = true
    try {
      const result = await dialog.showMessageBox(win, {
        type: 'question', buttons: ['Cancel', 'Allow once'], defaultId: 0, cancelId: 0, noLink: true,
        title: 'Microphone access',
        message: 'Allow Workspace OS to use your microphone for this recording?',
        detail: 'Audio is intended for local transcription. The agent or voice engine you select may still use an external service. Microphone access ends when recording stops.',
      })
      if (result.response !== 1) return false
      if (!scope.active) throw new Error('Workspace document changed during microphone approval')
      assertOwner(event)
      if (win.isDestroyed() || mainWindow() !== win || event.sender.id !== owner || event.senderFrame !== frame || frame.url !== url || event.sender.getURL() !== url) throw new Error('Workspace window changed during microphone approval')
      return microphoneGrant.approve(token, owner, url)
    } finally { microphoneGrant.revokePending(token); microphonePromptOpen = false }
  })
  ipcHandle(ipc, IPC.SPEECH_MICROPHONE_REVOKE, (event, token) => { assertOwner(event); microphoneGrant.revoke(token) })
  ipcHandle(ipc, IPC.SPEECH_STT_STATUS, (event) => { assertOwner(event); return { ...localSttStatus(), busy: stt.busy } })
  ipcHandle(ipc, IPC.SPEECH_STT_TRANSCRIBE, (event, samples, language, id) => {
    assertOwner(event)
    if (typeof id !== 'string') throw new Error('Invalid transcription identity')
    return stt.transcribe(samples, language, id)
  })
  ipcHandle(ipc, IPC.SPEECH_STT_CANCEL, (event, id) => { assertOwner(event); if (typeof id === 'string') stt.cancel(id) })
  ipcHandle(ipc, IPC.SPEECH_SPEAK, (event, text) => {
    const scope = assertOwner(event)
    if (typeof text !== 'string') throw new Error('Speech text must be a string')
    return start(text, scope)
  })
  ipcHandle(ipc, IPC.SPEECH_READ_CLIPBOARD, (event) => startClipboard(assertOwner(event)))
  ipcHandle(ipc, IPC.SPEECH_SET_HOTKEY, (event, value) => {
    assertOwner(event)
    if (typeof value !== 'string' || value.length > 128) throw new Error('Invalid shortcut')
    const previous = hotkey.shortcut
    hotkey.set(value)
    try {
      updateConfig({ hotkey: { enabled: !!hotkey.shortcut, shortcut: hotkey.shortcut } })
    } catch (error) {
      // Restore the previous registration if persistence failed.
      try { hotkey.set(previous) } catch { /* surfaced by the original failure */ }
      throw error
    }
    return { shortcut: hotkey.shortcut }
  })
  ipcHandle(ipc, IPC.SPEECH_STOP, (event) => { assertOwner(event); replies.stopWork(); controller.stop() })
  ipcHandle(ipc, IPC.SPEECH_CANCEL_READING, (event, id) => {
    assertOwner(event)
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) throw new Error('Invalid reading identity')
    return controller.cancel(id)
  })
  ipcHandle(ipc, IPC.SPEECH_KOKORO_INSTALL_STATUS, (event) => { assertOwner(event); return { busy: installer.busy } })
  ipcHandle(ipc, IPC.SPEECH_KOKORO_INSTALL_CANCEL, (event) => { assertOwner(event); installer.cancel() })
  ipcHandle(ipc, IPC.SPEECH_KOKORO_INSTALL, async (event) => {
    assertOwner(event)
    const status = controller.getStatus()
    if (status.speaking && status.engine === 'kokoro') throw new Error('Stop Kokoro readings before changing their Python dependencies')
    await installer.install(speechEnginesDir())
    return kokoroFilesStatus(speechEnginesDir())
  })
  ipcHandle(ipc, IPC.SPEECH_KOKORO_STATUS, (event) => { assertOwner(event); return kokoroFilesStatus(speechEnginesDir()) })
  /*
   * VOX-A4c: artifact-level model integrity.
   *
   * `SPEECH_KOKORO_STATUS` and `SPEECH_STT_STATUS` answer "are the files
   * there?", which the settings UI rendered as a green light. A file being
   * present is not readiness: nothing is downloaded here, several reviewed
   * models carry no pinned hash, and a provider-supplied weight file can be
   * replaced without any visible symptom. This reports the honest state and a
   * non-destructive recovery step; `ready` is true only for a full SHA-256
   * match against every reviewed artifact.
   */
  ipcHandle(ipc, IPC.SPEECH_MODEL_DIAGNOSTICS, async (event) => {
    assertOwner(event)
    return verifyReviewedSpeechModels((entry) =>
      modelDirFor(entry, speechEnginesDir(), sttModelDir()),
    )
  })
  ipcHandle(ipc, IPC.SPEECH_KOKORO_PREPARE, (event) => {
    assertOwner(event)
    const resources = app.isPackaged ? path.join(process.resourcesPath, 'voice-kokoro') : path.join(app.getAppPath(), 'resources', 'voice-kokoro')
    return prepareKokoro(speechEnginesDir(), resources)
  })
  ipcHandle(ipc, IPC.SPEECH_SET_LOOKAHEAD, (event, enabled) => {
    assertOwner(event)
    if (typeof enabled !== 'boolean') throw new Error('Invalid speech lookahead setting')
    const cfg = getConfig()
    updateConfig({ playback: { ...cfg.playback, prefetch_next_fragment: enabled } })
  })
  ipcHandle(ipc, IPC.SPEECH_STATUS, (event) => { assertOwner(event); return controller.getStatus() })
  ipcHandle(ipc, IPC.SPEECH_CONFIG, (event) => {
    assertOwner(event)
    const cfg = getConfig()
    // Only expose the fields the UI needs, not arbitrary commands, URLs or headers.
    return {
      trigger: { max_text_length: cfg.trigger.max_text_length },
      tts: { active_profile_id: cfg.tts.active_profile_id, profiles: cfg.tts.profiles.map(({ id, engine, voice }) => ({ id, engine, voice })) },
      hotkey: cfg.hotkey,
      playback: { prefetch_next_fragment: cfg.playback.prefetch_next_fragment },
    }
  })
  ipcHandle(ipc, IPC.SPEECH_KEY_STATUS, (event) => { assertOwner(event); return speechKeyStatus() })
  ipcHandle(ipc, IPC.SPEECH_SET_KEY, (event, value) => {
    assertOwner(event)
    if (typeof value !== 'string' || value.length > 8192) throw new Error('Invalid API key')
    setSpeechKey('SPEECH_OPENAI_API_KEY', value)
    return speechKeyStatus()
  })
  // A narrow, non-executable selection API: never expose arbitrary CLI config via IPC.
  ipcHandle(ipc, IPC.SPEECH_SELECT_ENGINE, (event, engine, voice) => {
    assertOwner(event)
    if (engine !== 'openai' && engine !== 'kokoro' && engine !== 'piper') throw new Error('Unsupported speech engine')
    if (typeof voice !== 'string' || !/^[a-zA-Z0-9._-]{1,64}$/.test(voice) || voice.includes('..')) throw new Error('Invalid voice')
    const cfg = getConfig()
    const id = `wos-${engine}`
    const name = engine === 'openai' ? 'OpenAI' : engine === 'piper' ? 'Piper' : 'Kokoro'
    const profile: VoiceProfile = { ...defaultKokoroProfile(), id, name, engine, voice, voice_label: null, engine_options: {} }
    const profiles = [...cfg.tts.profiles.filter((p) => p.id !== id), profile]
    updateConfig({ tts: { ...cfg.tts, profiles, active_profile_id: id, active_backend: engine } })
  })
  ipcHandle(ipc, IPC.SPEECH_PLAYBACK_DONE, (event, id, ok) => {
    assertOwner(event)
    if (typeof id !== 'string' || typeof ok !== 'boolean') throw new Error('Invalid playback result')
    return broker.complete(event.sender.id, id, ok)
  })
  registerCleanup('speech', async () => { document?.invalidate(); replies.closeAll(); hotkey.dispose(); controller.stop(); stt.cancel(); microphoneGrant.clear(); await installer.shutdown() })
}
