/**
 * The Voice config: typed, merged over defaults, atomically persisted to
 * userData/copyspeech/config.json. Auto-saved by every setConfig call.
 * In-memory snapshot is the single source of truth inside main; the renderer
 * reads it over IPC and mirrors it for display.
 */
import fs from 'fs'
import { defaultConfig, mergeWithDefaults } from '../../shared/speech/defaults'
import type { AppConfig } from '../../shared/speech/types'
import { ensureSpeechDirs, speechConfigPath } from './paths'

let cached: AppConfig | null = null

/** Reject common credential locations; credential storage belongs in the vault. */
function assertNoSecrets(value: unknown): void {
  if (typeof value === 'string') {
    // HTTP templates may contain placeholders; URL still parses them as path/query data.
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      try {
        const url = new URL(match[0])
        if (url.username || url.password || [...url.searchParams.keys()].some((key) => /^(?:api[_-]?key|access[_-]?token|token|secret|password|authorization)$/i.test(key))) {
          throw new Error('Credentials must be stored in the secure vault, not Voice config.')
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('secure vault')) throw error
        throw new Error('Invalid URL in Voice config')
      }
    }
    return
  }
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) {
      if (Array.isArray(item) && typeof item[0] === 'string' &&
          /^(authorization|proxy-authorization|x-api-key|api-key|cookie)$/i.test(item[0]) && item[1]) {
        throw new Error('Credentials must be stored in the secure vault, not Voice config.')
      }
      assertNoSecrets(item)
    }
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Invalid configuration key')
    if (/^(api_?key|secret|token|password)$/i.test(key) && entry) {
      throw new Error('Credentials must be stored in the secure vault, not Voice config.')
    }
    assertNoSecrets(entry)
  }
}

/** Optional fields absent from the fresh-install template but present in the public schema. */
const OPTIONAL_FIELDS: Record<string, Record<string, unknown>> = {
  'config.tts.openai': { instructions: '', response_format: '' },
  'config.tts.elevenlabs': { voice_name: '', voice_style: 0, use_speaker_boost: false, use_manual_voice_id: false },
  'config.tts.cartesia': { voice_name: '', encoding: '', use_manual_voice_id: false },
  'config.tts.fish': { voice_name: '' },
  'config.tts.xai': { voice_name: '', speed: 0 },
  'config.tts.mistral': { voice_name: '' },
}

/** Reject unknown keys before the merge; never silently persist unreviewed data. */
function validateShape(template: unknown, value: unknown, field = 'config'): void {
  if (field === 'config.history.auto_delete') {
    if (value === 'never') return
    if (!isPlainObject(value) || Object.keys(value).length !== 1) throw new Error('Invalid Voice config: history retention')
    const [key, n] = Object.entries(value)[0]
    if (!['keep_latest', 'after_days'].includes(key) || typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || n > 1000000) throw new Error('Invalid Voice config: history retention')
    return
  }
  if (field === 'config.tts.http.body_template' && value !== null && value !== '') {
    throw new Error('HTTP request templates are not supported in Voice config')
  }
  if (field === 'config.tts.http.url_template' && typeof value === 'string' && value.includes('?')) {
    throw new Error('HTTP URL query parameters are not supported in Voice config')
  }
  if (template === null) {
    if (value !== null && typeof value !== 'string') throw new Error(`Invalid Voice config: ${field} has an invalid type or value`)
    return
  }
  if (Array.isArray(template)) {
    if (!Array.isArray(value)) throw new Error(`Invalid Voice config: ${field} must be an array`)
    if (field === 'config.tts.profiles') {
      if (value.length > 100) throw new Error('Invalid Voice config: too many profiles')
      for (const profile of value) validateProfile(profile)
    } else if (field === 'config.tts.args_template') {
      if (value.length > 100 || value.some((arg) => typeof arg !== 'string' || arg.length > 4096)) throw new Error('Invalid Voice config: args_template must contain only strings')
    } else if (field === 'config.tts.http.headers' && value.length !== 0) {
      // Generic HTTP is not implemented yet. Never persist unclassified header secrets.
      throw new Error('HTTP headers are not supported in Voice config; use the secure vault')
    }
    return
  }
  if (typeof template === 'object') {
    if (!isPlainObject(value)) throw new Error(`Invalid Voice config: ${field} must be an object`)
    const allowed = { ...(template as Record<string, unknown>), ...(OPTIONAL_FIELDS[field] ?? {}) }
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(allowed, key)) throw new Error(`Invalid Voice config: unsupported field in ${field}`)
      validateShape(allowed[key], item, `${field}.${key}`)
    }
    return
  }
  if (typeof value !== typeof template || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new Error(`Invalid Voice config: ${field} has an invalid type or value`)
  }
}

