/**
 * Default CopySpeech configuration (fresh installs). Mirrors CopySpeech's
 * serde defaults, with the integration's choices: Kokoro as the seeded local
 * engine, English locale unset (system detection), tray and global hotkey off,
 * history on. API keys never live here.
 */
import type { AppConfig, EngineOptionValue, VoiceProfile } from './types'

export const KOKORO_PROFILE_ID = 'profile-kokoro-default'

export function defaultKokoroProfile(): VoiceProfile {
  return {
    id: KOKORO_PROFILE_ID,
    name: 'Kokoro',
    description: null,
    engine: 'kokoro',
    voice: 'af_heart',
    voice_label: 'Heart (US · female)',
    speed: 1.0,
    pitch: 1.0,
    effects: { enabled: false, active_effect: 'none' },
    engine_options: {},
  }
}

export function engineOptionsFor(engine: string): Record<string, EngineOptionValue> {
  switch (engine) {
    case 'kokoro': return { lang_code: 'a', device: 'auto' }
    case 'piper': return { gpu: false }
    case 'kitten': return {}
    case 'qwen': return {}
    case 'pocket': return {}
    case 'tiny-voca': return {}
    default: return {}
  }
}

export function defaultConfig(): AppConfig {
  const kokoro = defaultKokoroProfile()
  return {
    trigger: { listen_enabled: true, double_copy_window_ms: 1500, max_text_length: 100_000 },
    tts: {
      active_backend: 'kokoro',
      active_profile_id: kokoro.id,
      profiles: [kokoro],
      preset: 'kokoro',
      command: 'uv',
      args_template: [
        'run', '--project', '{engine_dir}/kokoro', 'python',
        '{engine_dir}/kokoro/scripts/copyspeech-kokoro.py',
        '--text-file', '{input}', '--voice', '{voice}', '--output', '{output}',
      ],
      voice: 'af_heart',
      openai: { api_key: '', model: 'gpt-4o-mini-tts', voice: 'alloy', response_format: 'mp3' },
      elevenlabs: {
        api_key: '', voice_id: '21m00Tcm4TlvDq8ikWAM', model_id: 'eleven_turbo_v2_5',
        output_format: 'mp3_44100_128', voice_stability: 0.5, voice_similarity_boost: 0.75,
      },
      cartesia: {
        api_key: '', model_id: 'sonic-2', voice_id: 'f786b574-daa5-4673-9f66-5b70a587deff',
        output_format: 'wav', sample_rate: 24000,
      },
      fish: { api_key: '', model: 's1', voice_id: '', format: 'mp3' },
      xai: { api_key: '', voice_id: '' },
      mistral: { api_key: '', voice_id: '' },
      google: { api_key: '', model: 'gemini-3.8-flash-tts', voice_name: 'Kore', output_format: 'audio/wav' },
      microsoft: { api_key: '', endpoint: '', model: 'mai-voice-2', voice_name: 'en-US-AriaNeural', output_format: 'mp3' },
      http: { profile_id: '', url_template: '', method: 'POST', headers: [], body_template: null, voice: '', response_format: 'wav', timeout_secs: 30 },
      daemon_idle_timeout_secs: 600,
    },
    playback: { on_retrigger: 'interrupt', volume: 100, streaming_enabled: true, caption_animation: true },
    hud: { enabled: true, position: 'bottom-center', width: 560, height: 64, opacity: 0.96 },
    general: {
      show_tray_icon: false,
      history_enabled: true,
      launch_on_login: false,
      read_agent_replies: false,
      highlight_in_browser: true,
      locale: '',
      effects_enabled: false,
    },
    output: { enabled: false, directory: '', filename_pattern: '{timestamp}-{voice}-{seq}', format: 'wav' },
    sanitization: {
      enabled: true,
      markdown: {
        enabled: true,
        strip_headers: true,
        strip_code_blocks: true,
        strip_inline_code: false,
        strip_links: true,
        // Bold/italic markers are kept by default: engines can use them as spoken emphasis.
        strip_bold_italic: false,
        strip_lists: true,
        strip_blockquotes: true,
      },
      tts_normalization: { enabled: true },
    },
    pagination: { enabled: true, fragment_size: 1200 },
    history: { enabled: true, auto_delete: { keep_latest: 1000 } },
    hotkey: { enabled: false, shortcut: '' },
  }
}

/** Merge a persisted (possibly partial/older) config over the defaults, key by key. */
export function mergeWithDefaults(saved: unknown): AppConfig {
  const base = defaultConfig()
  if (!saved || typeof saved !== 'object') return base
  const s = saved as Record<string, unknown>
  const merge = <T>(def: T, val: unknown): T => {
    if (val === undefined || val === null) return def
    if (typeof def === 'object' && def !== null && !Array.isArray(def) && typeof val === 'object') {
      const out: Record<string, unknown> = { ...(def as Record<string, unknown>) }
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        out[k] = k in out ? merge((def as Record<string, unknown>)[k], v) : v
      }
      return out as T
    }
    return val as T
  }
  return {
    trigger: merge(base.trigger, s.trigger),
    tts: merge(base.tts, s.tts),
    playback: merge(base.playback, s.playback),
    hud: merge(base.hud, s.hud),
    general: merge(base.general, s.general),
    output: merge(base.output, s.output),
    sanitization: merge(base.sanitization, s.sanitization),
    pagination: merge(base.pagination, s.pagination),
    history: merge(base.history, s.history),
    hotkey: merge(base.hotkey, s.hotkey),
  }
}
