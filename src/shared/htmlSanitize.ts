/**
 * Conservative, DOM-free HTML sanitizer shared by BOTH surfaces that render
 * untrusted-ish HTML: the mail reader (main bundle) and the markdown preview /
 * chat replies (renderer bundle).
 *
 * Why one module instead of two copies
 * ------------------------------------
 * It used to live twice — `src/main/mail/message-parser.ts` and
 * `src/renderer/src/lib/sanitizeHtml.ts` — with a comment promising the copies
 * "cannot behave differently". They already had: the mail copy gained the
 * anchor-promotion pass and the renderer copy did not, and every future fix
 * would have had to be applied twice or silently drift. The only reason for the
 * duplication was bundling (the renderer must not drag `mailparser` in), and a
 * dependency-free module in `src/shared` solves that without the drift.
 *
 * Defence in depth, not the only barrier: the mail reader renders the result in
 * a `sandbox="allow-popups"` iframe (no scripts), the markdown preview in a
 * `sandbox=""` iframe with `default-src 'none'`, and the print window is a
 * JavaScript-disabled `BrowserWindow`.
 *
 * Attribute-context model
 * -----------------------
 * The previous version reasoned about markup as text: a regex removed `on*`
 * attributes only when a SPACE preceded them, removed `javascript:` only when
 * the scheme was written literally, and re-emitted the parked remote URL inside
 * `data-blocked-src="…"` verbatim. Three consequences, all reproduced:
 *
 *   1. `<img src="…" alt="a'onerror='code'x='">` — a single quote inside a
 *      DOUBLE-quoted value is legal HTML; the element keeps a live handler.
 *   2. `<img src='…"onerror="code'>` — the parked URL carried the delimiter and
 *      closed the attribute it was written into.
 *   3. `jav&#x61;script:` / `java&Tab;script:` / `java\nscript:` — the browser
 *      decodes entities and drops embedded ASCII whitespace before parsing a
 *      scheme, so the literal-scheme regex missed them. Same for `file:` and
 *      `data:` resource loads, and for `<source src>` / SVG `<image href>`,
 *      which no pass looked at.
 *
 * So this module now reads START TAGS as attribute lists: it tokenizes
 * attributes at real boundaries (whitespace, `/`, or a closing quote), removes
 * every `on*` handler whatever its separator or quoting, neutralises dangerous
 * schemes AFTER canonicalisation (entity decode, whitespace/control strip), and
 * re-emits values with `<`, `>`, `"` and `'` escaped so a value can never close
 * the attribute it lives in. Remote loads are parked in inert `data-blocked-*`
 * attributes so the URL survives for an explicit opt-in load.
 *
 * Deliberately NOT escaped: `&`. Values legitimately arrive with entities
 * already in them (`?a=1&amp;b=2`), and re-encoding `&` would corrupt the URL
 * into `&amp;amp;` — a sanitiser that mangles real links is not safer.
 */

export interface SanitizeOptions {
  /**
   * Give http(s) anchors `target="_blank" rel="noopener noreferrer"` so a click
   * becomes a window-open request the host can route into the in-app browser.
   * Used by the mail reader; the markdown preview leaves anchors alone.
   */
  promoteAnchors?: boolean
}

export interface SanitizeResult {
  html: string
  hadRemote: boolean
}

/** Elements dropped whole, with everything they contain. */
const DROP_TAGS = [
  'script', 'style', 'iframe', 'object', 'embed', 'applet', 'noscript',
  'template', 'frame', 'frameset', 'svg', 'math', 'form', 'meta', 'link', 'base',
]

/**
 * Schemes that may never appear in a resource/navigation attribute.
 *
 * `data:` is deliberately allowed: the mail reader promotes the bytes main
 * fetched for an approved remote image into a `data:` URI, and a `data:` image
 * cannot run script in an `<img>`. `cid:` and relative targets stay allowed
 * because inline attachments and workspace pages rely on them.
 */
const DANGEROUS_SCHEME = /^(?:javascript|vbscript|file|jar|livescript|blob|about):/i

/** Attributes whose value the browser treats as a URL it will fetch or follow. */
const URL_ATTRS = new Set([
  'src', 'srcset', 'background', 'poster', 'href', 'xlink:href', 'data',
  'action', 'formaction', 'cite', 'longdesc', 'usemap', 'ping', 'manifest',
])

/** Attributes that park a remote URL for an explicit, later opt-in load. */
const PARKABLE_ATTRS = new Set(['src', 'srcset', 'background', 'poster'])

const REMOTE_URL = /^(?:https?:)?\/\//i

