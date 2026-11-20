/** Acknowledged renderer playback: a reading advances only after audio finishes. */
import { randomUUID } from 'node:crypto'
import type { PcmAudio } from './engines/wav'

import type { PlaybackMessage } from '../../shared/speech/playback'

export class PlaybackBroker {
  private pending = new Map<string, { finish: (error?: Error) => void; owner: number }>()
  constructor(private readonly send: (owner: number, message: PlaybackMessage) => void) {}

  play(owner: number, audio: PcmAudio, text: string, volume: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new Error('Playback cancelled'))
    const id = randomUUID()
    const duration = audio.pcm.length / (audio.sampleRate * audio.channels * 2) * 1000
    return new Promise((resolve, reject) => {
      let done = false
      const finish = (error?: Error): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.pending.delete(id)
        if (error) reject(error); else resolve()
      }
      const abort = (): void => {
        try { this.send(owner, { type: 'cancel', id }) } catch { /* already gone */ }
        finish(new Error('Playback cancelled'))
      }
      const timer = setTimeout(() => finish(new Error('Audio playback timed out')), Math.max(30_000, duration + 30_000))
      timer.unref()
      this.pending.set(id, { finish, owner })
      signal.addEventListener('abort', abort, { once: true })
      try {
        this.send(owner, { type: 'play', id, pcmBase64: audio.pcm.toString('base64'), sampleRate: audio.sampleRate, channels: audio.channels, volume, text })
      } catch { finish(new Error('Playback window is unavailable')) }
      if (signal.aborted) abort()
    })
  }

  complete(owner: number, id: string, ok: boolean): boolean {
    const pending = this.pending.get(id)
    if (!pending || pending.owner !== owner) return false
    pending.finish(ok ? undefined : new Error('Audio playback failed'))
    return true
  }
  closeOwner(owner: number): void {
    for (const item of this.pending.values()) if (item.owner === owner) item.finish(new Error('Playback window closed'))
  }
}
