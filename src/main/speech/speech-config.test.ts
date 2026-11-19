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
