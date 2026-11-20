/**
 * PURE, Electron-free OAuth 2.1 logic for REMOTE (Streamable-HTTP) MCP servers.
 *
 * Path B: WE own the OAuth (PKCE loopback, reusing the email flow) against the
 * MCP server's own authorization server and store the refresh token in our
 * vault. The `claude` CLI gets a fresh bearer at connect time via our
 * `headersHelper` (wos-mcp-token) — we never rely on the CLI's own buggy OAuth
 * persistence.
 *
 * This module contains NO I/O of its own — every network call is performed via
 * an INJECTED `fetchFn`, so discovery + token exchange/refresh are unit-testable
 * without touching a real server. It never logs and treats every token as
 * sensitive (callers persist only the refresh token, safeStorage-encrypted).
 *
 * Metadata discovery follows RFC 9728 (protected-resource metadata) →
 * RFC 8414 (authorization-server metadata). A connector may also carry
 * pre-configured endpoints, which short-circuit discovery.
 */

import { isBlockedHost } from '../../url-host-guard'

/** Minimal fetch surface — a GET-and-POST superset of the mail FetchFn. */
export type OAuthFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/** The endpoints needed to run PKCE + refresh against a server's auth server. */
export interface OAuthEndpoints {
  /** RFC 8414 `authorization_endpoint`. */
  authorizationEndpoint: string
  /** RFC 8414 `token_endpoint`. */
  tokenEndpoint: string
  /** RFC 9728 `resource` identifier (audience), when known. */
  resource?: string
  /** OAuth registration/client id to use in the PKCE flow (public). */
  clientId?: string
}

/** A resolved token set from an exchange/refresh. */
export interface RemoteTokenSet {
  accessToken: string
  refreshToken?: string
  /** Absolute epoch-ms at which the access token expires. */
  expiresAt: number
}

export type OAuthResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

function ok<T>(value: T): OAuthResult<T> {
  return { ok: true, value }
}
function fail<T>(error: string): OAuthResult<T> {
  return { ok: false, error }
}

// ── Endpoint trust ───────────────────────────────────────────────────────────

/**
 * Is this OAuth endpoint safe to send credentials or the user's browser to?
 *
 * The endpoint URLs here are supplied by the MCP server's own metadata — a party
 * we have no trust relationship with at first contact — and two of them are
 * handed to `shell.openExternal` while the third receives the authorization
 * code, the PKCE verifier, and then the stored refresh token on every unattended
 * refresh. Nothing downstream can repair a bad endpoint, so the check lives at
 * the boundary: the discovery parsers and the two token sinks.

 * Deliberately strict: absolute `https:` only, no `http:` exception even for
 * loopback. The redirect URI in the PKCE flow is our own loopback listener and
 * is never passed through here; a server that only speaks cleartext OAuth is a
 * server whose tokens would travel in the clear, so it is refused instead of
 * downgraded. User-info (`https://user:pass@host`) is refused too: it makes the
 * displayed and the connected host differ, and we never render these URLs.
 */
export function isSecureEndpointUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false
  // Reject control characters and whitespace, which URL() would otherwise trim.
  if (/[\x00-\x20\x7f]/.test(value)) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username !== '' || url.password !== '') return false
  if (!url.hostname) return false
  // Loopback/private/link-local literals are refused even over https: an
  // authorization server on the user's own machine or LAN is not something a
  // remote MCP server's metadata may redirect a browser and a refresh token to.
  // Same classification as the mail image proxy (SEC-05), deliberately shared.
  if (isBlockedHost(url.hostname)) return false
  return true
}

// ── Metadata discovery ───────────────────────────────────────────────────────

interface ProtectedResourceMetadata {
  authorization_servers?: unknown
  resource?: unknown
}
interface AuthServerMetadata {
  authorization_endpoint?: unknown
  token_endpoint?: unknown
  registration_endpoint?: unknown
}

/** Joins an origin with a well-known suffix, tolerating a path on the base URL. */
function wellKnown(baseUrl: string, suffix: string): string {
  const u = new URL(baseUrl)
  return `${u.origin}${suffix}`
}

