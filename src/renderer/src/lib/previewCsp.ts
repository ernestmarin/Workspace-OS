/**
 * Content-Security-Policy strings for the documents this app builds itself.
 *
 * They live in one module, with tests, because the interesting failures here
 * are silent: a policy that forbids something the app relies on makes a feature
 * look broken rather than blocked. Two of those have already happened —
 *
 *   1. The rich-mail compose preview allowed `img-src` but not `media-src`, so
 *      an `embedded.attachments` image set into a `<video>` could never load.
 *   2. The markdown preview allowed `img-src data:` only, but the shared
 *      sanitizer (like the mail reader's) allows `cid:` and same-document
 *      fragment targets. Any inline image a note carried was dead on arrival.
 *
 * Every policy is `default-src 'none'` — no script, no stylesheet, no font and
 * no frame from anywhere it did not explicitly earn. `form-action 'none'` and
 * `base-uri 'none'` close the two remaining ways for content to leave the
 * document: posting a form somewhere, and rebasing every relative URL.
 */

/** Shared tail: nothing may navigate, submit, or re-base. */
const TAIL = "object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none';"

/**
 * Policy for a rendered mail body or a rendered markdown preview: static
 * content plus images, inline styling and data-URI fonts, and nothing else.
 * Remote images are fetched by main and arrive as `data:` URIs.
 */
export const CONTENT_CSP =
  `default-src 'none'; script-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; ` +
  `font-src data:; media-src data: cid:; connect-src 'none'; ${TAIL}`

/**
 * Policy for the rich-message compose preview: identical to {@link CONTENT_CSP}
 * but it must also carry the media the composer embeds, which arrives as a
 * `data:` URI for a locally attached file.
 */
export const COMPOSE_CSP = CONTENT_CSP

/** The complete sandboxed document a mail body / note preview is rendered in. */
export function contentDocument(html: string, csp: string, style: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<style>${style}</style></head><body>${html}</body></html>`
  )
}

/**
 * Promote the remote URLs the sanitizer parked in `data-blocked-*`, substituting
 * the bytes main fetched for the ones that were approved.
 *
 * A URL with no entry (blocked host, wrong content type, too large, dead
 * server) stays inert rather than becoming a live request the sandboxed frame
 * could not make anyway. Only `data:` payloads are substituted, so a
 * compromised map cannot turn this into an arbitrary-URL injection.
 */
export function promoteRemoteContent(
  html: string,
  fetched: Record<string, string>,
): string {
  return html.replace(
    /\sdata-blocked-(src|srcset|background|poster)\s*=\s*("|')([^"']*)\2/gi,
    (whole, attr: string, quote: string, url: string) => {
      const data = fetched[url]
      if (!data || !/^data:/i.test(data)) return whole
      return ` ${attr.toLowerCase()}=${quote}${data}${quote}`
    },
  )
}

/**
 * Collect the parked remote URLs from sanitized HTML so main can be asked for
 * them. `safeRedirect`-style filtering is main's job; this only reports what
 * the sanitizer parked.
 */
export function parkedRemoteUrls(html: string): string[] {
  const urls = new Set<string>()
  for (const match of html.matchAll(/\sdata-blocked-(?:src|srcset|background|poster)\s*=\s*("|')([^"']*)\1/gi)) {
    urls.add(match[2])
  }
  return [...urls]
}
