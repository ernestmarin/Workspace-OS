import { describe, it, expect, vi } from 'vitest'
import { runRemoteOAuthFlow } from './remote-flow'
import type { OAuthFetch } from './remote-oauth'

/**
 * RT-04 (flow level) — a connector with CONFIGURED endpoints skips RFC 9728/8414
 * discovery, so nothing in the discovery parsers ever sees them. The sink guards
 * would still refuse them, but the user would be told "sign-in could not be
 * started" with no idea why. These fixtures pin the specific refusal and prove
 * no browser is opened and no request is made.
 */
const jsonRes = () => ({ ok: true, status: 200, json: async () => ({}) })

describe('runRemoteOAuthFlow endpoint refusal', () => {
  it('refuses a configured cleartext token endpoint before opening a browser', async () => {
    const openExternal = vi.fn(async () => {})
    const fetchFn = vi.fn(async () => jsonRes()) as unknown as OAuthFetch
    const result = await runRemoteOAuthFlow(
      {
        url: 'https://mcp.example/mcp',
        authorizationEndpoint: 'https://id.example/authorize',
        tokenEndpoint: 'http://id.example/token',
      },
      { fetchFn, clientId: 'cid', openExternal },
    )
    expect(result).toEqual({ ok: false, error: expect.stringContaining('https') })
    expect(openExternal).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a configured loopback authorization endpoint', async () => {
    const openExternal = vi.fn(async () => {})
    const result = await runRemoteOAuthFlow(
      {
        url: 'https://mcp.example/mcp',
        authorizationEndpoint: 'https://127.0.0.1:9000/authorize',
        tokenEndpoint: 'https://id.example/token',
      },
      { fetchFn: vi.fn() as unknown as OAuthFetch, clientId: 'cid', openExternal },
    )
    expect(result.ok).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })
})
