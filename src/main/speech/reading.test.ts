import { describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../../shared/speech/defaults'
import { ReadingController, splitProviderText } from './reading'
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


describe('provider text limits', () => {
  it('splits on UTF-16 boundaries without losing supplementary characters', () => {
    const input = 'a'.repeat(4095) + '🦊'.repeat(1000)
    const pieces = splitProviderText(input, 4096)
    expect(pieces.join('')).toBe(input)
    expect(pieces.every((piece) => piece.length <= 4096)).toBe(true)
    expect(pieces.every((piece) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(piece))).toBe(true)
  })
  it('enforces the OpenAI limit even with pagination disabled', async () => {
    const received: string[] = []
    const controller = new ReadingController({ synthesize: async (text) => { received.push(text); return audio }, play: async () => {}, onStatus: () => {} })
    const cfg = defaultConfig()
    cfg.sanitization.enabled = false
    cfg.pagination.enabled = false
    cfg.tts.profiles[0].engine = 'openai'
    expect(await controller.read('x'.repeat(9000), cfg).result).toEqual({ finished: true })
    expect(received.map((s) => s.length)).toEqual([4096, 4096, 808])
  })
})

const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const fragmentedConfig = (lookahead = true): ReturnType<typeof defaultConfig> => {
  const cfg = defaultConfig()
  cfg.sanitization.enabled = false
  cfg.pagination.enabled = false
  cfg.tts.profiles[0].engine = 'openai'
  cfg.playback.prefetch_next_fragment = lookahead
  return cfg
}
const threeFragments = 'x'.repeat(9000)

describe('bounded synthesis lookahead', () => {
  it('prepares only one next fragment during playback and preserves playback order', async () => {
    const releases: (() => void)[] = []
    const synthesize = vi.fn(async () => audio)
    const play = vi.fn(() => new Promise<void>((resolve) => releases.push(resolve)))
    const controller = new ReadingController({ synthesize, play, onStatus: () => {} })
    const job = controller.read(threeFragments, fragmentedConfig())
    await flush()
    expect(synthesize).toHaveBeenCalledTimes(2)
    expect(play).toHaveBeenCalledTimes(1)
    releases.shift()!()
    await flush()
    expect(synthesize).toHaveBeenCalledTimes(3)
    expect(play).toHaveBeenCalledTimes(2)
    releases.shift()!()
    await flush()
    expect(play).toHaveBeenCalledTimes(3)
    releases.shift()!()
    expect(await job.result).toEqual({ finished: true })
  })
  it('retains serial synthesis when lookahead is disabled', async () => {
    let release!: () => void
    const synthesize = vi.fn(async () => audio)
    const play = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const controller = new ReadingController({ synthesize, play, onStatus: () => {} })
    const job = controller.read(threeFragments, fragmentedConfig(false))
    await flush()
    expect(synthesize).toHaveBeenCalledOnce()
    release(); await flush()
    expect(synthesize).toHaveBeenCalledTimes(2)
    release(); await flush()
    release()
    expect(await job.result).toEqual({ finished: true })
  })
  it('aborts lookahead on stop and never plays its late result', async () => {
    let lookaheadSignal!: AbortSignal
    const synthesize = vi.fn((_text: string, _cfg: unknown, signal: AbortSignal) => {
      if (synthesize.mock.calls.length === 1) return Promise.resolve(audio)
      lookaheadSignal = signal
      return abortable(signal)
    })
    const play = vi.fn((_audio: PcmAudio, _text: string, signal: AbortSignal) => abortable(signal).then(() => {}))
    const controller = new ReadingController({ synthesize, play, onStatus: () => {} })
    const job = controller.read(threeFragments, fragmentedConfig())
    await flush()
    expect(synthesize).toHaveBeenCalledTimes(2)
    controller.stop()
    expect(await job.result).toEqual({ finished: false, error: 'Cancelled' })
    expect(lookaheadSignal.aborted).toBe(true)
    expect(play).toHaveBeenCalledOnce()
  })
  it('aborts an in-flight next synthesis when playback fails', async () => {
    let lookaheadSignal!: AbortSignal
    const synthesize = vi.fn((_text: string, _cfg: unknown, signal: AbortSignal) => {
      if (synthesize.mock.calls.length === 1) return Promise.resolve(audio)
      lookaheadSignal = signal
      return abortable(signal)
    })
    const controller = new ReadingController({ synthesize, play: async () => { throw new Error('speaker unavailable') }, onStatus: () => {} })
    expect(await controller.read(threeFragments, fragmentedConfig()).result).toEqual({ finished: false, error: 'speaker unavailable' })
    expect(lookaheadSignal.aborted).toBe(true)
    expect(controller.getStatus().speaking).toBe(false)
  })
  it('waits for interrupted lookahead cleanup before starting the replacement job', async () => {
    let finishCleanup!: () => void
    let cancelledSignal!: AbortSignal
    const synthesize = vi.fn((_text: string, _cfg: unknown, signal: AbortSignal): Promise<PcmAudio> => {
      if (synthesize.mock.calls.length === 2) {
        cancelledSignal = signal
        return new Promise((_resolve, reject) => { finishCleanup = () => reject(new Error('cancelled child closed')) })
      }
      return Promise.resolve(audio)
    })
    const play = vi.fn((_audio: PcmAudio, text: string, signal: AbortSignal) =>
      text === 'replacement' ? Promise.resolve() : abortable(signal).then(() => {}))
    const controller = new ReadingController({ synthesize, play, onStatus: () => {} })
    const first = controller.read(threeFragments, fragmentedConfig())
    await flush()
    const next = controller.read('replacement', fragmentedConfig())
    await flush()
    expect(cancelledSignal.aborted).toBe(true)
    expect(synthesize).toHaveBeenCalledTimes(2)
    finishCleanup()
    expect(await first.result).toEqual({ finished: false, error: 'Cancelled' })
    expect(await next.result).toEqual({ finished: true })
    expect(synthesize).toHaveBeenCalledTimes(3)
  })
  it('handles lookahead failure during active playback without unhandled rejection', async () => {
    let release!: () => void
    const synthesize = vi.fn(async () => {
      if (synthesize.mock.calls.length > 1) throw new Error('next fragment failed')
      return audio
    })
    const play = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const controller = new ReadingController({ synthesize, play, onStatus: () => {} })
    const job = controller.read(threeFragments, fragmentedConfig())
    await flush()
    expect(play).toHaveBeenCalledOnce()
    release()
    expect(await job.result).toEqual({ finished: false, error: 'next fragment failed' })
    expect(play).toHaveBeenCalledOnce()
  })
})
