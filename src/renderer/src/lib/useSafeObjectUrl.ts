import { useEffect, useRef, useState } from 'react'

/**
 * Loads bytes for an object URL and owns its lifetime.
 *
 * The pattern this replaces was subtle and wrong in two ways, and the React
 * hooks linter was pointing at it in three files:
 *
 *   1. The cleanup read the `src` STATE (`return () => { if (src) revoke(src) }`).
 *      An effect keyed on `[filePath]` closes over the `src` of the render that
 *      created it — which is `null`, because the URL is created asynchronously
 *      afterwards. So nothing was ever revoked: every image switch leaked a
 *      blob, including after the panel closed.
 *   2. Listing `src` as a dependency instead would be worse: setting the URL
 *      re-runs the effect, revoking the URL it just set and re-fetching forever.
 *
 * The URL is therefore created, revoked and re-created inside ONE effect run,
 * over a local variable. `read` is read through a ref so an inline arrow does not
 * re-trigger the fetch on every parent render (the `key` is the contract for
 * "re-read now"), and a late settle after unmount is ignored instead of setting
 * state on a dead component.
 */
export interface SafeObjectUrlState {
  url: string | null
  error: string | null
}

export function useSafeObjectUrl(
  read: () => Promise<Uint8Array>,
  toBlob: (bytes: Uint8Array) => Blob,
  key: unknown,
): SafeObjectUrlState {
  // A `null` key means "there is nothing to load right now" (e.g. a file kind
  // that has no thumbnail). It must not read at all, and must clear any URL it
  // was showing — see the early return in the run effect.
  const [state, setState] = useState<SafeObjectUrlState>({ url: null, error: null })
  const readRef = useRef(read)
  const toBlobRef = useRef(toBlob)

  useEffect(() => {
    readRef.current = read
    toBlobRef.current = toBlob
  }, [read, toBlob])

  useEffect(() => {
    let cancelled = false
    let created: string | null = null
    setState({ url: null, error: null })
    if (key === null) return () => { cancelled = true }
    void readRef.current()
      .then((bytes) => {
        if (cancelled) return
        created = URL.createObjectURL(toBlobRef.current(bytes))
        setState({ url: created, error: null })
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ url: null, error: err.message })
      })
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
    // `key` is the caller's "these are different bytes" signal; the effect body
    // only touches the refs, so `[key]` is already the complete dependency list
    // the linter wants (no suppression needed here).
  }, [key])

  return state
}
