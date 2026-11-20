import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { LocalStt, STT_MAX_SAMPLES } from './local-stt'

class FakeWorker extends EventEmitter {
  postMessage = vi.fn()
  terminate = vi.fn(async () => 0)
}

describe('offline STT job lifecycle', () => {
  it('validates and bounds audio before starting a worker', async () => {
    const factory = vi.fn(() => new FakeWorker())
    const stt = new LocalStt(factory)
    for (const audio of [null, new Float32Array(1), new Float32Array(STT_MAX_SAMPLES + 1), new Float32Array(1600).fill(NaN), new Float32Array(1600).fill(2)]) {
      await expect(stt.transcribe(audio, 'es')).rejects.toThrow()
    }
    await expect(stt.transcribe(new Float32Array(1600), 'en-US')).rejects.toThrow()
    expect(factory).not.toHaveBeenCalled()
  })
  it('runs one job and returns text once without exposing worker errors', async () => {
    const worker = new FakeWorker()
    const stt = new LocalStt(() => worker)
    const first = stt.transcribe(new Float32Array(1600), 'es')
    expect(stt.busy).toBe(true)
    await expect(stt.transcribe(new Float32Array(1600), 'es')).rejects.toThrow('already running')
    worker.emit('message', { text: ' hola ' })
    await expect(first).resolves.toBe('hola')
    expect(stt.busy).toBe(false)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('cancels the worker and rejects late results', async () => {
    const worker = new FakeWorker()
    const stt = new LocalStt(() => worker)
    const job = stt.transcribe(new Float32Array(1600), 'es')
    stt.cancel()
    worker.emit('message', { text: 'late' })
    await expect(job).rejects.toThrow('cancelled')
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(stt.busy).toBe(false)
  })
  it('ignores cancellation from another job and stale cancellation after completion', async () => {
    const worker = new FakeWorker()
    const stt = new LocalStt(() => worker)
    const firstId = '11111111-1111-4111-8111-111111111111'
    const nextId = '22222222-2222-4222-8222-222222222222'
    const first = stt.transcribe(new Float32Array(1600), 'es', firstId)
    stt.cancel(nextId)
    expect(worker.terminate).not.toHaveBeenCalled()
    worker.emit('message', { text: 'first' })
    await expect(first).resolves.toBe('first')
    const next = stt.transcribe(new Float32Array(1600), 'he', nextId)
    stt.cancel(firstId)
    expect(stt.busy).toBe(true)
    stt.cancel(nextId)
    await expect(next).rejects.toThrow('cancelled')
  })
  it('fails closed on malformed worker results', async () => {
    const worker = new FakeWorker()
    const stt = new LocalStt(() => worker)
    const job = stt.transcribe(new Float32Array(1600), 'es')
    worker.emit('message', { error: 'sensitive detail' })
    await expect(job).rejects.toThrow('verify the installed model')
    expect(stt.busy).toBe(false)
  })
})
