/**
 * Engine API keys: environment (dev override) wins, then the keychain vault.
 * Names are env-var-shaped as the vault requires. The renderer can only see
 * whether a key is set (`status`), never the value.
 */
import { getVault } from '../secrets'

export const SPEECH_KEY_NAMES = [
  'SPEECH_OPENAI_API_KEY',
  'SPEECH_ELEVENLABS_API_KEY',
  'SPEECH_CARTESIA_API_KEY',
  'SPEECH_FISH_API_KEY',
  'SPEECH_XAI_API_KEY',
  'SPEECH_MISTRAL_API_KEY',
  'SPEECH_GOOGLE_API_KEY',
  'SPEECH_MICROSOFT_API_KEY',
  'SPEECH_MICROSOFT_ENDPOINT',
] as const
export type SpeechKeyName = (typeof SPEECH_KEY_NAMES)[number]
export const isSpeechKeyName = (name: string): name is SpeechKeyName =>
  (SPEECH_KEY_NAMES as readonly string[]).includes(name)

/** Env var checked before the vault, mirroring CopySpeech's "env wins" rule. */
const ENV_BY_KEY: Record<SpeechKeyName, string> = {
  SPEECH_OPENAI_API_KEY: 'WOS_OPENAI_API_KEY',
  SPEECH_ELEVENLABS_API_KEY: 'WOS_ELEVENLABS_API_KEY',
  SPEECH_CARTESIA_API_KEY: 'WOS_CARTESIA_API_KEY',
  SPEECH_FISH_API_KEY: 'WOS_FISH_API_KEY',
  SPEECH_XAI_API_KEY: 'WOS_XAI_API_KEY',
  SPEECH_MISTRAL_API_KEY: 'WOS_MISTRAL_API_KEY',
  SPEECH_GOOGLE_API_KEY: 'WOS_GEMINI_API_KEY', // + WOS_GOOGLE_API_KEY alias
  SPEECH_MICROSOFT_API_KEY: 'WOS_MICROSOFT_API_KEY', // + WOS_AZURE_API_KEY alias
  SPEECH_MICROSOFT_ENDPOINT: 'WOS_MICROSOFT_ENDPOINT',
}

export function resolveSpeechKey(name: SpeechKeyName): string {
  const env = process.env[ENV_BY_KEY[name]]
  if (env && env.trim()) return env.trim()
  // Documented aliases.
  if (name === 'SPEECH_GOOGLE_API_KEY' && process.env['WOS_GOOGLE_API_KEY']?.trim()) return process.env['WOS_GOOGLE_API_KEY']!.trim()
  if (name === 'SPEECH_MICROSOFT_API_KEY' && process.env['WOS_AZURE_API_KEY']?.trim()) return process.env['WOS_AZURE_API_KEY']!.trim()
  try {
    return getVault().get(name) ?? ''
  } catch {
    // Secure storage unavailable (e.g. basic_text backend) — treat as unset.
    return ''
  }
}

export function speechKeyStatus(): Record<SpeechKeyName, boolean> {
  const vault = (() => { try { return getVault() } catch { return null } })()
  const out = {} as Record<SpeechKeyName, boolean>
  for (const name of SPEECH_KEY_NAMES) {
    const envKey = ENV_BY_KEY[name]
    const envHit = Boolean(process.env[envKey]?.trim())
      || (name === 'SPEECH_GOOGLE_API_KEY' && Boolean(process.env['WOS_GOOGLE_API_KEY']?.trim()))
      || (name === 'SPEECH_MICROSOFT_API_KEY' && Boolean(process.env['WOS_AZURE_API_KEY']?.trim()))
    let vaultHit = false
    if (vault) {
      try { vaultHit = vault.list().some((s) => s.name === name) } catch { vaultHit = false }
    }
    out[name] = envHit || vaultHit
  }
  return out
}

export function setSpeechKey(name: SpeechKeyName, value: string): void {
  const trimmed = value.trim()
  const vault = getVault()
  if (!trimmed) vault.remove(name)
  else vault.set(name, trimmed)
}
