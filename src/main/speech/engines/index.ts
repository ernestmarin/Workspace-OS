/** Engine dispatch for the reading controller. Unsupported engines fail explicitly. */
import type { AppConfig } from '../../../shared/speech/types'
import { speechEnginesDir } from '../paths'
import { resolveSpeechKey } from '../secrets'
import { synthesizeLocal } from './local'
import { synthesizeOpenAi } from './openai'
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
  if (engine === 'local' || engine === 'kokoro') {
    const engineDir = speechEnginesDir()
    if (engine === 'kokoro') assertKokoroInstalled(engineDir)
    const argsTemplate = [...config.tts.args_template]
    // A speech request must never implicitly install packages. Installation is opt-in.
    if (engine === 'kokoro' && config.tts.command === 'uv' && argsTemplate[0] === 'run' && !argsTemplate.includes('--no-sync')) argsTemplate.splice(1, 0, '--no-sync')
    return synthesizeLocal({ text, voice, command: config.tts.command, argsTemplate, engineDir, signal })
  }
  throw new Error(`Speech engine ${engine} is not implemented`)
}
