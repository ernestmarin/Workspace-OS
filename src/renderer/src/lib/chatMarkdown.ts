import type { Marked, Tokens } from 'marked'
import { sanitizeHtml } from './sanitizeHtml'
import { canonicaliseUrl, isDangerousUrl } from '../../../shared/htmlSanitize'

/**
 * A chat reply, as HTML the app can show in its own window.
 *
 * Unlike the note preview (sanitized AND isolated in a sandboxed iframe), a
 * chat message renders in the app's own DOM, next to the workspace bridge, and
 * a reply can carry text a web page planted. So the only tags in the output
 * are the ones marked writes for Markdown: raw HTML in a reply is shown as
 * text, never parsed; links keep only web, mail and workspace-file targets;
 * images become links (nothing loads from the network). The regex sanitizer
 * then runs once more as a second net.
 *
 * Links carry `data-chat-link`: the view opens web links in the in-app browser
 * and file paths on the stage. Code blocks carry a copy button.
 */

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Where a link may go: the web, mail, or a file (absolute or workspace-relative path). Null: shown as text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim()
  // A markdown destination keeps its source form: `jav&#x61;script:` reaches
  // here literally, and the browser would decode it into a working `javascript:`.
  // Canonicalise BEFORE deciding, exactly like the shared HTML sanitizer does.
  if (isDangerousUrl(href) || canonicaliseUrl(href).startsWith('data:')) return null
  if (/^(https?:|mailto:)/i.test(href)) return href
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null // javascript:, data:, file:, vbscript:…
  if (!href || href.startsWith('//')) return null
  return href
}

/**
 * Built on first use, not at import time.
 *
 * `marked` is ~40 kB of parser. It used to be a static import here, which put it
 * in the renderer's entry chunk for every launch — and, because the markdown
 * preview loads `marked` dynamically, made Rollup report the dynamic import in
 * `markdownPreview.ts` as ineffective (the module was already in another chunk).
 * Loading it the same way in both places fixes the chunking and keeps the
 * parser out of the boot path. The renderer's chat view is already async.
 */
let markedInstance: Marked | null = null

async function markdownRenderer(): Promise<Marked> {
  if (markedInstance) return markedInstance
  const { Marked } = await import('marked')
  markedInstance = new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      html(t: Tokens.HTML | Tokens.Tag): string {
        return esc(t.text)
      },
      link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, t: Tokens.Link): string {
        const text = this.parser.parseInline(t.tokens)
        const href = safeHref(t.href)
        return href ? `<a href="#" data-chat-link="${esc(href)}" title="${esc(href)}">${text}</a>` : text
      },
      image(t: Tokens.Image): string {
        const href = safeHref(t.href)
        const label = esc(t.text || t.href)
        return href ? `<a href="#" data-chat-link="${esc(href)}">${label}</a>` : label
      },
      code(t: Tokens.Code): string {
        const lang = (t.lang ?? '').split(/\s/)[0]
        return `<div class="chat-code"><div class="chat-code-head"><span>${esc(lang)}</span><button type="button" data-chat-copy>Copy</button></div><pre><code>${esc(t.text)}</code></pre></div>`
      },
    },
  })
  return markedInstance
}

/** Markdown a chat reply may render, as sanitized HTML. Never throws. */
export async function chatMarkdown(md: string): Promise<string> {
  const renderer = await markdownRenderer()
  return sanitizeHtml(renderer.parse(md, { async: false }) as string).html
}

/**
 * Synchronous form for a caller that cannot await (a `useMemo` over a message
 * list). Returns `null` until `marked` has finished loading once, and the caller
 * keeps showing the previous/plain rendering for that frame.
 */
export function chatMarkdownSync(md: string): string | null {
  if (!markedInstance) return null
  return sanitizeHtml(markedInstance.parse(md, { async: false }) as string).html
}

/** Warm the parser ahead of the first message that needs it. */
export async function preloadChatMarkdown(): Promise<void> {
  await markdownRenderer()
}
