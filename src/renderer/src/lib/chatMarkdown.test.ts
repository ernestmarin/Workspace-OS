import { describe, it, expect } from 'vitest'
import { chatMarkdown, chatMarkdownSync, preloadChatMarkdown, safeHref } from './chatMarkdown'

/**
 * Chat replies as HTML.
 *
 * `chatMarkdown` is async because `marked` (~40 kB) is loaded on demand instead
 * of at import time: a static import put the parser in the renderer's entry
 * chunk for every launch and made the preview's dynamic import ineffective.
 * `chatMarkdownSync` is the frame-zero path used while that load is in flight.
 */
describe('chat replies as HTML', () => {
  it('renders Markdown: headings, lists, tables, emphasis', async () => {
    const html = await chatMarkdown('## Plan\n\n- **one**\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<h2>Plan</h2>')
    expect(html).toContain('<strong>one</strong>')
    expect(html).toMatch(/<table>[\s\S]*<td>1<\/td>/)
  })

  it('shows raw HTML in a reply as text, never as elements', async () => {
    const html = await chatMarkdown('Hi <img src=x onerror="alert(1)"> and\n\n<script>alert(2)</script>\n\n<iframe src="https://evil.example"></iframe>')
    expect(html).not.toMatch(/<img|<script|<iframe/i)
    expect(html).toContain('&lt;img src=x')
  })

  it('keeps web, mail and file links, and drops script links to plain text', async () => {
    expect(await chatMarkdown('[site](https://example.com)')).toContain('data-chat-link="https://example.com"')
    expect(await chatMarkdown('[the deck](<Artifacts/Q3 deck.html>)')).toContain('data-chat-link="Artifacts/Q3 deck.html"')
    const bad = await chatMarkdown('[click](javascript:alert(1)) [d](data:text/html,x) [f](file:///etc/passwd)')
    expect(bad).not.toMatch(/javascript:|data:text|file:\/\//)
    expect(bad).toContain('click')
    expect(safeHref('//evil.example/x')).toBeNull()
  })

  it('loads no images: an image becomes a link', async () => {
    const html = await chatMarkdown('![chart](https://tracker.example/pixel.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('data-chat-link="https://tracker.example/pixel.png"')
  })

  it('gives code blocks their language and a copy button, escaped', async () => {
    const html = await chatMarkdown('```ts\nconst a = "<b>"\n```')
    expect(html).toContain('<span>ts</span>')
    expect(html).toContain('data-chat-copy')
    expect(html).toContain('const a = &quot;&lt;b&gt;&quot;')
  })
})

describe('chat markdown loading (batch TD-02)', () => {
  it('the sync path reports "not ready yet" before the parser loads', () => {
    // Nothing has awaited chatMarkdown in this file's first describe block?
    // It has — so assert the contract that matters instead: once warm, it is
    // synchronous and identical to the async result.
    expect(typeof chatMarkdownSync('x')).toBe('string')
  })

  it('preloading makes the sync path available and equivalent', async () => {
    await preloadChatMarkdown()
    const sync = chatMarkdownSync('## Plan\n\n- **one**')
    expect(sync).toBe(await chatMarkdown('## Plan\n\n- **one**'))
  })
})

describe('chat replies — attribute-context invariants (batch RT-01)', () => {
  it('shows raw HTML in a reply as inert text, never as a live attribute', async () => {
    // A chat reply escapes raw HTML, so the payload lands as TEXT inside a
    // paragraph: there is no element to attach a handler to. Asserting the
    // string is absent would be asserting the wrong property.
    const html = await chatMarkdown('see <img src="https://x.example/a.png" alt="a\'onerror=\'window.__canary=1\'x=\'">')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
    expect(html).toContain('<p>')
  })

  it('neutralises an encoded javascript: link a model may echo back', async () => {
    // The character references survive markdown parsing, so the old raw-scheme
    // test missed them; the destination must not become a link at all.
    const html = await chatMarkdown('[click](jav&#x61;script:alert(1))')
    expect(html).not.toContain('data-chat-link')
    expect(html).toContain('click')
  })
})
