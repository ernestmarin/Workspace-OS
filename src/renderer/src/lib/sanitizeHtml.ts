import { sanitizeHtml as sanitizeSharedHtml } from '../../../shared/htmlSanitize'

/**
 * HTML sanitizer for the markdown preview surface.
 *
 * Delegates to the single shared implementation in `src/shared/htmlSanitize.ts`
 * — the same code the mail reader runs — so a hardening fix cannot land on one
 * surface and miss the other. It is a dependency-free module, so importing it
 * from the renderer still keeps `mailparser` out of the web bundle (the reason
 * this file exists at all).
 *
 * The result is additionally rendered inside a sandboxed, CSP-locked iframe, so
 * this is defence-in-depth, not the sole barrier.
 */
export function sanitizeHtml(input: string): { html: string; hadRemote: boolean } {
  return sanitizeSharedHtml(input)
}
