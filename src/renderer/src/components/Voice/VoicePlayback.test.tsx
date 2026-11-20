// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackMessage } from '../../../../shared/speech/playback'
import { VoicePlayback } from './VoicePlayback'

vi.mock('../Landscape/toastStore', () => ({ toastError: vi.fn() }))

class FakeSource {
  buffer: unknown
  onended: (() => void) | null = null
  connect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}
let contexts: FakeContext[]
class FakeContext {
  source = new FakeSource()
  destination = {}
  close = vi.fn(async () => {})
  resume = vi.fn(async () => {})
  constructor() { contexts.push(this) }
  createBuffer(_channels: number, frames: number) { return { getChannelData: () => new Float32Array(frames) } }
  createGain() { return { gain: { value: 0 }, connect: vi.fn() } }
  createBufferSource() { return this.source }
}
let onPlayback: (message: PlaybackMessage) => void
let speech: any
let root: Root
let element: HTMLDivElement
let unmounted: boolean
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const play = (id: string): PlaybackMessage => ({ type: 'play', id, pcmBase64: 'AAAAAA==', channels: 1, sampleRate: 24000, volume: 100, text: 'hello' })

beforeEach(async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  contexts = []
  unmounted = false
  speech = {
    onPlayback: vi.fn((fn: typeof onPlayback) => { onPlayback = fn; return vi.fn() }),
    onEvent: vi.fn(() => vi.fn()), playbackDone: vi.fn(async () => true),
  }
  Object.defineProperty(window, 'workspace', { configurable: true, value: { speech } })
  vi.stubGlobal('AudioContext', FakeContext)
  element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  await act(async () => root.render(<VoicePlayback />))
})
afterEach(async () => {
  if (!unmounted) await act(async () => root.unmount())
  element.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('renderer audio sink lifecycle', () => {
  it('acknowledges playback exactly once when audio ends', async () => {
    await act(async () => { onPlayback(play('one')); contexts[0].source.onended?.(); await flush() })
    expect(speech.playbackDone).toHaveBeenCalledExactlyOnceWith('one', true)
    expect(contexts[0].close).toHaveBeenCalledOnce()
  })
  it('cancel tolerates stopped sources and stale ended callbacks cannot finish another playback', async () => {
    await act(async () => { onPlayback(play('one')); await flush() })
    const oldEnd = contexts[0].source.onended!
    contexts[0].source.stop.mockImplementation(() => { throw new Error('already stopped') })
    contexts[0].close.mockRejectedValue(new Error('already closed'))
    await act(async () => { onPlayback({ type: 'cancel', id: 'one' }); onPlayback(play('two')); oldEnd(); await flush() })
    expect(contexts).toHaveLength(2)
    expect(speech.playbackDone).not.toHaveBeenCalled()
    await act(async () => { contexts[1].source.onended?.(); await flush() })
    expect(speech.playbackDone).toHaveBeenCalledExactlyOnceWith('two', true)
  })
  it('ignores a late resume failure after cancellation and a new playback', async () => {
    let rejectResume!: (error: Error) => void
    class DelayedContext extends FakeContext {
      constructor() {
        super()
        if (contexts.length === 1) this.resume.mockImplementation(() => new Promise((_resolve, reject) => { rejectResume = reject }))
      }
    }
    vi.stubGlobal('AudioContext', DelayedContext)
    await act(async () => { onPlayback(play('one')); await flush() })
    await act(async () => { onPlayback({ type: 'cancel', id: 'one' }); onPlayback(play('two')); rejectResume(new Error('late')); await flush() })
    expect(contexts[1].source.stop).not.toHaveBeenCalled()
    expect(speech.playbackDone).not.toHaveBeenCalled()
    await act(async () => { contexts[1].source.onended?.(); await flush() })
    expect(speech.playbackDone).toHaveBeenCalledExactlyOnceWith('two', true)
  })
  it('rejects malformed PCM without creating an audio context', async () => {
    await act(async () => { onPlayback({ ...play('bad'), pcmBase64: 'AA==' } as PlaybackMessage); await flush() })
    expect(contexts).toHaveLength(0)
    expect(speech.playbackDone).toHaveBeenCalledExactlyOnceWith('bad', false)
  })
  it('rejects overlapping playback without disturbing the active source', async () => {
    await act(async () => { onPlayback(play('one')); onPlayback(play('two')); await flush() })
    expect(speech.playbackDone).toHaveBeenCalledExactlyOnceWith('two', false)
    expect(contexts[0].source.stop).not.toHaveBeenCalled()
    await act(async () => { contexts[0].source.onended?.(); await flush() })
    expect(speech.playbackDone).toHaveBeenLastCalledWith('one', true)
  })
  it('cleans up when start throws and handles rejected acknowledgements', async () => {
    class BrokenContext extends FakeContext {
      constructor() { super(); this.source.start.mockImplementation(() => { throw new Error('start failed') }) }
    }
    vi.stubGlobal('AudioContext', BrokenContext)
    speech.playbackDone.mockRejectedValue(new Error('window closed'))
    await act(async () => { onPlayback(play('one')); await flush() })
    expect(contexts[0].source.stop).toHaveBeenCalledOnce()
    expect(contexts[0].close).toHaveBeenCalledOnce()
    expect(speech.playbackDone).toHaveBeenCalledExactlyOnceWith('one', false)
  })
  it('reports failure and closes the source if audio resume fails', async () => {
    class BrokenContext extends FakeContext {
      constructor() { super(); this.resume.mockRejectedValue(new Error('blocked')) }
    }
    vi.stubGlobal('AudioContext', BrokenContext)
    await act(async () => { onPlayback(play('one')); await flush() })
    expect(contexts[0].source.stop).toHaveBeenCalledOnce()
    expect(contexts[0].close).toHaveBeenCalledOnce()
    expect(speech.playbackDone).toHaveBeenCalledExactlyOnceWith('one', false)
  })
  it('stops active audio on unmount and acknowledges failure', async () => {
    await act(async () => { onPlayback(play('one')); await flush() })
    await act(async () => { root.unmount(); unmounted = true; await flush() })
    expect(contexts[0].source.stop).toHaveBeenCalledOnce()
    expect(contexts[0].close).toHaveBeenCalledOnce()
    expect(speech.playbackDone).toHaveBeenCalledExactlyOnceWith('one', false)
    await act(async () => { onPlayback({ type: 'cancel', id: 'one' }); await flush() })
    expect(contexts[0].source.stop).toHaveBeenCalledOnce()
    expect(contexts[0].close).toHaveBeenCalledOnce()
  })
})