const ENGINES = new Set(['local', 'http', 'openai', 'elevenlabs', 'cartesia', 'fish', 'xai', 'mistral', 'google', 'microsoft', 'kitten', 'qwen', 'piper', 'kokoro', 'pocket', 'tiny-voca'])
const EFFECTS = new Set(['none', 'walkie_talkie', 'game_boy', 'cyberpunk'])

function validateProfile(value: unknown): void {
  if (!isPlainObject(value)) throw new Error('Invalid Voice config: profile must be an object')
  const profileKeys = new Set(['id', 'name', 'description', 'engine', 'voice', 'voice_label', 'speed', 'pitch', 'effects', 'engine_options'])
  if (Object.keys(value).some((key) => !profileKeys.has(key))) throw new Error('Invalid Voice config: unsupported profile field')
  for (const field of ['id', 'name', 'voice'] as const) {
    if (typeof value[field] !== 'string' || value[field].length === 0 || value[field].length > 256) throw new Error(`Invalid Voice config: profile ${field}`)
  }
  for (const field of ['description', 'voice_label'] as const) {
    if (value[field] !== null && typeof value[field] !== 'string') throw new Error(`Invalid Voice config: profile ${field}`)
  }
  if (typeof value.engine !== 'string' || !ENGINES.has(value.engine)) throw new Error('Invalid Voice config: profile engine')
  for (const field of ['speed', 'pitch'] as const) {
    const n = value[field]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0.25 || n > 4) throw new Error(`Invalid Voice config: profile ${field}`)
  }
  if (!isPlainObject(value.effects) || Object.keys(value.effects).some((key) => !['enabled', 'active_effect'].includes(key)) || typeof value.effects.enabled !== 'boolean' || typeof value.effects.active_effect !== 'string' || !EFFECTS.has(value.effects.active_effect)) {
    throw new Error('Invalid Voice config: profile effects')
  }
  if (!isPlainObject(value.engine_options)) throw new Error('Invalid Voice config: profile options')
  const optionKeys: Record<string, string[]> = {
    local: ['command', 'args_template'], http: ['url_template', 'method', 'body_template', 'response_format', 'timeout_secs'],
    openai: ['model', 'response_format', 'instructions'], elevenlabs: ['model_id', 'output_format', 'stability', 'similarity_boost', 'style', 'use_speaker_boost'],
    cartesia: ['model_id', 'output_format', 'encoding', 'sample_rate'], fish: ['model', 'format'], xai: ['speed'], mistral: [],
    google: ['model', 'output_format'], microsoft: ['endpoint', 'model', 'output_format'],
    kitten: ['model', 'speed', 'cuda'], qwen: ['model', 'speed', 'cuda'], piper: ['model', 'cuda'], kokoro: ['speed', 'cuda'], pocket: ['cuda'], 'tiny-voca': [],
  }
  if (Object.keys(value.engine_options).some((key) => !optionKeys[value.engine as string]?.includes(key))) throw new Error('Invalid Voice config: unsupported engine option')
  for (const option of Object.values(value.engine_options)) {
    if (option !== null && typeof option !== 'string' && typeof option !== 'boolean' &&
        !(typeof option === 'number' && Number.isFinite(option)) &&
        !(Array.isArray(option) && option.every((v) => typeof v === 'string'))) {
      throw new Error('Invalid Voice config: profile option')
    }
  }
}

