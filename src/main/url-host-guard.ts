/**
 * Host classification for URLs that arrive from untrusted content.
 *
 * This module exists because two independent call sites in the main process — the
 * remote-image proxy for mail and the remote MCP OAuth flow — must reach the
 * network on behalf of input we did not write, and both must refuse the same
 * set of hosts. Two copies of this logic would drift, and the copy that drifts
 * is the one that is wrong. Extracted verbatim from remote-images.ts (SEC-05),
 * where the IPv4-mapped/NAT64/6to4 coverage was already regression-tested.
 *
 * The caveat that applies to every caller is stated once, here: this checks the
 * LITERAL host. A DNS name that RESOLVES to a private address still gets
 * through, because Node's fetch does not expose resolution. That is a narrower
 * hole than an unchecked literal, and it is documented rather than hidden.
 */

/** Private, loopback, link-local, CGNAT, multicast and reserved IPv4. */
export function isBlockedIpv4Octets(a: number, b: number, c: number, _d: number): boolean {
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

/** Parses a (possibly compressed or IPv4-tailed) IPv6 literal into eight groups. */
export function parseIpv6Groups(h: string): number[] | null {
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

/**
 * True when a host must never be contacted on behalf of untrusted input.
 *
 * Covers the loopback interface (other local services, including this app's own
 * OnlyOffice port), the link-local metadata address cloud providers expose at
 * 169.254.169.254, unique-local/link-local IPv6, and anything on the private
 * ranges of the user's own network — in every spelling: dotted IPv4, compressed
 * IPv6, IPv4-mapped and IPv4-compatible, NAT64, and 6to4.
 */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true
  if (h === '::1' || h === '0.0.0.0' || h === '::') return true
  // IPv4 literals only — a hostname falls through to DNS, see the module note.
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