/**
 * A `data:image/*` URI produced by `inlineCidImages` for an attachment the
 * message itself carries. Parking it would blank out an inline logo the reader
 * already holds the bytes for; an `<img>` with a data: URI cannot execute.
 */
const INLINED_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|bmp|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=\s]*$/i

export function isInlinedImage(raw: string): boolean {
  return INLINED_IMAGE.test(raw.trim())
}

/**
 * Canonicalise the way a browser does before it decides what a URL means:
 * decode character references, then drop ASCII whitespace and control
 * characters that a parser ignores inside a scheme.
 */
export function canonicaliseUrl(raw: string): string {
  return raw
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&(tab|newline|colon);/gi, '')
    .replace(/[\u0000-\u0020\u007f-\u009f\u00a0\u2028\u2029\ufeff]/g, '')
}

/** True when the attribute value is a load the reader must approve first. */
export function isRemoteUrl(raw: string): boolean {
  return REMOTE_URL.test(raw.trim())
}

/** True when the value uses a scheme that must never be armed. */
export function isDangerousUrl(raw: string): boolean {
  return DANGEROUS_SCHEME.test(canonicaliseUrl(raw))
}

const escapeValue = (value: string): string =>
  value
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** One attribute of a start tag. `name` is lower-cased. */
interface Attr {
  name: string
  value: string | null
}

/**
 * Tokenize the attribute list of a start tag.
 *
 * Boundaries are whitespace, `/`, or the closing quote of the previous value —
 * the last one is what makes `alt="y"onerror="code"` two attributes instead of
 * one, which is exactly how a browser reads it.
 */
export function parseAttrs(body: string): { attrs: Attr[]; selfClosing: boolean } {
  const attrs: Attr[] = []
  let i = 0
  const n = body.length
  while (i < n) {
    const ch = body[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '/') {
      i += 1
      continue
    }
    if (ch === '>') {
      i += 1
      continue
    }
    const nameStart = i
    // A name ends at whitespace, at the `=` that introduces its value, or at
    // the delimiters a tag may use in place of a space.
    while (i < n && !/[\s"'>/=]/.test(body[i])) i += 1
    const name = body.slice(nameStart, i).toLowerCase()
    if (!name) {
      i += 1
      continue
    }
    let j = i
    while (j < n && /[\s]/.test(body[j])) j += 1
    if (body[j] === '=') {
      j += 1
      while (j < n && /\s/.test(body[j])) j += 1
      const quote = body[j]
      if (quote === '"' || quote === "'") {
        const close = body.indexOf(quote, j + 1)
        const end = close === -1 ? n : close
        attrs.push({ name, value: body.slice(j + 1, end) })
        i = close === -1 ? n : close + 1
      } else {
        const start = j
        while (j < n && !/[\s>]/.test(body[j])) j += 1
        attrs.push({ name, value: body.slice(start, j) })
        i = j
      }
    } else {
      attrs.push({ name, value: null })
      i = j
    }
  }
  const selfClosing = /\/\s*$/.test(body)
  return { attrs, selfClosing }
}

/**
 * Walk the fragment and rewrite every START tag, leaving text and end tags
 * alone.
 *
 * A character scan rather than one big regular expression: a tag ends at the
 * first `>` OUTSIDE a quoted value, which is exactly the rule a browser uses
 * and exactly what a backreference-free regex gets wrong on payloads like
 * `title="q'onmouseover='x"`. Being explicit here is what lets the attribute
 * tokenizer below trust the tag it is handed.
 */
function rewriteTags(html: string, state: { hadRemote: boolean }, opts: SanitizeOptions): string {
  let out = ''
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) {
      out += html.slice(i)
      break
    }
    out += html.slice(i, lt)
    // Comment / doctype / processing instruction: not a start tag.
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt)
      const stop = end === -1 ? html.length : end + 1
      out += html.slice(lt, stop)
      i = stop
      continue
    }
    // End tag: copied as-is, the rewrite only concerns start tags.
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt)
      const stop = end === -1 ? html.length : end + 1
      out += html.slice(lt, stop)
      i = stop
      continue
    }
    if (!/[a-zA-Z]/.test(html[lt + 1] ?? '')) {
      // A stray `<` is text, not markup.
      out += '<'
      i = lt + 1
      continue
    }
    let j = lt + 1
    let quote: string | null = null
    while (j < html.length) {
      const ch = html[j]
      if (quote) {
        if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === '>') {
        break
      }
      j += 1
    }
    const stop = j < html.length ? j + 1 : html.length
    out += rewriteStartTag(html.slice(lt, stop), state, opts)
    i = stop
  }
  return out
}

