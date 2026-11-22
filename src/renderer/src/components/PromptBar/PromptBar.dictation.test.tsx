// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PromptBar } from './PromptBar'

/*
 * VOX-REACH-01 — dictation is input, never a submission.
 *
 * The transcript has to land in the draft where the person can read what was
 * heard, be merged exactly once even if the effect re-runs, and leave Enter/Send
 * as the only way to reach the agent.
 */
let root: Root, element: HTMLDivElement
const flush = async (): Promise<void> => { for (let i = 0; i < 15; i++) await Promise.resolve() }
const textarea = (): HTMLTextAreaElement =>
  element.querySelector('[data-testid="prompt-bar-input"]') as HTMLTextAreaElement

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  Object.defineProperty(window, 'workspace', {
    configurable: true,
    value: { fs: { listFiles: vi.fn(async () => []) }, cases: { list: vi.fn(async () => []) } },
  })
  element = document.createElement('div')
  document.body.append(element)
  root = createRoot(element)
})
afterEach(async () => { await act(async () => root.unmount()); element.remove() })

describe('PromptBar dictated text (VOX-REACH-01)', () => {
  it('appends a dictated transcript to the draft, consumes it once, and never submits it', async () => {
    const onSubmit = vi.fn()
    const onDictationConsumed = vi.fn()
    let dictated: string | null = 'hola agente'
    await act(async () => {
      root.render(<PromptBar onSubmit={onSubmit} dictatedText={dictated} onDictationConsumed={onDictationConsumed} />)
      await flush()
    })
    expect(textarea().value).toBe('hola agente')
    expect(onDictationConsumed).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()

    // Consuming is what keeps a re-render from merging the same transcript twice.
    dictated = null
    await act(async () => {
      root.render(<PromptBar onSubmit={onSubmit} dictatedText={dictated} onDictationConsumed={onDictationConsumed} />)
      await flush()
    })
    expect(textarea().value).toBe('hola agente')
    expect(onDictationConsumed).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('appends after an existing draft instead of replacing it', async () => {
    const onSubmit = vi.fn()
    await act(async () => {
      root.render(<PromptBar onSubmit={onSubmit} />)
      await flush()
    })
    await act(async () => {
      const el = textarea()
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(el, 'resume esto:')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      await flush()
    })
    await act(async () => {
      root.render(<PromptBar onSubmit={onSubmit} dictatedText="añade una prueba" onDictationConsumed={() => {}} />)
      await flush()
    })
    expect(textarea().value).toBe('resume esto: añade una prueba')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('focuses the composer when a confirmed voice command asks for it, and only on a change', async () => {
    const onSubmit = vi.fn()
    await act(async () => {
      root.render(<PromptBar onSubmit={onSubmit} focusSignal={0} />)
      await flush()
    })
    expect(document.activeElement).not.toBe(textarea())
    await act(async () => {
      root.render(<PromptBar onSubmit={onSubmit} focusSignal={1} />)
      await flush()
    })
    expect(document.activeElement).toBe(textarea())
  })
})