export function getConfig(): AppConfig {
  if (cached) return deepClone(cached)
  ensureSpeechDirs()
  let saved: unknown
  try {
    saved = JSON.parse(fs.readFileSync(speechConfigPath(), 'utf-8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const initial = defaultConfig()
    persist(initial)
    cached = initial
    return deepClone(initial)
  }
  assertNoSecrets(saved)
  validateShape(defaultConfig(), saved)
  const loaded = mergeWithDefaults(saved)
  const errors = validateConfig(loaded)
  if (errors.length) throw new Error(`Invalid Voice config: ${errors.join(' ')}`)
  cached = loaded
  return deepClone(loaded)
}

function persist(cfg: AppConfig): void {
  ensureSpeechDirs()
  const file = speechConfigPath()
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
}

/** Shallow-with-depth merge of a partial update over the live config, then persist. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/** Recursive merge of plain objects; arrays and scalars from `patch` win. */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : (patch as T))
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new Error('Invalid configuration key')
    out[k] = k === 'auto_delete' ? v : Object.hasOwn(out, k) ? deepMerge((base as Record<string, unknown>)[k], v) : v
  }
  return out as T
}

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  const base = getConfig()
  assertNoSecrets(patch)
  validateShape(defaultConfig(), patch)
  const next = mergeWithDefaults(deepMerge(deepClone(base), patch))
  assertNoSecrets(next)
  const errors = validateConfig(next)
  if (errors.length) throw new Error(`Invalid Voice config: ${errors.join(' ')}`)
  persist(next)
  cached = next
  return deepClone(next)
}

/** Replace the whole config (import). Validates by merging over defaults. */
export function replaceConfig(next: unknown): AppConfig {
  assertNoSecrets(next)
  validateShape(defaultConfig(), next)
  const config = mergeWithDefaults(next)
  const errors = validateConfig(config)
  if (errors.length) throw new Error(`Invalid Voice config: ${errors.join(' ')}`)
  persist(config)
  cached = config
  return deepClone(config)
}

export function resetConfigCache(): void {
  cached = null
}

function deepClone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T)
}

// ── Validation ───────────────────────────────────────────────────────────────

export function validateConfig(cfg: AppConfig): string[] {
  const errors: string[] = []
  if (!ENGINES.has(cfg.tts.active_backend)) errors.push('Invalid active engine.')
  if (!['interrupt', 'queue'].includes(cfg.playback.on_retrigger)) errors.push('Invalid retrigger mode.')
  if (!Number.isFinite(cfg.playback.volume) || cfg.playback.volume < 0 || cfg.playback.volume > 100) errors.push('Volume must be between 0 and 100.')
  if (cfg.trigger.double_copy_window_ms < 100) errors.push('Double-copy window must be at least 100 ms.')
  if (cfg.trigger.max_text_length < 100) errors.push('Max text length must be at least 100 characters.')
  if (!(cfg.hud.opacity >= 0 && cfg.hud.opacity <= 1)) errors.push('HUD opacity must be between 0 and 1.')
  if (cfg.hud.width < 50 || cfg.hud.height < 20) errors.push('HUD is too small.')
  if (cfg.pagination.fragment_size < 100) errors.push('Fragment size must be at least 100 characters.')
  if (cfg.hotkey.enabled && cfg.hotkey.shortcut.trim().length === 0) {
    errors.push('Global shortcut is enabled but empty.')
  }
  if (cfg.hotkey.enabled && !/(ctrl|control|alt|shift|super|meta|cmd|command)/i.test(cfg.hotkey.shortcut)) {
    errors.push('Global shortcut needs at least one modifier (Ctrl, Alt, Shift or Super).')
  }
  return errors
}
