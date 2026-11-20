import { describe, it, expect, vi } from 'vitest'
import {
  parseProtectedResource,
  parseAuthServerMetadata,
  discoverEndpoints,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  isSecureEndpointUrl,
  type OAuthFetch,
} from './remote-oauth'

/**
 * RT-04 — remote MCP OAuth endpoint trust.
 *
 * The endpoint URLs in this flow do not come from the user: they come from the
 * MCP server's own metadata documents and, at the moment of first contact, from
 * an origin we have no trust relationship with yet. Two of those URLs are then
 * handed to `shell.openExternal` and one receives the authorization code, the
 * PKCE verifier and (on refresh, forever after) the refresh token. Nothing in
 * the discovery path constrained their scheme, so `http:` metadata would have
 * put all of that on the wire in cleartext while the UI said "Connected".
 *
 * These are negative fixtures: each one is a document a hostile or merely
 * misconfigured server can return today.
 */

const jsonRes = (doc: unknown, status = 200): { ok: boolean; status: number; json: () => Promise<unknown> } => ({
  ok: status < 400,
  status,
  json: async () => doc,
})

describe('RT-04 isSecureEndpointUrl', () => {
  it('accepts only absolute https endpoints', () => {
    expect(isSecureEndpointUrl('https://sentry.io/oauth/token')).toBe(true)
    expect(isSecureEndpointUrl('https://sentry.io:8443/oauth/token')).toBe(true)
  })

  it('rejects cleartext, non-network schemes and user-info spoofing', () => {
    for (const bad of [
      'http://sentry.io/oauth/token',
      'http://127.0.0.1:3400/authorize',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<script>alert(1)</script>',
      'ws://sentry.io/token',
      'https://user:pass@sentry.io/token',
      'https://[::ffff:127.0.0.1]/token',
      '//sentry.io/token',
      '/relative/token',
      '',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isSecureEndpointUrl(bad)).toBe(false)
    }
  })
})

describe('RT-04 metadata documents cannot downgrade the flow', () => {
  it('ignores a cleartext authorization_server and keeps looking for a secure one', () => {
    expect(
      parseProtectedResource({
        resource: 'https://mcp.example/mcp',
        authorization_servers: ['http://attacker.example', 'https://id.example'],
      }),
    ).toEqual({ authServer: 'https://id.example', resource: 'https://mcp.example/mcp' })
  })

  it('rejects the protected-resource document when every auth server is insecure', () => {
    expect(parseProtectedResource({ authorization_servers: ['http://a.example', 'javascript:x'] })).toBeNull()
  })

  it('rejects an auth-server document with a cleartext token endpoint', () => {
    expect(
      parseAuthServerMetadata({
        authorization_endpoint: 'https://id.example/authorize',
        token_endpoint: 'http://id.example/token',
      }),
    ).toBeNull()
  })

  it('rejects an auth-server document with a non-network authorization endpoint', () => {
    expect(
      parseAuthServerMetadata({
        authorization_endpoint: 'file:///etc/passwd',
        token_endpoint: 'https://id.example/token',
      }),
    ).toBeNull()
  })

  it('does not follow an insecure authorization server during discovery', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('oauth-protected-resource')) {
        return jsonRes({ authorization_servers: ['http://id.example'] })
      }
      return jsonRes({ authorization_endpoint: 'https://id.example/a', token_endpoint: 'https://id.example/t' })
    }) as unknown as OAuthFetch
    const result = await discoverEndpoints('https://mcp.example/mcp', fetchFn)
    expect(result.ok).toBe(false)
    // It must not even ask the cleartext host for its metadata.
    expect((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
      'https://mcp.example/.well-known/oauth-protected-resource',
    ])
  })

  it('reports an unparseable server url as a typed failure, not a throw', async () => {
    const fetchFn = vi.fn() as unknown as OAuthFetch
    await expect(discoverEndpoints('not a url', fetchFn)).resolves.toMatchObject({ ok: false })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('RT-04 token sinks refuse insecure endpoints', () => {
  const tokens = (): OAuthFetch =>
    vi.fn(async () => jsonRes({ access_token: 'at', refresh_token: 'rt', expires_in: 60 })) as unknown as OAuthFetch

  it('will not post an authorization code to a cleartext token endpoint', async () => {
    const fetchFn = tokens()
    const result = await exchangeCode(
      { tokenEndpoint: 'http://id.example/token', code: 'c', verifier: 'v', clientId: 'cid', redirectUri: 'http://127.0.0.1:1' },
      fetchFn,
    )
    expect(result.ok).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('will not post a stored refresh token to a cleartext token endpoint', async () => {
    // A record written before this check existed (or by a modified store) must
    // still be refused at the sink; refresh runs unattended, forever.
    const fetchFn = tokens()
    const result = await refreshAccessToken(
      { tokenEndpoint: 'http://id.example/token', refreshToken: 'rt-secret', clientId: 'cid' },
      fetchFn,
    )
    expect(result.ok).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('keeps the error free of the secret it refused to send', async () => {
    const result = await refreshAccessToken(
      { tokenEndpoint: 'http://id.example/token', refreshToken: 'rt-super-secret', clientId: 'cid' },
      tokens(),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).not.toContain('rt-super-secret')
      expect(result.error.toLowerCase()).toContain('https')
    }
  })
})

describe('RT-04 buildAuthUrl', () => {
  it('refuses to build a consent url for an insecure authorization endpoint', () => {
    expect(() =>
      buildAuthUrl({
        authorizationEndpoint: 'http://id.example/authorize',
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:1234',
        codeChallenge: 'ch',
        state: 'st',
      }),
    ).toThrow(/https/i)
  })

  it('still builds a normal https consent url', () => {
    const url = buildAuthUrl({
      authorizationEndpoint: 'https://id.example/authorize?x=1',
      clientId: 'cid',
      redirectUri: 'http://127.0.0.1:1234',
      codeChallenge: 'ch',
      state: 'st',
      resource: 'https://mcp.example/mcp',
    })
    expect(url.startsWith('https://id.example/authorize?x=1&')).toBe(true)
    expect(url).toContain('code_challenge_method=S256')
  })
})

describe('RT-04 credential size ceiling', () => {
  const tokens = (): OAuthFetch =>
    vi.fn(async () => jsonRes({ access_token: 'at', expires_in: 60 })) as unknown as OAuthFetch

  it('refuses to forward a huge authorization code from the loopback listener', async () => {
    const fetchFn = tokens()
    const result = await exchangeCode(
      {
        tokenEndpoint: 'https://id.example/token',
        code: 'x'.repeat(4097),
        verifier: 'v',
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:1234',
      },
      fetchFn,
    )
    expect(result.ok).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('keeps the oversized value out of the error', async () => {
    const result = await exchangeCode(
      {
        tokenEndpoint: 'https://id.example/token',
        code: 'SECRET'.repeat(1000),
        verifier: 'v',
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:1234',
      },
      tokens(),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).not.toContain('SECRET')
  })

  it('still allows a realistically sized code', async () => {
    const fetchFn = tokens()
    const result = await exchangeCode(
      {
        tokenEndpoint: 'https://id.example/token',
        code: 'c'.repeat(512),
        verifier: 'v',
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:1234',
      },
      fetchFn,
    )
    expect(result.ok).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
