/**
 * CopySpeech configuration, shared verbatim between the main process, the
 * preload bridge and the renderer. These are the types persisted in
 * `userData/copyspeech/config.json` — plain JSON, no comments, no secrets
 * (API keys live in the OS keychain, see main/secrets).
 *
 * Ported from CopySpeech (src/lib/types.ts) with the fields this integration
 * owns. `post_process` is deliberately absent: the LLM rewrite pass is not
 * part of this integration.
 */

export type SupportedLocale = 'en' | 'es' | 'ar' | 'he' | 'de' | 'fr' | 'hi' | 'ru' | 'zh'
export type HudPresetPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'
export type RetriggerMode = 'interrupt' | 'queue'

export type TtsEngine =
  | 'local' | 'http'
  | 'openai' | 'elevenlabs' | 'cartesia' | 'fish' | 'xai' | 'mistral' | 'google' | 'microsoft'
  | 'kitten' | 'qwen' | 'piper' | 'kokoro' | 'pocket' | 'tiny-voca'
export type AudioFormat = 'wav' | 'mp3' | 'ogg' | 'flac'
export type EffectId = 'none' | 'walkie_talkie' | 'game_boy' | 'cyberpunk'

export type EngineOptionValue = string | number | boolean | string[] | null

export interface TriggerConfig {
  listen_enabled: boolean
  double_copy_window_ms: number
  max_text_length: number
}
export interface OpenAIConfig { api_key: string; model: string; voice: string; instructions?: string; response_format?: string }
export interface ElevenLabsConfig {
  api_key: string
  voice_id: string
  voice_name?: string
  model_id: string
  output_format: string
  voice_stability: number
  voice_similarity_boost: number
  voice_style?: number
  use_speaker_boost?: boolean
  use_manual_voice_id?: boolean
}
export interface CartesiaConfig {
  api_key: string
  model_id: string
  voice_id: string
  voice_name?: string
  output_format: string
  encoding?: string
  sample_rate?: number
  use_manual_voice_id?: boolean
}
export interface FishConfig { api_key: string; model: string; voice_id: string; voice_name?: string; format: string }
export interface XaiConfig { api_key: string; voice_id: string; voice_name?: string; speed?: number }
export interface MistralConfig { api_key: string; voice_id: string; voice_name?: string }
export interface GoogleTtsConfig { api_key: string; model: string; voice_name: string; output_format: string }
export interface MicrosoftTtsConfig { api_key: string; endpoint: string; model: string; voice_name: string; output_format: string }
export interface HttpTtsConfig {
  profile_id: string
  url_template: string
  method: string
  headers: [string, string][]
  body_template: string | null
  voice: string
  response_format: string
  timeout_secs: number
}
export interface TtsConfig {
  active_backend: TtsEngine
  active_profile_id: string
  profiles: VoiceProfile[]
  preset: string
  command: string
  args_template: string[]
  voice: string
  openai: OpenAIConfig
  elevenlabs: ElevenLabsConfig
  cartesia: CartesiaConfig
  fish: FishConfig
  xai: XaiConfig
  mistral: MistralConfig
  google: GoogleTtsConfig
  microsoft: MicrosoftTtsConfig
  http?: HttpTtsConfig
  /** Idle-shutdown timeout for resident local daemons, seconds. 0 = never. */
  daemon_idle_timeout_secs?: number
}

export interface ProfileEffects { enabled: boolean; active_effect: EffectId }
export interface VoiceProfile {
  id: string
  name: string
  description: string | null
  engine: TtsEngine
  voice: string
  voice_label: string | null
  speed: number
  pitch: number
  effects: ProfileEffects
  engine_options: Record<string, EngineOptionValue>
}

export interface EngineOptionDescriptor {
  key: string; label: string; kind: string; help: string
  default_value: EngineOptionValue; choices?: string[]
}
export interface VoiceCatalogEntry {
  id: string; label: string; language: string | null; description: string | null
  gender: string | null; preview_url: string | null; tags: string[]
}
export interface EngineCatalogEntry {
  engine: string; label: string; description: string; docs_url: string
  supports_voice_refresh: boolean; supports_pitch: boolean; supports_captions: boolean
  supports_bracket_emotes: boolean
  options: EngineOptionDescriptor[]; voices: VoiceCatalogEntry[]
}

