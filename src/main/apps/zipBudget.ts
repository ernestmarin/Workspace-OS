import type { UnzipFileFilter } from 'fflate'

/**
 * A bounded "how much work may this archive cost us" gate for `.wosapp` import.
 *
 * The import path already gates the COMPRESSED size of the file and the
 * per-entry limit. Neither bounds the work a hostile archive can demand: a
 * deflate bomb is small on disk and huge when expanded, and an archive with
 * thousands of tiny entries is cheap to write and expensive to parse. `fflate`
 * decompresses every entry the filter accepts, so the filter has to be the
 * budget — it cannot be checked afterwards.
 *
 * Written defensively and in one place, with tests, because this is the one
 * place in the app that accepts an archive a third party produced.
 */

export interface ZipBudget {
  /** Total bytes allowed after expansion, across every accepted entry. */
  maxTotalBytes: number
  /** Bytes allowed for a single entry after expansion. */
  maxEntryBytes: number
  /** How many entries may be accepted at all. */
  maxEntries: number
}

export interface ZipBudgetState {
  entries: number
  bytes: number
  /** The first rejection reason, kept for the error message. */
  rejected: string | null
}

export function newZipBudgetState(): ZipBudgetState {
  return { entries: 0, bytes: 0, rejected: null }
}

/**
 * The `fflate` filter, driven by a budget that survives across calls.
 *
 * Rejection is recorded rather than thrown: `fflate`'s filter contract is a
 * boolean, and the caller must be able to say WHY the archive was refused
 * instead of silently returning a half-unpacked app.
 */
export function zipBudgetFilter(budget: ZipBudget, state: ZipBudgetState): UnzipFileFilter {
  return (file) => {
    if (state.rejected) return false
    // A directory entry costs nothing and must not eat the entry allowance.
    const name = file.name
    const isDirectory = name.endsWith('/') || name.endsWith('\\')
    const expanded = typeof file.originalSize === 'number' ? file.originalSize : 0
    if (!isDirectory) {
      if (state.entries + 1 > budget.maxEntries) {
        state.rejected = `An app has at most ${budget.maxEntries} files`
        return false
      }
      if (expanded > budget.maxEntryBytes) {
        state.rejected = `${name} is larger than ${Math.round(budget.maxEntryBytes / (1024 * 1024))} MB`
        return false
      }
      if (state.bytes + expanded > budget.maxTotalBytes) {
        state.rejected = `The app is larger than ${Math.round(budget.maxTotalBytes / (1024 * 1024))} MB`
        return false
      }
      state.entries += 1
      state.bytes += expanded
    }
    return true
  }
}
