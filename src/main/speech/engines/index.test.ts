import { describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../../../shared/speech/defaults'
import { synthesizeFragment } from './index'
import { synthesizeLocal } from './local'

vi.mock('./kokoro', () => ({ assertKokoroInstalled: vi.fn() }))
vi.mock('../secrets', () => ({ resolveSpeechKey: () => 'test-key' }))
vi.mock('./openai', () => ({ synthesizeOpenAi: vi.fn(async () => Buffer.from([0, 0])) }))
vi.mock('./local', () => ({ synthesizeLocal: vi.fn(async () => ({ pcm: Buffer.from([0, 0]), sampleRate: 24000, channels: 1, bitsPerSample: 16 })) }))

describe('engine dispatch', () => {
  it('dispatches the active local profile', async () => {
    const audio = await synthesizeFragment('hello', defaultConfig(), new AbortController().signal)
    expect(audio.sampleRate).toBe(24000)
    expect(vi.mocked(synthesizeLocal).mock.calls.at(-1)?.[0].argsTemplate.slice(0, 2)).toEqual(['run', '--no-sync'])
  })
  it('returns a clear failure for unsupported engines', async () => {
    const cfg = defaultConfig()
    cfg.tts.profiles[0].engine = 'google'
    await expect(synthesizeFragment('hello', cfg, new AbortController().signal)).rejects.toThrow('not implemented')
  })
  it('dispatches OpenAI to PCM format', async () => {
    const cfg = defaultConfig()
    cfg.tts.profiles[0].engine = 'openai'
    expect(await synthesizeFragment('hello', cfg, new AbortController().signal)).toMatchObject({ channels: 1, bitsPerSample: 16, pcm: Buffer.from([0, 0]) })
  })
})
