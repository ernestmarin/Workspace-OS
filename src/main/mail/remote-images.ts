/**
 * Fetches a message's remote images in MAIN and returns them as data: URIs.
 *
 * Why here rather than letting the reader iframe load them directly:
 *
 * The reader body is a srcdoc document, and a srcdoc document INHERITS the
 * embedder's CSP. Policies compose by intersection, so the reader's opt-in
 * `img-src data: https:` was silently narrowed back to `data:` by the app-wide
 * policy, which has no `https:`. The "Load images" button was wired correctly
 * and the load was refused one layer up — it could never have worked.
 *
 * The alternatives were to widen `img-src` app-wide (granting every surface
 * remote image loading to fix one iframe) or to move the body onto its own
 * scheme with its own header CSP. Fetching here needs no CSP change at all,
 * because `data:` is already allowed — and it leaks LESS to the sender than the
 * original design, since the request carries no cookies and no referrer.
 *
 * It does introduce one risk the browser was implicitly handling: these URLs
 * come from an untrusted message, and a main-process fetch can reach hosts the
 * renderer could not. Everything in `isFetchableUrl` exists for that reason.
 */

/** Injectable so the bounds and the SSRF guard are unit-testable without a network. */
export type ImageFetch = (url: string, signal: AbortSignal) => Promise<{
  ok: boolean
  status: number
  contentType: string | null
  bytes: () => Promise<ArrayBuffer>
}>

/** Media types allowed to become a data: URI. Mirrors the inline-image list. */
const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/avif',
])

export const LIMITS = {
  /** Per message. A newsletter with more images than this is already abusive. */
  maxImages: 60,
  /** Per image. */
  maxBytes: 5 * 1024 * 1024,
  /** Across the whole message, so 60 images cannot each be 5 MB. */
  maxTotalBytes: 20 * 1024 * 1024,
  /** Per request, so one dead host cannot hang the button forever. */
  timeoutMs: 10_000,
}

/**
 * Hostnames that must never be fetched on behalf of a message.
 *
 * A message is attacker-controlled input, and main can reach things the
 * renderer cannot: the loopback interface (other local services, including this
 * app's own OnlyOffice port), the link-local metadata address that cloud
 * providers expose at 169.254.169.254, and anything on the private ranges of
 * the user's own network. Without this, `<img src="http://192.168.1.1/reboot">`
 * in an email becomes a request the user's router actually receives.
 *
 * Checked on the literal host. A DNS name that RESOLVES to a private address
 * still gets through — closing that needs resolution-time checking, which Node's
 * fetch does not expose. Noted rather than hidden: it is a narrower hole than
 * the one being closed, and the response is never shown to the sender.
 */
function isBlockedIpv4Octets(a: number, b: number, c: number, _d: number): boolean {
  if (a === 127 || a === 10 || a === 0) return true
  if (a === 100 && b >= 64 && b <= 127) return true // RFC 6598 CGNAT (100.64.0.0/10)
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true
  if (a === 203 && b === 0 && c === 113) return true
  if (a === 169 && b === 254) return true // link-local + cloud metadata
  if (a >= 224) return true // multicast and reserved
  return false
}

function parseIpv6Groups(h: string): number[] | null {
  let addr = h
  const zoneIdx = addr.indexOf('%')
  if (zoneIdx !== -1) addr = addr.slice(0, zoneIdx)
  // Handle trailing dotted IPv4 inside IPv6 (if not already canonicalised by URL).
  const v4Tail = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr)
  if (v4Tail) {
    const octets = [Number(v4Tail[2]), Number(v4Tail[3]), Number(v4Tail[4]), Number(v4Tail[5])]
    if (octets.some((o) => o > 255)) return null
    const hi = ((octets[0] << 8) | octets[1]).toString(16)
    const lo = ((octets[2] << 8) | octets[3]).toString(16)
    addr = `${v4Tail[1]}${hi}:${lo}`
  }
  if (!addr.includes(':')) return null
  const parts = addr.split('::')
  if (parts.length > 2) return null
  const left = parts[0] ? parts[0].split(':') : []
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : []
  const missing = 8 - (left.length + right.length)
  if (parts.length === 1 ? missing !== 0 : missing < 1) return null
  const full = [...left, ...Array<string>(parts.length === 2 ? missing : 0).fill('0'), ...right]
  if (full.length !== 8) return null
  const groups: number[] = []
  for (const g of full) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null
    groups.push(parseInt(g, 16))
  }
  return groups
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true
  if (h === '::1' || h === '0.0.0.0' || h === '::') return true
  // IPv4 literals only — a hostname falls through to DNS, see the caveat above.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (m) {
    const [a, b, c, d] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
    if ([a, b, c, d].some((o) => o > 255)) return true
    return isBlockedIpv4Octets(a, b, c, d)
  }
  const v6 = parseIpv6Groups(h)
  if (v6) {
    const [g0, g1, g2, g3, g4, g5, g6, g7] = v6
    const allZeroPrefix5 = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0
    // Unspecified (::) and loopback (::1)
    if (allZeroPrefix5 && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true
    // Unique-local fc00::/7, link-local fe80::/10, multicast ff00::/8, doc 2001:db8::/32
    if ((g0 & 0xfe00) === 0xfc00) return true
    if ((g0 & 0xffc0) === 0xfe80) return true
    if ((g0 & 0xff00) === 0xff00) return true
    if (g0 === 0x2001 && g1 === 0x0db8) return true
    const checkPair = (hi: number, lo: number): boolean =>
      isBlockedIpv4Octets((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff)
    // IPv4-mapped (::ffff:0:0/96), IPv4-compatible (::/96), IPv4-translated (::ffff:0:0:0/96)
    if (allZeroPrefix5 && (g5 === 0xffff || g5 === 0)) return checkPair(g6, g7)
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) return checkPair(g6, g7)
    // NAT64 well-known (64:ff9b::/96) and local-use (64:ff9b:1::/48)
    if (g0 === 0x0064 && g1 === 0xff9b && ((g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) || g2 === 1)) {
      return checkPair(g6, g7)
    }
    // 6to4 (2002::/16) embeds IPv4 in g1:g2
    if (g0 === 0x2002) return checkPair(g1, g2)
  }
  return false
}

