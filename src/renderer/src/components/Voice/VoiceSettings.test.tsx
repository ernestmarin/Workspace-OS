// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceSettings } from './VoiceSettings'

let root: Root
let element: HTMLDivElement
let speech: any
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve() }

/**
 * The honest shape of today's report: every reviewed model carries no pinned
 * checksum, so the best any of them can reach is "files present, not verified".
 * A UI that renders that as ready is the defect this covers.
 */
const report = (): unknown => ({
  manifestVersion: 1,
  checkedAt: '2026-11-20T10:00:00.000Z',
  models: [
    {
      id: 'kokoro-v1.0-en', label: 'Kokoro 82M English', role: 'tts', license: 'apache-2.0',
      notes: '', modelDir: '/models/kokoro-v1.0-en', readiness: 'unverified_files_present',
      counts: { artifacts: 2, present: 2, verified: 0, unverified: 2, corrupt: 0, missing: 0, invalid: 0 },
      artifacts: [], ready: false,
      recovery: [{ code: 'provision-files', message: 'Files are present but no checksum is pinned for them.' }],
    },
    {
      id: 'whisper-onnx-local', label: 'Whisper (local ONNX)', role: 'stt', license: 'mit',
      notes: '', modelDir: '/models/whisper', readiness: 'missing',
      counts: { artifacts: 2, present: 0, verified: 0, unverified: 0, corrupt: 0, missing: 2, invalid: 0 },
      artifacts: [], ready: false,
      recovery: [{ code: 'provision-files', message: 'Place the missing files in the model folder.', files: ['encoder_model.onnx'] }],
    },
    {
      id: 'piper-es-local', label: 'Piper Spanish', role: 'tts', license: 'cc-by-4.0',
      notes: '', modelDir: '/models/piper', readiness: 'corrupt',
      counts: { artifacts: 1, present: 1, verified: 0, unverified: 0, corrupt: 1, missing: 0, invalid: 0 },
      artifacts: [], ready: false,
      recovery: [{ code: 'replace-corrupt-artifact', message: 'Replace es_ES.onnx: its bytes do not match the recorded checksum.' }],
    },
  ],
})
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  element = document.createElement('div'); document.body.append(element)
  root = createRoot(element)
  speech = {
    config: vi.fn(async () => ({ hotkey: { enabled: false, shortcut: '' }, playback: { prefetch_next_fragment: true }, tts: { profiles: [] } })),
    kokoroInstallStatus: vi.fn(async () => ({ busy: false })),
    kokoroStatus: vi.fn(async () => null), keyStatus: vi.fn(async () => ({})), status: vi.fn(async () => null),
    modelDiagnostics: vi.fn(async () => report()),
    onEvent: vi.fn(() => vi.fn()), setLookahead: vi.fn(async () => {}), cancelReading: vi.fn(async () => true), stop: vi.fn(async () => {}),
  }
  Object.defineProperty(window, 'workspace', { configurable: true, value: { speech } })
})
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.restoreAllMocks() })

describe('voice lookahead setting', () => {
  it('discloses that the bundled local wrapper is English-only, not multilingual voice readiness', async () => {
    await act(async () => { root.render(<VoiceSettings />); await flush() })
    expect(element.textContent).toContain('English voices only')
    expect(element.textContent).toContain('Spanish and other local output languages')
  })
  it('loads the persisted choice and saves a boolean for future readings', async () => {
    await act(async () => { root.render(<VoiceSettings />); await flush() })
    const control = element.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(control.checked).toBe(true)
    await act(async () => { control.click(); await flush() })
    expect(speech.setLookahead).toHaveBeenCalledExactlyOnceWith(false)
    expect(control.checked).toBe(false)
    expect(element.textContent).toContain('future readings')
    expect(element.textContent).toContain('cloud transmission')
  })
  it('preserves the prior value after a failed save', async () => {
    speech.setLookahead.mockRejectedValue(new Error('Could not persist setting'))
    await act(async () => { root.render(<VoiceSettings />); await flush() })
    const control = element.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => { control.click(); await flush() })
    expect(control.checked).toBe(true)
    expect(control.disabled).toBe(false)
    expect(element.textContent).toContain('Could not persist setting')
  })
  it('disables the control until configuration loads', async () => {
    speech.config.mockReturnValue(new Promise(() => {}))
    await act(async () => { root.render(<VoiceSettings />); await flush() })
    expect(element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true)
    expect(speech.setLookahead).not.toHaveBeenCalled()
  })
})