/** Rewrite one start tag: drop handlers, neutralise schemes, park remote loads. */
function rewriteStartTag(tag: string, state: { hadRemote: boolean }, opts: SanitizeOptions): string {
  const open = /^<([a-zA-Z][-a-zA-Z0-9:_]*)/.exec(tag)
  if (!open) return tag
  const tagName = open[1].toLowerCase()
  const isAnchor = tagName === 'a'
  const { attrs, selfClosing } = parseAttrs(tag.slice(open[0].length))

  const kept: string[] = []
  let hadHref = false
  let isHttpHref = false
  for (const attr of attrs) {
    // Event handlers, whatever the separator and quoting that introduced them.
    if (/^on/.test(attr.name)) continue
    // Inline style can still import/point at remote content; the url() pass
    // below neutralises those, and @import has no business in a value here.
    if (attr.name === 'style') {
      if (attr.value === null) continue
      // CSS is rewritten, not HTML-escaped: `url('')` must stay a CSS function.
      // A style value is the one place a quote is structurally harmless, and
      // any `<` that survives is what the sandboxed/CSP-locked document is for.
      kept.push(`style="${neutraliseRemoteCss(attr.value, state).replace(/"/g, '&quot;')}"`)
      continue
    }
    if (!URL_ATTRS.has(attr.name) || attr.value === null) {
      kept.push(attr.value === null ? attr.name : `${attr.name}="${escapeValue(attr.value)}"`)
      continue
    }
    const value = attr.value
    if (isDangerousUrl(value)) {
      // A dangerous scheme is not merely parked: there is no legitimate
      // "load it on request" for javascript:/file:.
      kept.push(`${attr.name}="#"`)
      continue
    }
    if (PARKABLE_ATTRS.has(attr.name) && isRemoteUrl(value) && !isInlinedImage(value)) {
      state.hadRemote = true
      kept.push(`data-blocked-${attr.name}="${escapeValue(value)}"`)
      continue
    }
    if (attr.name === 'href' && isAnchor) {
      hadHref = true
      isHttpHref = /^(?:https?:)?\/\//i.test(attr.value.trim())
    }
    kept.push(`${attr.name}="${escapeValue(value)}"`)
  }

  // Anchor promotion (mail reader): the click must arrive as a window-open the
  // host can route, never as an in-iframe navigation the sandbox swallows.
  //
  // A document-supplied `target`/`rel` is DROPPED, not shadowed. HTML keeps the
  // last occurrence of a duplicated attribute, but relying on that ordering is
  // an accident waiting for the next refactor: `target="_self" rel="opener"`
  // must simply not be in the output at all.
  if (opts.promoteAnchors && isAnchor && hadHref) {
    const narrowed = kept.filter((a) => !/^(?:target|rel)="/i.test(a))
    kept.length = 0
    kept.push(...narrowed)
    if (isHttpHref) {
      kept.push('target="_blank"')
      kept.push('rel="noopener noreferrer"')
    }
  }

  const body = kept.length ? ` ${kept.join(' ')}` : ''
  return `<${open[1]}${body}${selfClosing ? ' /' : ''}>`
}

/** `url(...)` inside a style value → a blocked placeholder; flags `hadRemote`. */
function neutraliseRemoteCss(value: string, state: { hadRemote: boolean }): string {
  let out = value.replace(/@import\b[^;]*;?/gi, '')
  const remote = /url\(\s*(['"]?)(?:https?:)?\/\/[^)]*\)/gi
  if (remote.test(out)) {
    state.hadRemote = true
    out = out.replace(remote, "url('')")
  }
  return out
}

/**
 * Sanitize an HTML fragment for display.
 *
 * Never throws: a malformed fragment is sanitized as far as it can be, and the
 * caller still renders it inside a sandboxed, CSP-locked document.
 */
export function sanitizeHtml(input: string, options: SanitizeOptions = {}): SanitizeResult {
  const state = { hadRemote: false }
  if (typeof input !== 'string' || !input) return { html: '', hadRemote: false }
  let html = input

  // 1. Comments are removed outright: nothing legitimate in a mail body or a
  //    note needs them, and they are a classic place to hide half a tag.
  html = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '')

  // 2. Drop elements that can execute, embed, or re-enter the app.
  for (const tag of DROP_TAGS) {
    html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), '')
    html = html.replace(new RegExp(`</?${tag}\\b[^>]*>`, 'gi'), '')
  }

  // 3. Rewrite every remaining start tag as an attribute list.
  html = rewriteTags(html, state, options)

  return { html, hadRemote: state.hadRemote }
}
