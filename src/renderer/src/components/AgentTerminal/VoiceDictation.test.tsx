// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceDictation } from './VoiceDictation'
import { microphoneDevices, microphoneConstraints } from './useMicrophoneDevices'

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
  it('lists microphones without capture and requests only the explicitly selected device', async () => {
    const enumerateDevices = vi.fn(async () => [
      { kind: 'audioinput', deviceId: 'usb-mic', label: 'USB microphone' },
      { kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' },
    ])
    Object.assign(navigator.mediaDevices, { enumerateDevices })
    await act(async () => root.render(<VoiceDictation active onTranscript={vi.fn()} />))
    expect(enumerateDevices).not.toHaveBeenCalled()
    await act(async () => { element.querySelectorAll('button')[1].click(); await flush() })
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    expect(speech.authorizeMicrophone).not.toHaveBeenCalled()
    const devices = element.querySelector<HTMLSelectElement>('[aria-label="Dictation microphone"]')!
    expect(devices.options).toHaveLength(2)
    await act(async () => { devices.value = 'usb-mic'; devices.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: { deviceId: { exact: 'usb-mic' }, echoCancellation: true, noiseSuppression: true }, video: false })
    expect(devices.disabled).toBe(true)
  })
  it('does not fall back to another microphone when the selected device fails', async () => {
    Object.assign(navigator.mediaDevices, { enumerateDevices: vi.fn(async () => [{ kind: 'audioinput', deviceId: 'usb-mic', label: '' }]) })
    await act(async () => root.render(<VoiceDictation active onTranscript={vi.fn()} />))
    await act(async () => { element.querySelectorAll('button')[1].click(); await flush() })
    const select = element.querySelector<HTMLSelectElement>('[aria-label="Dictation microphone"]')!
    await act(async () => { select.value = 'usb-mic'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(new Error('Selected microphone unavailable'))
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
    expect(element.textContent).toContain('Selected microphone unavailable')
    expect(speech.transcribeLocal).not.toHaveBeenCalled()
    expect(speech.revokeMicrophone).toHaveBeenCalledWith(speech.authorizeMicrophone.mock.calls[0][0])
  })
  it('refreshes an opened list on device change without silently changing the selection', async () => {
    const changes = new EventTarget()
    const enumerateDevices = vi.fn(async () => [{ kind: 'audioinput', deviceId: 'usb-mic', label: 'USB microphone' }])
    Object.assign(navigator.mediaDevices, {
      enumerateDevices,
      addEventListener: changes.addEventListener.bind(changes),
      removeEventListener: changes.removeEventListener.bind(changes),
    })
    await act(async () => root.render(<VoiceDictation active onTranscript={vi.fn()} />))
    await act(async () => { changes.dispatchEvent(new Event('devicechange')); await flush() })
    expect(enumerateDevices).not.toHaveBeenCalled()
    await act(async () => { element.querySelectorAll('button')[1].click(); await flush() })
    const select = element.querySelector<HTMLSelectElement>('[aria-label="Dictation microphone"]')!
    await act(async () => { select.value = 'usb-mic'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    enumerateDevices.mockResolvedValue([])
    await act(async () => { changes.dispatchEvent(new Event('devicechange')); await flush() })
    expect(enumerateDevices).toHaveBeenCalledTimes(2)
    expect(select.value).toBe('usb-mic')
    expect(select.textContent).toContain('no listado')
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  })
  it('ignores a late enumeration when the tab becomes inactive', async () => {
    let resolve!: (devices: unknown[]) => void
    Object.assign(navigator.mediaDevices, { enumerateDevices: vi.fn(() => new Promise((done) => { resolve = done })) })
    await act(async () => root.render(<VoiceDictation active onTranscript={vi.fn()} />))
    await act(async () => { element.querySelectorAll('button')[1].click(); await flush() })
    await act(async () => root.render(<VoiceDictation active={false} onTranscript={vi.fn()} />))
    await act(async () => { resolve([{ kind: 'audioinput', deviceId: 'old', label: 'Stale microphone' }]); await flush() })
    expect(element.textContent).not.toContain('Stale microphone')
  })
  it('ignores saved stop callbacks from a discarded recording', async () => {
    await act(async () => root.render(<VoiceDictation active onTranscript={vi.fn()} />))
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    const lateStop = recorder.onstop!
    await act(async () => { element.querySelectorAll('button')[1].click(); await flush() })
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    const nextRecorder = recorder
    await act(async () => { lateStop(); await flush() })
    expect(nextRecorder.state).toBe('recording')
    expect(speech.transcribeLocal).not.toHaveBeenCalled()
    expect(element.textContent).toContain('Detener grabación')
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
  it('closes decode audio promptly on cancel and ignores late decode results', async () => {
    let finishDecode!: (value: { duration: number }) => void
    const close = vi.fn(async () => {})
    vi.stubGlobal('AudioContext', class {
      close = close
      decodeAudioData = vi.fn(() => new Promise<{ duration: number }>((resolve) => { finishDecode = resolve }))
    })
    const transcript = vi.fn()
    await act(async () => root.render(<VoiceDictation active onTranscript={transcript} />))
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    expect(close).not.toHaveBeenCalled()
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    expect(close).toHaveBeenCalledOnce()
    await act(async () => { finishDecode({ duration: 1 }); await flush() })
    expect(close).toHaveBeenCalledOnce()
    expect(speech.transcribeLocal).not.toHaveBeenCalled()
    expect(transcript).not.toHaveBeenCalled()
  })
  it('a stale decode completion cannot close a newer decode context', async () => {
    const resolves: Array<(value: { duration: number }) => void> = []
    const closes: Array<ReturnType<typeof vi.fn>> = []
    vi.stubGlobal('AudioContext', class {
      close = vi.fn(async () => {})
      constructor() { closes.push(this.close) }
      decodeAudioData = vi.fn(() => new Promise<{ duration: number }>((resolve) => { resolves.push(resolve) }))
    })
    await act(async () => root.render(<VoiceDictation active onTranscript={vi.fn()} />))
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    expect(closes).toHaveLength(2)
    await act(async () => { resolves[0]({ duration: 1 }); await flush() })
    expect(closes[0]).toHaveBeenCalledOnce()
    expect(closes[1]).not.toHaveBeenCalled()
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    expect(closes[1]).toHaveBeenCalledOnce()
    await act(async () => { resolves[1]({ duration: 1 }); await flush() })
    expect(speech.transcribeLocal).not.toHaveBeenCalled()
  })
  it('closes the decode context before waiting for transcription', async () => {
    const close = vi.fn(async () => {})
    vi.stubGlobal('AudioContext', class { close = close; decodeAudioData = vi.fn(async () => ({ duration: 1 })) })
    speech.transcribeLocal.mockReturnValue(new Promise(() => {}))
    await act(async () => root.render(<VoiceDictation active onTranscript={vi.fn()} />))
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    expect(close).toHaveBeenCalledOnce()
    expect(speech.transcribeLocal).toHaveBeenCalledOnce()
    await act(async () => { element.querySelector('button')!.click(); await flush() })
    expect(close).toHaveBeenCalledOnce()
    expect(speech.cancelTranscription).toHaveBeenCalledOnce()
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


describe('microphone metadata limits', () => {
  it('filters outputs, empty IDs, duplicate IDs and bounds labels/list size', () => {
    const inputs = Array.from({ length: 110 }, (_, i) => ({ kind: 'audioinput', deviceId: String(i), label: 'x'.repeat(300) }))
    const result = microphoneDevices([{ kind: 'audiooutput', deviceId: 'out', label: '' }, { kind: 'audioinput', deviceId: '', label: '' }, inputs[0], ...inputs] as MediaDeviceInfo[])
    expect(result).toHaveLength(100)
    expect(new Set(result.map(({ id }) => id)).size).toBe(100)
    expect(result[0].label).toHaveLength(256)
    expect(microphoneConstraints('')).toEqual({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
  })
})