/**
 * Normalises a URL from message markup, or returns null if it must not be fetched.
 *
 * Protocol-relative `//host/x.png` is resolved to https rather than dropped:
 * the sanitizer deliberately captures it, and promoting it back inside a srcdoc
 * document would resolve it against the app's own scheme instead.
 */
export function normaliseImageUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const candidate = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed
  let u: URL
  try {
    u = new URL(candidate)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (isBlockedHost(u.hostname)) return null
  return u.toString()
}

export interface LoadResult {
  /** Original URL (as it appeared in the markup) → data: URI. Misses are absent. */
  images: Record<string, string>
  /** How many were requested, fetched, and refused — surfaced for the UI. */
  requested: number
  loaded: number
  failed: number
}

/**
 * Fetches each URL and returns a data: URI for the ones that came back as a
 * real image within the limits. A failure is never fatal: a broken image in a
 * newsletter must not stop the other twenty from painting.
 */
export async function loadRemoteImages(urls: string[], doFetch: ImageFetch): Promise<LoadResult> {
  const seen = new Set<string>()
  const wanted: { original: string; url: string }[] = []
  for (const raw of urls) {
    if (wanted.length >= LIMITS.maxImages) break
    const url = normaliseImageUrl(raw)
    if (!url || seen.has(url)) continue
    seen.add(url)
    wanted.push({ original: raw, url })
  }

  const images: Record<string, string> = {}
  let total = 0
  let failed = 0

  // Sequential on purpose: a message with sixty images should not open sixty
  // sockets at once, and the total-bytes ceiling has to be checked against a
  // running sum rather than raced.
  for (const { original, url } of wanted) {
    if (total >= LIMITS.maxTotalBytes) {
      failed += 1
      continue
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), LIMITS.timeoutMs)
    try {
      const res = await doFetch(url, ctrl.signal)
      if (!res.ok) {
        failed += 1
        continue
      }
      const type = (res.contentType ?? '').split(';')[0].trim().toLowerCase()
      if (!ALLOWED_TYPES.has(type)) {
        failed += 1
        continue
      }
      const buf = Buffer.from(await res.bytes())
      if (buf.length === 0 || buf.length > LIMITS.maxBytes || total + buf.length > LIMITS.maxTotalBytes) {
        failed += 1
        continue
      }
      total += buf.length
      // The type is re-emitted from the allow-list, never echoed from the
      // response, so a hostile Content-Type cannot smuggle another media type.
      images[original] = `data:${type};base64,${buf.toString('base64')}`
    } catch {
      failed += 1
    } finally {
      clearTimeout(timer)
    }
  }

  return { images, requested: wanted.length, loaded: Object.keys(images).length, failed }
}

/**
 * The real network adapter.
 *
 * No cookies and no referrer, so opting in to images tells the sender only that
 * the message was opened — not who, and not with what session.
 *
 * Redirects are followed MANUALLY, re-checking the host allow-list on every hop
 * (bounded). `redirect: 'follow'` used to re-apply only the content/size checks,
 * NOT the host block — so a CDN that answered a first-party image URL with a 302
 * to http://192.168.1.1/… or 169.254.169.254 sent that internal request anyway
 * (blind SSRF). Manual following closes that: a Location pointing at a blocked
 * host is refused instead of fetched.
 */
const MAX_IMAGE_REDIRECTS = 5

export const netImageFetch: ImageFetch = async (url, signal) => {
  let current = url
  for (let hop = 0; ; hop++) {
    const res = await fetch(current, {
      method: 'GET',
      signal,
      redirect: 'manual',
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
      headers: { Accept: 'image/*' },
    })
    // Not a redirect → this is the response.
    if (res.status < 300 || res.status >= 400 || !res.headers.get('location')) {
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get('content-type'),
        bytes: () => res.arrayBuffer(),
      }
    }
    if (hop >= MAX_IMAGE_REDIRECTS) return { ok: false, status: 508, contentType: null, bytes: async () => new ArrayBuffer(0) }
    // Resolve the Location against the current URL, then re-run the SAME guard
    // the initial URL passed — scheme + host allow-list.
    let next: string
    try { next = new URL(res.headers.get('location') as string, current).toString() } catch { return { ok: false, status: 502, contentType: null, bytes: async () => new ArrayBuffer(0) } }
    const safe = normaliseImageUrl(next)
    if (!safe) return { ok: false, status: 403, contentType: null, bytes: async () => new ArrayBuffer(0) }
    current = safe
  }
}
