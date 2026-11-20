/**
 * Spanish- & multilingual-capable local Piper ONNX TTS adapter (VOX-A4e).
 *
 * Complements the English-only bundled Kokoro wrapper without introducing a
 * Python sidecar or automatic model downloads. Expects a local `piper` binary
 * and `<voice>.onnx` + `<voice>.onnx.json` inside `<engineDir>/piper`, feeds
 * UTF-8 text via `stdin` (never shell or argv), and decodes bounded PCM WAV.
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { decodePcmWav, type PcmAudio } from './wav'
import { runSpeechCommand } from './process'

const VOICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MAX_WAV_BYTES = 32 * 1024 * 1024
const DEFAULT_SPANISH_PIPER_VOICE = 'es_ES-davefx-medium'

export interface PiperSynthesisRequest {
  text: string
  voice?: string
  engineDir: string
  command?: string
  leadingArgs?: string[]
  signal?: AbortSignal
  timeoutMs?: number
}

async function isRegularNonEmptyFile(baseDir: string, targetPath: string): Promise<boolean> {
  try {
    const lstat = await fs.lstat(targetPath)
    if (lstat.isSymbolicLink() || !lstat.isFile() || lstat.size <= 0) return false
    const [realBase, realTarget] = await Promise.all([fs.realpath(baseDir), fs.realpath(targetPath)])
    return realTarget.startsWith(realBase + path.sep)
  } catch {
    return false
  }
}

export async function resolvePiperVoicePaths(engineDir: string, rawVoice?: string): Promise<{ modelPath: string; configPath: string; voiceId: string }> {
  const voiceId = (rawVoice && rawVoice.trim()) ? rawVoice.trim() : DEFAULT_SPANISH_PIPER_VOICE
  if (!VOICE_ID_RE.test(voiceId) || voiceId.includes('..')) {
    throw new Error('Invalid Piper voice identifier')
  }
  const piperDir = path.resolve(engineDir, 'piper')
  const modelPath = path.resolve(piperDir, `${voiceId}.onnx`)
  const configPath = path.resolve(piperDir, `${voiceId}.onnx.json`)
  if (!modelPath.startsWith(piperDir + path.sep) || !configPath.startsWith(piperDir + path.sep)) {
    throw new Error('Invalid Piper voice identifier')
  }
  const [hasModel, hasConfig] = await Promise.all([
    isRegularNonEmptyFile(piperDir, modelPath),
    isRegularNonEmptyFile(piperDir, configPath),
  ])
  if (!hasModel || !hasConfig) {
    throw new Error(`Piper voice model files are not installed in ${piperDir} (${voiceId}.onnx / .onnx.json)`)
  }
  return { modelPath, configPath, voiceId }
}

export async function synthesizePiper(request: PiperSynthesisRequest): Promise<PcmAudio> {
  if (!request.text.trim() || request.text.length > 100_000) {
    throw new Error('Invalid local Piper speech text')
  }
  if (request.signal?.aborted) throw new Error('Piper speech cancelled')

  const { modelPath, configPath } = await resolvePiperVoicePaths(request.engineDir, request.voice)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-piper-'))
  const output = path.join(dir, 'output.wav')
  try {
    const command = request.command && request.command.trim() ? request.command.trim() : 'piper'
    const args = [
      ...(request.leadingArgs ?? []),
      '--model',
      modelPath,
      '--config',
      configPath,
      '--output_file',
      output,
    ]
    await runSpeechCommand(command, args, {
      signal: request.signal,
      timeoutMs: request.timeoutMs ?? 120_000,
      label: 'Piper local speech',
      startError: 'Could not start Piper local speech engine (ensure piper CLI is installed)',
      stdinText: request.text,
    })
    if (request.signal?.aborted) throw new Error('Piper speech cancelled')
    const stat = await fs.stat(output)
    if (!stat.isFile() || stat.size > MAX_WAV_BYTES) throw new Error('Invalid or oversized Piper audio')
    const data = await fs.readFile(output)
    if (data.length > MAX_WAV_BYTES) throw new Error('Invalid or oversized Piper audio')
    return decodePcmWav(data)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
