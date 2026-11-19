import { describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../../shared/speech/defaults'
import { ReadingController } from './reading'
import type { PcmAudio } from './engines/wav'

const audio: PcmAudio = { pcm: Buffer.alloc(2), sampleRate: 24000, channels: 1, bitsPerSample: 16 }
const abortable = (signal: AbortSignal): Promise<PcmAudio> => new Promise((_resolve, reject) => {
  if (signal.aborted) reject(new Error('aborted'))
  else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
})

describe('reading controller', () => {
  it('sanitizes, synthesizes, plays sequentially and returns to idle', async () => {
    const synthesize = vi.fn(async () => audio)
    const play = vi.fn(async () => {})
    const onStatus = vi.fn()
    const controller = new ReadingController({ synthesize, play, onStatus })
    const job = controller.read('# Hello', defaultConfig())
    expect(await job.result).toEqual({ finished: true })
    expect(synthesize.mock.calls).toHaveLength(1)
    expect(play).toHaveBeenCalledTimes(1)
    expect(controller.getStatus().speaking).toBe(false)
  })
  it('interrupts the active reading and drains queued work', async () => {
    const synthesize = vi.fn((_text: string, _config: unknown, signal: AbortSignal) => abortable(signal))
    const controller = new ReadingController({ synthesize, play: async () => {}, onStatus: () => {} })
    const cfg = defaultConfig()
    const a = controller.read('first', cfg)
    cfg.playback.on_retrigger = 'queue'
    const b = controller.read('second', cfg)
    cfg.playback.on_retrigger = 'interrupt'
    const c = controller.read('third', cfg)
    expect(await a.result).toEqual({ finished: false, error: 'Cancelled' })
    expect(await b.result).toEqual({ finished: false, error: 'Cancelled' })
    controller.stop()
    expect(await c.result).toEqual({ finished: false, error: 'Cancelled' })
  })
  it('handles synthesis failures and rejects oversized input', async () => {
    const controller = new ReadingController({ synthesize: async () => { throw new Error('engine failed') }, play: async () => {}, onStatus: () => {} })
    const cfg = defaultConfig()
    expect(await controller.read('hello', cfg).result).toEqual({ finished: false, error: 'engine failed' })
    expect(() => controller.read('x'.repeat(cfg.trigger.max_text_length + 1), cfg)).toThrow('limit')
  })
})
