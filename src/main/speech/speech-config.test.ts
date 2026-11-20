import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppConfig } from '../../shared/speech/types'
import { getConfig, replaceConfig, resetConfigCache, updateConfig } from './speech-config'

let dir: string
let previous: string | undefined
beforeEach(() => {
  previous = process.env.WOS_USERDATA_DIR
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-voice-test-'))
  process.env.WOS_USERDATA_DIR = dir
  resetConfigCache()
})
afterEach(() => {
  resetConfigCache()
  if (previous === undefined) delete process.env.WOS_USERDATA_DIR
  else process.env.WOS_USERDATA_DIR = previous
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('Voice configuration', () => {
  it('persists defaults and merges nested updates without losing siblings', () => {
    const original = getConfig()
    const updated = updateConfig({ playback: { volume: 50 } } as Partial<AppConfig>)
    expect(updated.playback.volume).toBe(50)
    expect(updated.playback.streaming_enabled).toBe(original.playback.streaming_enabled)
    resetConfigCache()
    expect(getConfig()).toEqual(updated)
  })
  it('defaults lookahead off for old configs even when the old streaming flag is true', () => {
    const file = path.join(dir, 'copyspeech', 'config.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ playback: { streaming_enabled: true } }))
    expect(getConfig().playback.prefetch_next_fragment).toBe(false)
    const config = getConfig()
    updateConfig({ playback: { ...config.playback, prefetch_next_fragment: true } })
    resetConfigCache()
    expect(getConfig().playback.prefetch_next_fragment).toBe(true)
    expect(() => replaceConfig({ playback: { prefetch_next_fragment: 'yes' } })).toThrow('invalid type')
  })
  it('does not expose a mutable reference to its cache', () => {
    getConfig().playback.volume = 42
    expect(getConfig().playback.volume).toBe(100)
  })
  it('rejects invalid updates without changing stored config', () => {
    getConfig()
    expect(() => updateConfig({ hud: { opacity: 2 } } as Partial<AppConfig>)).toThrow('opacity')
    resetConfigCache()
    expect(getConfig().hud.opacity).toBe(0.96)
  })
  it('rejects credentials in imported configs and HTTP headers', () => {
    expect(() => replaceConfig({ tts: { openai: { api_key: 'private' } } })).toThrow('secure vault')
    expect(() => replaceConfig({ tts: { http: { headers: [['Authorization', 'Bearer private']] } } })).toThrow('secure vault')
    expect(fs.existsSync(path.join(dir, 'copyspeech', 'config.json'))).toBe(false)
  })
  it('does not overwrite malformed configuration', () => {
    const file = path.join(dir, 'copyspeech', 'config.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{broken')
    expect(() => getConfig()).toThrow()
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken')
  })
})

describe('adversarial config inputs', () => {
  it('rejects malformed nested config and nonfinite numeric values', () => {
    expect(() => replaceConfig({ hotkey: { enabled: true, shortcut: 9 } })).toThrow('invalid type')
    expect(() => replaceConfig({ trigger: [] })).toThrow('object')
    expect(() => updateConfig({ playback: { volume: NaN } } as Partial<AppConfig>)).toThrow('invalid type')
  })
  it('rejects prototype keys without changing Object prototype', () => {
    expect(() => replaceConfig(JSON.parse('{"tts":{"__proto__":{"polluted":true}}}'))).toThrow('Invalid configuration key')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('config security regressions', () => {
  it('rejects malformed profiles, command arguments and numeric ranges', () => {
    expect(() => replaceConfig({ tts: { profiles: [null] } })).toThrow('profile must be an object')
    expect(() => replaceConfig({ tts: { profiles: [{ id: 'x' }] } })).toThrow('profile')
    expect(() => replaceConfig({ tts: { args_template: [null] } })).toThrow('only strings')
    expect(() => replaceConfig({ playback: { volume: 101 } })).toThrow('Volume')
    expect(() => replaceConfig({ playback: { on_retrigger: 'bogus' } })).toThrow('retrigger')
  })
  it('rejects credentials embedded in URLs without writing them', () => {
    for (const url of ['https://user:private@example.test/path', 'https://example.test/path?access_token=private', 'https://example.test/?api_key=private']) {
      expect(() => replaceConfig({ tts: { http: { url_template: url } } })).toThrow('secure vault')
    }
    expect(fs.existsSync(path.join(dir, 'copyspeech', 'config.json'))).toBe(false)
  })
  it('preserves an invalid on-disk file instead of silently overwriting it', () => {
    const file = path.join(dir, 'copyspeech', 'config.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const raw = '{"tts":{"profiles":[null]}}'
    fs.writeFileSync(file, raw)
    expect(() => getConfig()).toThrow('profile')
    expect(fs.readFileSync(file, 'utf8')).toBe(raw)
  })
})

describe('strict config schema', () => {
  it('rejects unknown fields, unsupported headers and request bodies', () => {
    expect(() => replaceConfig({ tts: { openai: { unreviewed: 'secret' } } })).toThrow('unsupported field')
    expect(() => replaceConfig({ tts: { http: { headers: [['X-Custom', 'secret']] } } })).toThrow('headers')
    expect(() => replaceConfig({ tts: { http: { body_template: '{"key":"secret"}' } } })).toThrow('templates')
    expect(() => replaceConfig({ tts: { http: { url_template: 'https://example.test/?signature=secret' } } })).toThrow('query')
    expect(fs.existsSync(path.join(dir, 'copyspeech', 'config.json'))).toBe(false)
  })
  it('rejects unknown profile and engine option keys', () => {
    const cfg = getConfig()
    const profile = cfg.tts.profiles[0]
    expect(() => replaceConfig({ tts: { profiles: [{ ...profile, private_data: 'secret' }] } })).toThrow('unsupported profile')
    expect(() => replaceConfig({ tts: { profiles: [{ ...profile, engine_options: { private_data: 'secret' } }] } })).toThrow('unsupported engine option')
  })
  it('replaces history retention variants instead of merging incompatible keys', () => {
    let cfg = updateConfig({ history: { enabled: true, auto_delete: { after_days: 30 } } })
    expect(cfg.history.auto_delete).toEqual({ after_days: 30 })
    resetConfigCache()
    expect(getConfig().history.auto_delete).toEqual({ after_days: 30 })
    cfg = updateConfig({ history: { enabled: true, auto_delete: 'never' } })
    expect(cfg.history.auto_delete).toBe('never')
    resetConfigCache()
    expect(getConfig().history.auto_delete).toBe('never')
  })
})
