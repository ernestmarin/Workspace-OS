import { app, clipboard, dialog, globalShortcut, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { defaultKokoroProfile } from '../../shared/speech/defaults'
import type { VoiceProfile } from '../../shared/speech/types'
import { mainWindow, sendToWindow } from '../main-window'
import { ipcHandle, registerCleanup } from '../ipc-registry'
import { IPC } from '../ipc-channels'
import { assertMainFrame } from '../security'
import { getConfig, updateConfig } from './speech-config'
import { speechKeyStatus, setSpeechKey } from './secrets'
import { synthesizeFragment } from './engines'
import { PlaybackBroker } from './playback'
import { ReadingController } from './reading'
import { VoiceHotkey } from './hotkey'
import { speechEnginesDir } from './paths'
import { kokoroFilesStatus, prepareKokoro } from './engines/kokoro-setup'
import { KokoroDependencyInstaller } from './engines/kokoro-install'
import { LocalStt, localSttStatus } from './local-stt'
import { microphoneGrant } from './microphone-grant'

function assertOwner(event: IpcMainInvokeEvent): void {
  assertMainFrame(event)
  if (!event.senderFrame || mainWindow()?.webContents.id !== event.sender.id) throw new Error('Speech IPC rejected: not the workspace window')
}

export function registerSpeechHandlers(ipc: IpcMain): void {
  const installer = new KokoroDependencyInstaller()
  const stt = new LocalStt()
  let microphonePromptOpen = false
  const broker = new PlaybackBroker((owner, message) => {
    const win = mainWindow()
    if (!win || win.webContents.id !== owner) throw new Error('Playback window is unavailable')
    win.webContents.send(IPC.SPEECH_PLAYBACK, message)
  })
  const controller = new ReadingController({
    synthesize: synthesizeFragment,
    play: (audio, text, signal, config) => {
      const win = mainWindow()
      if (!win) throw new Error('Playback window is unavailable')
      const owner = win.webContents.id
      const closed = (): void => broker.closeOwner(owner)
      win.webContents.once('destroyed', closed)
      return broker.play(owner, audio, text, config.playback.volume, signal).finally(() => win.webContents.removeListener('destroyed', closed))
    },
    onStatus: (status) => sendToWindow(IPC.SPEECH_EVENT, { type: 'state', status }),
  })
  const start = (text: string): { readingId: number } => {
    const config = getConfig()
    const engine = config.tts.profiles.find((profile) => profile.id === config.tts.active_profile_id)?.engine ?? config.tts.active_backend
    if (installer.busy && engine === 'kokoro') throw new Error('Wait for Kokoro dependency setup to finish before speaking')
    const reading = controller.read(text, config)
    void reading.result.then((result) => sendToWindow(IPC.SPEECH_EVENT, { type: 'result', readingId: reading.id, result }))
    return { readingId: reading.id }
  }
  const startClipboard = (): { readingId: number } => start(clipboard.readText())
  const hotkey = new VoiceHotkey(globalShortcut, () => {
    try {
      // Don't read or transmit clipboard text while no workspace window is open.
      if (mainWindow()) startClipboard()
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
  ipcHandle(ipc, IPC.SPEECH_MICROPHONE_AUTHORIZE, async (event) => {
    assertOwner(event)
    if (microphonePromptOpen) throw new Error('A microphone permission request is already open')
    const win = mainWindow()
    if (!win) throw new Error('Workspace window is unavailable')
    const owner = event.sender.id
    const frame = event.senderFrame
    if (!frame) throw new Error('Workspace frame is unavailable')
    const url = frame.url
    microphonePromptOpen = true
    microphoneGrant.clear()
    try {
      const result = await dialog.showMessageBox(win, {
        type: 'question', buttons: ['Cancel', 'Allow once'], defaultId: 0, cancelId: 0, noLink: true,
        title: 'Microphone access',
        message: 'Allow Workspace OS to use your microphone for this recording?',
        detail: 'Audio is intended for local transcription. The agent or voice engine you select may still use an external service. Microphone access ends when recording stops.',
      })
      if (result.response !== 1) return false
      assertOwner(event)
      if (win.isDestroyed() || mainWindow() !== win || event.sender.id !== owner || event.senderFrame !== frame || frame.url !== url || event.sender.getURL() !== url) throw new Error('Workspace window changed during microphone approval')
      microphoneGrant.arm(owner, url)
      return true
    } finally { microphonePromptOpen = false }
  })
  ipcHandle(ipc, IPC.SPEECH_STT_STATUS, (event) => { assertOwner(event); return { ...localSttStatus(), busy: stt.busy } })
  ipcHandle(ipc, IPC.SPEECH_STT_TRANSCRIBE, (event, samples, language) => { assertOwner(event); return stt.transcribe(samples, language) })
  ipcHandle(ipc, IPC.SPEECH_STT_CANCEL, (event) => { assertOwner(event); stt.cancel() })
  ipcHandle(ipc, IPC.SPEECH_SPEAK, (event, text) => {
    assertOwner(event)
    if (typeof text !== 'string') throw new Error('Speech text must be a string')
    return start(text)
  })
  ipcHandle(ipc, IPC.SPEECH_READ_CLIPBOARD, (event) => { assertOwner(event); return startClipboard() })
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
  ipcHandle(ipc, IPC.SPEECH_STOP, (event) => { assertOwner(event); controller.stop() })
  ipcHandle(ipc, IPC.SPEECH_KOKORO_INSTALL_STATUS, (event) => { assertOwner(event); return { busy: installer.busy } })
  ipcHandle(ipc, IPC.SPEECH_KOKORO_INSTALL_CANCEL, (event) => { assertOwner(event); installer.cancel() })
  ipcHandle(ipc, IPC.SPEECH_KOKORO_INSTALL, async (event) => { assertOwner(event); await installer.install(speechEnginesDir()); return kokoroFilesStatus(speechEnginesDir()) })
  ipcHandle(ipc, IPC.SPEECH_KOKORO_STATUS, (event) => { assertOwner(event); return kokoroFilesStatus(speechEnginesDir()) })
  ipcHandle(ipc, IPC.SPEECH_KOKORO_PREPARE, (event) => {
    assertOwner(event)
    const resources = app.isPackaged ? path.join(process.resourcesPath, 'voice-kokoro') : path.join(app.getAppPath(), 'resources', 'voice-kokoro')
    return prepareKokoro(speechEnginesDir(), resources)
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
    if (engine !== 'openai' && engine !== 'kokoro') throw new Error('Unsupported speech engine')
    if (typeof voice !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(voice)) throw new Error('Invalid voice')
    const cfg = getConfig()
    const id = `wos-${engine}`
    const profile: VoiceProfile = { ...defaultKokoroProfile(), id, name: engine === 'openai' ? 'OpenAI' : 'Kokoro', engine, voice, voice_label: null, engine_options: {} }
    const profiles = [...cfg.tts.profiles.filter((p) => p.id !== id), profile]
    updateConfig({ tts: { ...cfg.tts, profiles, active_profile_id: id, active_backend: engine } })
  })
  ipcHandle(ipc, IPC.SPEECH_PLAYBACK_DONE, (event, id, ok) => {
    assertOwner(event)
    if (typeof id !== 'string' || typeof ok !== 'boolean') throw new Error('Invalid playback result')
    return broker.complete(event.sender.id, id, ok)
  })
  registerCleanup('speech', async () => { hotkey.dispose(); controller.stop(); stt.cancel(); microphoneGrant.clear(); await installer.shutdown() })
}
