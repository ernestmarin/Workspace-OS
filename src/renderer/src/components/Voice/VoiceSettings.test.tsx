// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceSettings } from './VoiceSettings'

let root: Root
let element: HTMLDivElement
let speech: any
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve() }
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  element = document.createElement('div'); document.body.append(element)
  root = createRoot(element)
  speech = {
    config: vi.fn(async () => ({ hotkey: { enabled: false, shortcut: '' }, playback: { prefetch_next_fragment: true }, tts: { profiles: [] } })),
    kokoroInstallStatus: vi.fn(async () => ({ busy: false })),
    kokoroStatus: vi.fn(async () => null), keyStatus: vi.fn(async () => ({})), status: vi.fn(async () => null),
    onEvent: vi.fn(() => vi.fn()), setLookahead: vi.fn(async () => {}), cancelReading: vi.fn(async () => true), stop: vi.fn(async () => {}),
  }
  Object.defineProperty(window, 'workspace', { configurable: true, value: { speech } })
})
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.restoreAllMocks() })

describe('voice lookahead setting', () => {
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
