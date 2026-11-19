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

/** Never store credentials supplied through an import or config update. */
function assertNoSecrets(value: unknown): void {
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
    if (/^(api_?key|secret|token|password)$/i.test(key) && entry) {
      throw new Error('Credentials must be stored in the secure vault, not Voice config.')
    }
    assertNoSecrets(entry)
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
    out[k] = k in out ? deepMerge((base as Record<string, unknown>)[k], v) : v
  }
  return out as T
}

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  const base = getConfig()
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
