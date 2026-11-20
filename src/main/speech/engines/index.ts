/** Engine dispatch for the reading controller. Unsupported engines fail explicitly. */
import type { AppConfig } from '../../../shared/speech/types'
import { speechEnginesDir } from '../paths'
import { resolveSpeechKey } from '../secrets'
import { synthesizeLocal } from './local'
import { synthesizeOpenAi } from './openai'
import { synthesizePiper } from './piper'
import { assertKokoroInstalled } from './kokoro'
import type { PcmAudio } from './wav'

export async function synthesizeFragment(text: string, config: AppConfig, signal: AbortSignal): Promise<PcmAudio> {
  const profile = config.tts.profiles.find((entry) => entry.id === config.tts.active_profile_id)
  const engine = profile?.engine ?? config.tts.active_backend
  const voice = profile?.voice || config.tts.voice
  if (engine === 'openai') {
    const pcm = await synthesizeOpenAi({
      text, voice: voice || config.tts.openai.voice,
      model: config.tts.openai.model, instructions: config.tts.openai.instructions,
      apiKey: resolveSpeechKey('SPEECH_OPENAI_API_KEY'), signal,
    })
    return { pcm, sampleRate: 24000, channels: 1, bitsPerSample: 16 }
  }
  if (engine === 'piper') {
    return synthesizePiper({
      text,
      voice,
      engineDir: speechEnginesDir(),
      command: config.tts.command && config.tts.command !== 'uv' ? config.tts.command : undefined,
      signal,
    })
  }
  if (engine === 'local' || engine === 'kokoro') {
    const engineDir = speechEnginesDir()
    if (engine === 'kokoro') assertKokoroInstalled(engineDir)
    const argsTemplate = [...config.tts.args_template]
    // The default uv invocation must neither sync packages nor fetch Python.
    // These flags constrain uv, not arbitrary third-party executable network access.
    if (engine === 'kokoro' && config.tts.command === 'uv' && argsTemplate[0] === 'run') {
      const guards = ['--no-sync', '--offline', '--no-python-downloads'].filter((flag) => !argsTemplate.includes(flag))
      argsTemplate.splice(1, 0, ...guards)
    }
    return synthesizeLocal({ text, voice, command: config.tts.command, argsTemplate, engineDir, signal })
  }
  throw new Error(`Speech engine ${engine} is not implemented`)
}