describe('reading controls', () => {
  it('stops the shown reading by identity without stopping the queue or agent', async () => {
    speech.status.mockResolvedValue({ speaking: true, synthesizing: false, readingId: 42 })
    await act(async () => { root.render(<VoiceSettings />); await flush() })
    const button = [...element.querySelectorAll('button')].find((item) => item.textContent === 'Stop current reading')!
    expect(button.disabled).toBe(false)
    await act(async () => { button.click(); await flush() })
    expect(speech.cancelReading).toHaveBeenCalledExactlyOnceWith(42)
    expect(speech.stop).not.toHaveBeenCalled()
  })
  it('reports a reading that finished before cancellation arrived', async () => {
    speech.status.mockResolvedValue({ speaking: true, synthesizing: false, readingId: 42 })
    speech.cancelReading.mockResolvedValue(false)
    await act(async () => { root.render(<VoiceSettings />); await flush() })
    const button = [...element.querySelectorAll('button')].find((item) => item.textContent === 'Stop current reading')!
    await act(async () => { button.click(); await flush() })
    expect(element.textContent).toContain('already ended')
    expect(speech.stop).not.toHaveBeenCalled()
  })
})

describe('local model integrity (VOX-A4c)', () => {
  it('never shows merely-present files as ready, and says so explicitly', async () => {
    await act(async () => { root.render(<VoiceSettings />); await flush() })
    const panel = element.querySelector('[data-testid="model-integrity"]')!
    const kokoro = panel.querySelector('[data-model="kokoro-v1.0-en"]')!
    expect(kokoro.getAttribute('data-readiness')).toBe('unverified_files_present')
    expect(kokoro.textContent).toContain('NOT verified')
    expect(kokoro.textContent).not.toContain('verified offline')
    expect(kokoro.textContent).toContain('0/2 verified')
    expect(panel.textContent).toContain('Verification reads the files and compares pinned checksums offline')
  })

  it('distinguishes missing from corrupt, each with its own recovery step', async () => {
    await act(async () => { root.render(<VoiceSettings />); await flush() })
    const panel = element.querySelector('[data-testid="model-integrity"]')!
    const whisper = panel.querySelector('[data-model="whisper-onnx-local"]')!
    const piper = panel.querySelector('[data-model="piper-es-local"]')!
    expect(whisper.textContent).toContain('missing')
    expect(whisper.textContent).toContain('Place the missing files in the model folder.')
    expect(piper.textContent).toContain('corrupt')
    expect(piper.textContent).toContain('do not match the recorded checksum')
  })

  it('re-runs verification on demand instead of trusting a stale snapshot', async () => {
    await act(async () => { root.render(<VoiceSettings />); await flush() })
    expect(speech.modelDiagnostics).toHaveBeenCalledTimes(1)
    const button = [...element.querySelectorAll('button')].find((b) => b.textContent === 'Verify model files')!
    await act(async () => { button.click(); await flush() })
    expect(speech.modelDiagnostics).toHaveBeenCalledTimes(2)
  })

  it('reports a failed verification instead of showing an empty panel as success', async () => {
    speech.modelDiagnostics.mockRejectedValue(new Error('Model folder is unreadable'))
    await act(async () => { root.render(<VoiceSettings />); await flush() })
    const panel = element.querySelector('[data-testid="model-integrity"]')!
    expect(panel.textContent).toContain('Verification failed: Model folder is unreadable')
    expect(element.textContent).toContain('Model folder is unreadable')
  })
})
