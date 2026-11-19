/** Batch local TTS runner. Never invokes a shell or places text on the command line. */
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { decodePcmWav, type PcmAudio } from './wav'

export interface LocalSynthesisRequest {
  text: string
  voice: string
  command: string
  argsTemplate: string[]
  engineDir: string
  signal?: AbortSignal
  timeoutMs?: number
}

const MAX_WAV_BYTES = 32 * 1024 * 1024

export async function synthesizeLocal(request: LocalSynthesisRequest): Promise<PcmAudio> {
  if (!request.text.trim() || request.text.length > 100_000) throw new Error('Invalid local speech text')
  if (!request.command || !Array.isArray(request.argsTemplate) ||
      !request.argsTemplate.some((arg) => arg.includes('{input}')) ||
      !request.argsTemplate.some((arg) => arg.includes('{output}'))) {
    throw new Error('Local engine requires a command and input/output placeholders')
  }
  if (request.signal?.aborted) throw new Error('Local speech cancelled')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-speech-'))
  const input = path.join(dir, 'input.txt')
  const output = path.join(dir, 'output.wav')
  try {
    await fs.writeFile(input, request.text, { encoding: 'utf8', mode: 0o600 })
    const substitutions: Record<string, string> = { input, output, voice: request.voice, engine_dir: request.engineDir }
    const args = request.argsTemplate.map((arg) => arg.replace(/\{(input|output|voice|engine_dir)\}/g, (_match, name: string) => substitutions[name]))
    await new Promise<void>((resolve, reject) => {
      if (request.signal?.aborted) { reject(new Error('Local speech cancelled')); return }
      const child = spawn(request.command, args, { shell: false, windowsHide: true, stdio: 'ignore' })
      let reason: string | undefined
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const stop = (why: string): void => {
        if (reason) return
        reason = why
        child.kill('SIGTERM')
        killTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
        killTimer.unref()
      }
      const abort = (): void => stop('Local speech cancelled')
      request.signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(() => stop('Local speech timed out'), request.timeoutMs ?? 120_000)
      timer.unref()
      const cleanup = (): void => {
        clearTimeout(timer)
        if (killTimer) clearTimeout(killTimer)
        request.signal?.removeEventListener('abort', abort)
      }
      child.once('error', () => { cleanup(); reject(new Error('Could not start local speech engine')) })
      child.once('close', (code) => {
        cleanup()
        if (reason) reject(new Error(reason))
        else if (code !== 0) reject(new Error(`Local speech engine exited with code ${code}`))
        else resolve()
      })
      if (request.signal?.aborted) abort()
    })
    const stat = await fs.stat(output)
    if (!stat.isFile() || stat.size > MAX_WAV_BYTES) throw new Error('Invalid or oversized local audio')
    const data = await fs.readFile(output)
    if (data.length > MAX_WAV_BYTES) throw new Error('Invalid or oversized local audio')
    return decodePcmWav(data)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
