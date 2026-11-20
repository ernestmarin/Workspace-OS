// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceDictation } from './VoiceDictation'

let recorder: FakeRecorder
class FakeRecorder {
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() { recorder = this }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['audio']) })
    this.onstop?.()
  }
}
class FakeAudioContext {
  close = vi.fn(async () => {})
  decodeAudioData = vi.fn(async () => ({ duration: 1 }))
}
class FakeOfflineAudioContext {
  destination = {}
  createBufferSource() { return { buffer: null, connect: vi.fn(), start: vi.fn() } }
  async startRendering() { return { getChannelData: () => new Float32Array(16_000) } }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
let element: HTMLDivElement
let root: Root
let track: EventTarget & { stop: ReturnType<typeof vi.fn> }
let speech: any
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  element = document.createElement('div'); document.body.appendChild(element)
  root = createRoot(element)
  track = Object.assign(new EventTarget(), { stop: vi.fn() })
  speech = { sttStatus: vi.fn(async () => ({ filesPresent: true, busy: false, modelDir: '/model' })), authorizeMicrophone: vi.fn(async () => true), revokeMicrophone: vi.fn(async () => {}), transcribeLocal: vi.fn(async () => 'Hola mundo'), cancelTranscription: vi.fn(async () => {}) }
  Object.defineProperty(window, 'workspace', { configurable: true, value: { speech } })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } })
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext)
  // jsdom Blob lacks arrayBuffer in some versions.
  Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, value: vi.fn(async () => new ArrayBuffer(1)) })
})
afterEach(async () => {
  await act(async () => root.unmount())
  element.remove()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('local dictation interaction', () => {
  it('requests consent, stops tracks and returns transcription for review', async () => {
    const transcript = vi.fn()
    await act(async () => { root.render(<VoiceDictation active onTranscript={transcript} />) })
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    expect(speech.authorizeMicrophone).toHaveBeenCalledOnce()
    expect(element.textContent).toContain('Detener grabación')
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    expect(track.stop).toHaveBeenCalled()
    expect(speech.transcribeLocal).toHaveBeenCalledWith(expect.any(Float32Array), 'es', expect.any(String))
    expect(transcript).toHaveBeenCalledExactlyOnceWith('Hola mundo')
    expect(element.textContent).toContain('Dictar localmente')
  })
  it('discards recording on microphone disconnect instead of transcribing partial audio', async () => {
    const transcript = vi.fn()
    await act(async () => root.render(<VoiceDictation active onTranscript={transcript} />))
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    await act(async () => { track.dispatchEvent(new Event('ended')); await flush() })
    expect(track.stop).toHaveBeenCalled()
    expect(element.textContent).toContain('Microphone disconnected')
    expect(speech.transcribeLocal).not.toHaveBeenCalled()
    expect(transcript).not.toHaveBeenCalled()
  })
  it('stops capture on page hide and detaches track listeners', async () => {
    await act(async () => root.render(<VoiceDictation active onTranscript={vi.fn()} />))
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    await act(async () => { window.dispatchEvent(new Event('pagehide')); await flush() })
    expect(track.stop).toHaveBeenCalled()
    expect(speech.transcribeLocal).not.toHaveBeenCalled()
    await act(async () => { track.dispatchEvent(new Event('ended')); await flush() })
    expect(element.textContent).not.toContain('Microphone disconnected')
  })
  it('cancels only its job and ignores a late transcription result', async () => {
    let finish!: (text: string) => void
    speech.transcribeLocal.mockReturnValue(new Promise<string>((resolve) => { finish = resolve }))
    const transcript = vi.fn()
    await act(async () => root.render(<VoiceDictation active onTranscript={transcript} />))
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    const job = speech.transcribeLocal.mock.calls[0][2]
    await act(async () => root.render(<VoiceDictation active={false} onTranscript={transcript} />))
    expect(speech.cancelTranscription).toHaveBeenCalledExactlyOnceWith(job)
    await act(async () => { finish('late'); await flush() })
    expect(transcript).not.toHaveBeenCalled()
  })
  it('selects Hebrew transcription, scopes RTL to dictation, and locks language during recording', async () => {
    const transcript = vi.fn()
    await act(async () => root.render(<VoiceDictation active onTranscript={transcript} />))
    const select = element.querySelector('select')!
    expect(select.options).toHaveLength(9)
    await act(async () => { select.value = 'he'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(element.firstElementChild?.getAttribute('dir')).toBe('rtl')
    expect(document.documentElement.getAttribute('dir')).toBeNull()
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    expect(select.disabled).toBe(true)
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    expect(speech.transcribeLocal).toHaveBeenCalledWith(expect.any(Float32Array), 'he', expect.any(String))
    const token = speech.authorizeMicrophone.mock.calls[0][0]
    expect(token).toMatch(/^[0-9a-f-]{36}$/)
    expect(speech.revokeMicrophone).toHaveBeenCalledWith(token)
    expect(select.disabled).toBe(false)
  })
  it('does not revoke another tab permission when mounted inactive', async () => {
    await act(async () => root.render(<VoiceDictation active={false} onTranscript={vi.fn()} />))
    expect(speech.revokeMicrophone).not.toHaveBeenCalled()
  })
  it('rejects missing model before requesting the microphone', async () => {
    speech.sttStatus.mockResolvedValue({ filesPresent: false, busy: false, modelDir: '/models/whisper' })
    await act(async () => root.render(<VoiceDictation active onTranscript={vi.fn()} />))
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    expect(element.textContent).toContain('/models/whisper')
    expect(speech.authorizeMicrophone).not.toHaveBeenCalled()
  })
  it('stops recording and discards audio on tab switch', async () => {
    const transcript = vi.fn()
    await act(async () => root.render(<VoiceDictation active onTranscript={transcript} />))
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    expect(recorder.state).toBe('recording')
    await act(async () => root.render(<VoiceDictation active={false} onTranscript={transcript} />))
    expect(track.stop).toHaveBeenCalled()
    expect(recorder.state).toBe('inactive')
    expect(speech.transcribeLocal).not.toHaveBeenCalled()
    expect(transcript).not.toHaveBeenCalled()
  })
  it('does not start microphone capture after the tab becomes inactive during consent', async () => {
    let approve!: (v: boolean) => void
    speech.authorizeMicrophone.mockReturnValue(new Promise<boolean>((resolve) => { approve = resolve }))
    const transcript = vi.fn()
    await act(async () => root.render(<VoiceDictation active onTranscript={transcript} />))
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    await act(async () => root.render(<VoiceDictation active={false} onTranscript={transcript} />))
    await act(async () => { approve(true); await flush() })
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    expect(speech.revokeMicrophone).toHaveBeenCalled()
    expect(transcript).not.toHaveBeenCalled()
  })
})
