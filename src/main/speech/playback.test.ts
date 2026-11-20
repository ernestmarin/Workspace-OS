import { describe, expect, it, vi } from 'vitest'
import { PlaybackBroker } from './playback'
import type { PlaybackMessage } from '../../shared/speech/playback'

const audio = { pcm: Buffer.alloc(4), sampleRate: 24000, channels: 1, bitsPerSample: 16 }

describe('playback broker', () => {
  it('waits for an acknowledgement from the correct owner', async () => {
    const send = vi.fn<(owner: number, message: PlaybackMessage) => void>()
    const broker = new PlaybackBroker(send)
    const promise = broker.play(10, audio, 'hello', 80, new AbortController().signal)
    const message = send.mock.calls[0][1]
    if (message.type !== 'play') throw new Error('Expected play')
    expect(broker.complete(11, message.id, true)).toBe(false)
    expect(broker.complete(10, message.id, true)).toBe(true)
    await expect(promise).resolves.toBeUndefined()
    expect(broker.complete(10, message.id, true)).toBe(false)
  })
  it('sends cancellation and ignores stale acknowledgements', async () => {
    const send = vi.fn<(owner: number, message: PlaybackMessage) => void>()
    const broker = new PlaybackBroker(send)
    const abort = new AbortController()
    const promise = broker.play(1, audio, 'hello', 100, abort.signal)
    const message = send.mock.calls[0][1]
    abort.abort()
    await expect(promise).rejects.toThrow('cancelled')
    expect(send).toHaveBeenLastCalledWith(1, { type: 'cancel', id: message.id })
    expect(broker.complete(1, message.id, true)).toBe(false)
  })
  it('rejects pending playback when the window closes or send fails', async () => {
    const broker = new PlaybackBroker(() => {})
    const promise = broker.play(4, audio, 'hello', 100, new AbortController().signal)
    broker.closeOwner(4)
    await expect(promise).rejects.toThrow('window closed')
    const broken = new PlaybackBroker(() => { throw new Error('destroyed') })
    await expect(broken.play(4, audio, 'hello', 100, new AbortController().signal)).rejects.toThrow('unavailable')
  })
})

describe('playback timeout', () => {
  it('cancels the renderer before rejecting, and ignores late acknowledgements', async () => {
    vi.useFakeTimers()
    try {
      const send = vi.fn<(owner: number, message: PlaybackMessage) => void>()
      const broker = new PlaybackBroker(send)
      const result = broker.play(1, audio, 'hello', 100, new AbortController().signal).catch((e: Error) => e.message)
      const id = send.mock.calls[0][1].id
      await vi.advanceTimersByTimeAsync(31_000)
      expect(await result).toBe('Audio playback timed out')
      expect(send).toHaveBeenLastCalledWith(1, { type: 'cancel', id })
      expect(broker.complete(1, id, true)).toBe(false)
    } finally { vi.useRealTimers() }
  })
})
