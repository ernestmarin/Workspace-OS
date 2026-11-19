import { afterEach, describe, expect, it, vi } from 'vitest'
import { synthesizeOpenAi } from './openai'

const request = { text: 'Hello', voice: 'alloy', model: 'gpt-4o-mini-tts', apiKey: 'secret-key' }
afterEach(() => vi.unstubAllGlobals())

describe('OpenAI adapter', () => {
  it('posts to the fixed endpoint and returns PCM bytes', async () => {
    const mock = vi.fn().mockResolvedValue(new Response(new Uint8Array([0, 1, 2, 3])))
    vi.stubGlobal('fetch', mock)
    expect(await synthesizeOpenAi(request)).toEqual(Buffer.from([0, 1, 2, 3]))
    expect(mock.mock.calls[0][0]).toBe('https://api.openai.com/v1/audio/speech')
    const options = mock.mock.calls[0][1]
    expect(options.redirect).toBe('error')
    expect(JSON.parse(options.body)).toMatchObject({ input: 'Hello', response_format: 'pcm' })
  })
  it('does not expose a provider error body that could contain secrets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-key', { status: 401 })))
    await expect(synthesizeOpenAi(request)).rejects.toThrow('HTTP 401')
    await expect(synthesizeOpenAi(request)).rejects.not.toThrow('secret-key')
  })
  it('rejects empty, oversized and malformed audio', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1]))))
    await expect(synthesizeOpenAi(request)).rejects.toThrow('invalid PCM')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]), { headers: { 'content-length': '999999999' } })))
    await expect(synthesizeOpenAi(request)).rejects.toThrow('size limit')
    await expect(synthesizeOpenAi({ ...request, text: 'a'.repeat(4097) })).rejects.toThrow('4096')
  })
  it('passes cancellation to fetch', async () => {
    const controller = new AbortController()
    controller.abort()
    const mock = vi.fn((_url: string, options: RequestInit) => {
      expect(options.signal?.aborted).toBe(true)
      return Promise.reject(new Error('aborted'))
    })
    vi.stubGlobal('fetch', mock)
    await expect(synthesizeOpenAi({ ...request, signal: controller.signal })).rejects.toThrow('aborted')
  })
})