async function getJson(
  fetchFn: OAuthFetch,
  url: string,
): Promise<unknown | null> {
  try {
    const res = await fetchFn(url, { method: 'GET', headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Parses an RFC 9728 protected-resource metadata document into the auth-server
 * URL(s) + resource id. Pure — separated so a fixture can exercise it directly.
 */
export function parseProtectedResource(
  doc: unknown,
): { authServer: string; resource?: string } | null {
  if (!doc || typeof doc !== 'object') return null
  const m = doc as ProtectedResourceMetadata
  const servers = Array.isArray(m.authorization_servers) ? m.authorization_servers : []
  // Skip insecure entries rather than failing the whole document: a server may
  // list both, and the secure one is the only one we could ever use.
  const first = servers.find((s) => isSecureEndpointUrl(s))
  if (typeof first !== 'string') return null
  const resource = typeof m.resource === 'string' ? m.resource : undefined
  return { authServer: first, resource }
}

/**
 * Parses an RFC 8414 authorization-server metadata document into the endpoints
 * we need. Pure — fixture-testable.
 */
export function parseAuthServerMetadata(doc: unknown): {
  authorizationEndpoint: string
  tokenEndpoint: string
} | null {
  if (!doc || typeof doc !== 'object') return null
  const m = doc as AuthServerMetadata
  // Both endpoints are required, and both must be https: a document that offers
  // a cleartext token endpoint is not a downgrade we accept, it is a refusal.
  if (!isSecureEndpointUrl(m.authorization_endpoint) || !isSecureEndpointUrl(m.token_endpoint)) {
    return null
  }
  return { authorizationEndpoint: m.authorization_endpoint, tokenEndpoint: m.token_endpoint }
}

/**
 * Discovers a remote MCP server's OAuth endpoints: RFC 9728
 * `/.well-known/oauth-protected-resource` on the MCP URL origin → the named
 * authorization server's RFC 8414 metadata. Returns the endpoints or an error.
 */
export async function discoverEndpoints(
  mcpUrl: string,
  fetchFn: OAuthFetch,
): Promise<OAuthResult<OAuthEndpoints>> {
  let prDoc: unknown
  try {
    prDoc = await getJson(fetchFn, wellKnown(mcpUrl, '/.well-known/oauth-protected-resource'))
  } catch {
    // `wellKnown` throws on an unparseable URL; a typed failure keeps the flow's
    // "never throws" contract and keeps the bad input out of an error string.
    return fail('Could not discover the server’s OAuth metadata.')
  }
  const pr = parseProtectedResource(prDoc)
  if (!pr) return fail('Could not discover the server’s OAuth metadata.')

  // RFC 8414: metadata lives at <issuer-origin>/.well-known/oauth-authorization-server
  const asDoc = await getJson(
    fetchFn,
    wellKnown(pr.authServer, '/.well-known/oauth-authorization-server'),
  )
  const as = parseAuthServerMetadata(asDoc)
  if (!as) return fail('The server’s authorization metadata was unreadable.')

  return ok({
    authorizationEndpoint: as.authorizationEndpoint,
    tokenEndpoint: as.tokenEndpoint,
    resource: pr.resource ?? mcpUrl,
  })
}

// ── Authorization URL ────────────────────────────────────────────────────────

/**
 * Builds the OAuth 2.1 consent URL (PKCE S256). `resource` is included per
 * RFC 8707 (resource indicators) so the token is audience-bound to this MCP
 * server. `scopes` may be empty (server default).
 */
export function buildAuthUrl(params: {
  authorizationEndpoint: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string
  scopes?: string[]
  resource?: string
}): string {
  if (!isSecureEndpointUrl(params.authorizationEndpoint)) {
    // The consent URL is opened in the user's real browser. A cleartext or
    // non-network endpoint here is a phishing surface, so building it is refused.
    throw new Error('Refusing to open a consent URL for a non-https authorization endpoint')
  }
  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    state: params.state,
  })
  if (params.scopes && params.scopes.length > 0) qs.set('scope', params.scopes.join(' '))
  if (params.resource) qs.set('resource', params.resource)
  const sep = params.authorizationEndpoint.includes('?') ? '&' : '?'
  return `${params.authorizationEndpoint}${sep}${qs.toString()}`
}

// ── Token exchange / refresh ─────────────────────────────────────────────────

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
}

/**
 * Ceiling on any single credential-shaped field we forward to a token endpoint.
 *
 * The authorization `code` arrives on a loopback HTTP listener that any local
 * process can reach, and the client id/refresh token come from stored records.
 * A real value is well under a kilobyte; anything far larger is a caller trying
 * to make this process the origin of an arbitrarily large POST. Refused rather
 * than truncated, because a truncated credential is not a credential.
 */
const MAX_CREDENTIAL_LENGTH = 4096

function oversizedCredential(body: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string' && value.length > MAX_CREDENTIAL_LENGTH) return key
  }
  return null
}

async function postToken(
  fetchFn: OAuthFetch,
  tokenEndpoint: string,
  body: Record<string, string>,
): Promise<OAuthResult<RemoteTokenSet>> {
  // Last line of defence, and the one that matters for unattended refreshes: a
  // token endpoint restored from an older record is checked again here, so a
  // cleartext endpoint can never receive the refresh token. The error names the
  // requirement and never the secret.
  if (!isSecureEndpointUrl(tokenEndpoint)) {
    return fail('The token endpoint is not a valid https URL; refusing to send credentials.')
  }
  if (oversizedCredential(body)) {
    // The field name only — never the value, which may be a live credential.
    return fail('The authorization server request was rejected: a credential field was oversized.')
  }
  let res: { ok: boolean; status: number; json: () => Promise<unknown> }
  try {
    res = await fetchFn(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body).toString(),
    })
  } catch {
    return fail('Could not reach the authorization server.')
  }
  let data: TokenResponse
  try {
    data = ((await res.json()) as TokenResponse) ?? {}
  } catch {
    return fail('The authorization server returned an unreadable response.')
  }
  if (!res.ok || data.error || !data.access_token) {
    // Surface the coarse code only — never echo a description (may leak params).
    return fail(data.error ? `authorization failed (${data.error})` : 'authorization failed')
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  const set: RemoteTokenSet = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  }
  if (data.refresh_token) set.refreshToken = data.refresh_token
  return ok(set)
}

/** Exchanges an authorization `code` (+ PKCE verifier) for a token set. */
export function exchangeCode(
  params: {
    tokenEndpoint: string
    code: string
    verifier: string
    clientId: string
    redirectUri: string
    resource?: string
  },
  fetchFn: OAuthFetch,
): Promise<OAuthResult<RemoteTokenSet>> {
  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    code: params.code,
    code_verifier: params.verifier,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
  }
  if (params.resource) body.resource = params.resource
  return postToken(fetchFn, params.tokenEndpoint, body)
}

/**
 * Refreshes an access token from a stored refresh token. Some servers rotate
 * the refresh token; when a new one is returned the caller MUST persist it.
 */
export function refreshAccessToken(
  params: {
    tokenEndpoint: string
    refreshToken: string
    clientId: string
    resource?: string
  },
  fetchFn: OAuthFetch,
): Promise<OAuthResult<RemoteTokenSet>> {
  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  }
  if (params.resource) body.resource = params.resource
  return postToken(fetchFn, params.tokenEndpoint, body)
}