export interface PlaybackConfig { on_retrigger: RetriggerMode; volume: number; streaming_enabled: boolean; caption_animation: boolean }
export interface HudConfig { enabled: boolean; position: HudPresetPosition; width: number; height: number; opacity: number }

export interface GeneralConfig {
  /** Menu bar (tray) icon; opt-in. */
  show_tray_icon: boolean
  /** Master switch for the Voice history store. */
  history_enabled: boolean
  /** Launch the app at login. */
  launch_on_login: boolean
  /** Read each finished agent reply aloud (agents' own Claude Code runs only). */
  read_agent_replies: boolean
  /** Injected word-level highlight into the in-app Browser while it reads. */
  highlight_in_browser: boolean
  locale: SupportedLocale | ''
  effects_enabled: boolean
}

export interface OutputConfig { enabled: boolean; directory: string; filename_pattern: string; format: AudioFormat }
export interface MarkdownSanitizationConfig {
  enabled: boolean
  strip_headers: boolean
  strip_code_blocks: boolean
  strip_inline_code: boolean
  strip_links: boolean
  strip_bold_italic: boolean
  strip_lists: boolean
  strip_blockquotes: boolean
}
export interface SanitizationConfig { enabled: boolean; markdown: MarkdownSanitizationConfig; tts_normalization: { enabled: boolean } }
export interface PaginationConfig { enabled: boolean; fragment_size: number }
export type AutoDeleteMode = { keep_latest: number } | 'never' | { after_days: number }
export interface HistoryConfig { enabled: boolean; auto_delete: AutoDeleteMode }
export interface HotkeyConfig { enabled: boolean; shortcut: string }

export interface AppConfig {
  trigger: TriggerConfig
  tts: TtsConfig
  playback: PlaybackConfig
  hud: HudConfig
  general: GeneralConfig
  output: OutputConfig
  sanitization: SanitizationConfig
  pagination: PaginationConfig
  history: HistoryConfig
  hotkey: HotkeyConfig
}

/** What a speak() call carries besides the text. */
export interface SpeakOptions {
  /** Where the text came from: clipboard trigger, explicit UI action, control server, agent. */
  source?: 'clipboard' | 'ui' | 'control-server' | 'agent' | 'browser' | 'mail' | 'notes' | 'office'
  /** Bypass streaming and synthesize the whole fragment in one request. */
  forceBatch?: boolean
  /** Which reading this belongs to (control server request id). */
  requestId?: string
}
export type SpeakResult = { ok: true; readingId: number } | { ok: false; error: string }

export type SpeechEngineStatus = 'idle' | 'warming' | 'ready' | 'error'
export interface SpeechStatus {
  /** True while a reading is being synthesized or played. */
  speaking: boolean
  synthesizing: boolean
  engine: TtsEngine | null
  profileName: string | null
  /** 1-based fragment counters for the current reading. */
  fragment: number
  fragmentTotal: number
  /** Reading id (0 when nothing active). */
  readingId: number
  paused: boolean
}

/** Events pushed from main to renderer windows as `speech:event`. */
export type SpeechEvent =
  | { type: 'state'; status: SpeechStatus }
  | { type: 'audio-chunk'; readingId: number; fragmentIndex: number; fragmentTotal: number; sampleRate: number; channels: number; bitsPerSample: number; pcmBase64: string; text?: string; fragmentDurationMs?: number }
  | { type: 'captions'; readingId: number; fragmentIndex: number; alignment: import('./captions').CaptionAlignment }
  | { type: 'fragment-end'; readingId: number; fragmentIndex: number; fragmentTotal: number }
  | { type: 'reading-end'; readingId: number; finished: boolean }
  | { type: 'error'; readingId: number; message: string }
  | { type: 'truncated'; readingId: number; originalLength: number; truncatedLength: number; maxLength: number }
