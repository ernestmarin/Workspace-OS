import { afterEach, describe, expect, it, vi } from 'vitest'
import { startEnergyMonitor } from './energyMonitor'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('local audio energy monitor', () => {
  it('closes the audio graph on cleanup and never calls endpoint afterwards', async () => {
    vi.useFakeTimers()
    const close = vi.fn(async () => {})
    const source = { connect: vi.fn() }
    const analyser = { fftSize: 0, connect: vi.fn(), getFloatTimeDomainData: vi.fn((samples: Float32Array) => samples.fill(0.1)) }
    const gain = { gain: { value: 1 }, connect: vi.fn() }
    class FakeContext {
      destination = {}
      createMediaStreamSource() { return source }
      createAnalyser() { return analyser }
      createGain() { return gain }
      resume = vi.fn(async () => {})
      close = close
    }
    vi.stubGlobal('AudioContext', FakeContext)
    const end = vi.fn(), unavailable = vi.fn()
    const cleanup = startEnergyMonitor({} as MediaStream, end, unavailable)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(300)
    expect(gain.gain.value).toBe(0)
    cleanup(); cleanup()
    await vi.advanceTimersByTimeAsync(3000)
    expect(close).toHaveBeenCalledOnce()
    expect(end).not.toHaveBeenCalled()
    expect(unavailable).not.toHaveBeenCalled()
  })
  it('notifies exactly once after loud input followed by silence', async () => {
    vi.useFakeTimers()
    let amplitude = 0.1
    const close = vi.fn(async () => {})
    const analyser = { fftSize: 0, connect: vi.fn(), getFloatTimeDomainData: (data: Float32Array) => data.fill(amplitude) }
    class FakeContext {
      destination = {}
      createMediaStreamSource() { return { connect: vi.fn() } }
      createAnalyser() { return analyser }
      createGain() { return { gain: { value: 1 }, connect: vi.fn() } }
      resume = vi.fn(async () => {})
      close = close
    }
    vi.stubGlobal('AudioContext', FakeContext)
    const end = vi.fn()
    const cleanup = startEnergyMonitor({} as MediaStream, end, vi.fn())
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(500)
    amplitude = 0
    await vi.advanceTimersByTimeAsync(1500)
    expect(end).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    cleanup()
  })
  it('reports failure and preserves manual stop when audio context cannot initialize', () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('unavailable') } })
    const unavailable = vi.fn()
    const cleanup = startEnergyMonitor({} as MediaStream, vi.fn(), unavailable)
    expect(unavailable).toHaveBeenCalledOnce()
    cleanup()
  })
})
