import { describe, it, expect } from 'vitest'
import { CONTENT_CSP, COMPOSE_CSP, contentDocument, promoteRemoteContent, parkedRemoteUrls } from './previewCsp'
import { sanitizeHtml } from './sanitizeHtml'

/**
 * The document policies these surfaces render under, and the remote-content
 * promotion step that follows them.
 *
 * These are regression tests for two silent breakages: a policy that forbids
 * something the app itself produces (an inline `cid:` image, a `data:` video)
 * looks like a broken feature rather than a blocked request.
 */
describe('preview CSP policies (batch RT-02)', () => {
  const directives = (csp: string): Record<string, string> =>
    Object.fromEntries(
      csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
        const [name, ...rest] = d.split(/\s+/)
        return [name, rest.join(' ')]
      }),
    )

  it('runs no script and loads no remote resource on any surface', () => {
    for (const csp of [CONTENT_CSP, COMPOSE_CSP]) {
      const d = directives(csp)
      expect(d['default-src']).toBe("'none'")
      expect(d['script-src']).toBe("'none'")
      expect(d['connect-src']).toBe("'none'")
      expect(d['object-src']).toBe("'none'")
      expect(d['frame-src']).toBe("'none'")
      // Nothing may leave the document.
      expect(d['form-action']).toBe("'none'")
      expect(d['base-uri']).toBe("'none'")
    }
  })

  it('permits the inline image forms the sanitizer itself produces', () => {
    for (const csp of [CONTENT_CSP, COMPOSE_CSP]) {
      const d = directives(csp)
      expect(d['img-src']).toContain('data:')
      expect(d['img-src']).toContain('cid:')
      expect(d['media-src']).toContain('data:')
      expect(d['style-src']).toBe("'unsafe-inline'")
    }
  })

  it('matches the bytes a mail body actually carries after sanitization', () => {
    // A parked remote image is inert (data-blocked-*), so the policy is not the
    // barrier there; what matters is that a promoted data: URI is permitted and
    // that a cid: reference survives unchanged for the reader to resolve.
    const { html } = sanitizeHtml('<img src="https://x.example/a.png"><img src="cid:logo1">')
    expect(html).toContain('data-blocked-src="https://x.example/a.png"')
    expect(html).toContain('src="cid:logo1"')
    expect(directives(CONTENT_CSP)['img-src']).toContain('cid:')
  })

  it('builds one complete sandboxed document with the policy inside it', () => {
    const doc = contentDocument('<p>x</p>', CONTENT_CSP, 'body{color:#000}')
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(doc).toContain(`content="${CONTENT_CSP}"`)
    expect(doc).toContain('<p>x</p>')
  })
})

describe('promoteRemoteContent (batch RT-02)', () => {
  it('substitutes only the data: bytes main approved', () => {
    const html = '<img data-blocked-src="https://x.example/a.png">'
    const out = promoteRemoteContent(html, { 'https://x.example/a.png': 'data:image/png;base64,AAA' })
    expect(out).toContain('src="data:image/png;base64,AAA"')
    expect(out).not.toContain('data-blocked-src')
  })

  it('leaves a URL main did NOT approve inert', () => {
    const html = '<img data-blocked-src="https://x.example/a.png">'
    expect(promoteRemoteContent(html, {})).toBe(html)
  })

  it('refuses to promote a non-data: payload into an attribute', () => {
    // A compromised or buggy map must not become an arbitrary-URL injection.
    const html = '<img data-blocked-src="https://x.example/a.png">'
    const out = promoteRemoteContent(html, { 'https://x.example/a.png': 'https://evil.example/x.js' })
    expect(out).toBe(html)
  })

  it('reports the parked URLs so main can be asked for them', () => {
    const html =
      '<img data-blocked-src="https://x.example/a.png">' +
      '<video data-blocked-poster="https://x.example/p.jpg"></video>'
    expect(parkedRemoteUrls(html).sort()).toEqual([
      'https://x.example/a.png',
      'https://x.example/p.jpg',
    ])
  })

  it('cannot be talked into promoting a quote-breaking value', () => {
    const html = sanitizeHtml('<img src=\'https://x.example/a.png"onerror="window.__canary=1\'>').html
    const urls = parkedRemoteUrls(html)
    // Whatever gets parked is a single, intact attribute value.
    for (const url of urls) expect(url).not.toContain('"')
    const out = promoteRemoteContent(html, Object.fromEntries(urls.map((u) => [u, 'data:image/png;base64,AA'])))
    expect(/["']\s*on[a-z]+\s*=/i.test(out)).toBe(false)
  })
})
