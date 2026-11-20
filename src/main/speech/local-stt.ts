import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { speechDataDir } from './paths'

export const STT_SAMPLE_RATE = 16_000
export const STT_MAX_SAMPLES = STT_SAMPLE_RATE * 30
export const STT_MODEL_NAME = 'whisper'
export const sttModelsDir = (): string => path.join(speechDataDir(), 'models')
export const sttModelDir = (): string => path.join(sttModelsDir(), STT_MODEL_NAME)

/** Presence is deliberately not a readiness, integrity or model compatibility check. */
export function localSttStatus(): { modelDir: string; filesPresent: boolean } {
  const root = sttModelDir()
  const required = ['config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json']
  return { modelDir: root, filesPresent: required.every((name) => {
    try { return fs.statSync(path.join(root, name)).isFile() } catch { return false }
  }) }
}

interface SttWorker {
  once(event: 'message', listener: (message: unknown) => void): this
  once(event: 'error', listener: (error: Error) => void): this
  once(event: 'exit', listener: (code: number) => void): this
  postMessage(message: unknown): void
  terminate(): Promise<number>
}
type WorkerFactory = () => SttWorker

/** One bounded offline recognition at a time; cancellation kills the worker. */
export class LocalStt {
  private pending: { id: string; cancel: () => void } | null = null
  constructor(private readonly createWorker: WorkerFactory = () => new Worker(new URL('./sttWorker.js', import.meta.url)), private readonly timeoutMs = 120_000) {}
  get busy(): boolean { return this.pending !== null }
  cancel(id?: string): void { if (id === undefined || this.pending?.id === id) this.pending?.cancel() }

  async transcribe(samples: unknown, language: unknown, id: string = randomUUID()): Promise<string> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid transcription identity')
    if (this.pending) throw new Error('Local transcription is already running')
    if (!(samples instanceof Float32Array) || samples.length < 1600 || samples.length > STT_MAX_SAMPLES) throw new Error('Invalid audio length or format')
    if (typeof language !== 'string' || !/^[a-z]{2}$/.test(language)) throw new Error('Invalid transcription language')
    for (const sample of samples) if (!Number.isFinite(sample) || sample < -1 || sample > 1) throw new Error('Invalid audio samples')
    const input = new Float32Array(samples)
    return new Promise<string>((resolve, reject) => {
      let worker: SttWorker
      try { worker = this.createWorker() } catch { reject(new Error('Could not start local transcription')); return }
      let done = false
      const finish = (text?: string, error?: string): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        void worker.terminate().catch(() => 0).finally(() => {
          this.pending = null
          if (error) reject(new Error(error))
          else resolve(text ?? '')
        })
      }
      const timer = setTimeout(() => finish(undefined, 'Local transcription timed out'), this.timeoutMs)
      timer.unref?.()
      this.pending = { id, cancel: () => finish(undefined, 'Local transcription cancelled') }
      worker.once('message', (message) => {
        if (!message || typeof message !== 'object' || !('text' in message) || typeof message.text !== 'string' || message.text.length > 20_000) return finish(undefined, 'Local transcription failed; verify the installed model')
        finish(message.text.trim())
      })
      worker.once('error', () => finish(undefined, 'Local transcription worker failed'))
      worker.once('exit', () => finish(undefined, 'Local transcription worker stopped'))
      try { worker.postMessage({ samples: input, language, modelRoot: sttModelsDir() }) }
      catch { finish(undefined, 'Could not start local transcription') }
    })
  }
}
