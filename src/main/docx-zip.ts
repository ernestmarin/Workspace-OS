import fs from 'node:fs'
import JSZip from 'jszip'

/**
 * A bounded entry reader for the ZIP packages this app edits in place.
 *
 * The three engine-free writers (`docx-cards-writer`, `docx-table-writer`,
 * `docx-cc-writer`) all `JSZip.loadAsync(readFileSync(file))` and then
 * `entry.async('string')` on `word/document.xml`. Nothing bounded that read. A
 * 199 KB file — well under any size gate a user or a check would apply — expands
 * to a multi-hundred-megabyte string: measured at 400 MB of heap and ~900 ms for
 * one entry, and the write then fails anyway on its anchor check. Three
 * collections refreshing against such a file is enough to take the process down,
 * and the file can arrive by import or from sync.
 *
 * The ARCHIVE header declares each entry's uncompressed size up front, but a
 * header is a claim by the archive. Trusting it is how a declared-small,
 * actually-huge entry walks through, so the declared size is used only to reject
 * cheaply, and the real bound is enforced while the bytes arrive: the stream is
 * counted and destroyed the moment it crosses the ceiling. Peak memory is then
 * the ceiling plus one chunk, whatever the header said.
 */

/** Ceiling for one package entry we are willing to hold in memory as text. */
export const MAX_ENTRY_BYTES = 32 * 1024 * 1024

/** What went wrong, as a short reason the callers already know how to report. */
export type BoundedReadFailure = 'too-large' | 'unreadable'

export type BoundedReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: BoundedReadFailure }

/** The declared uncompressed size, when the archive states one. */
function declaredSize(entry: JSZip.JSZipObject): number | null {
  const data = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data
  const size = data?.uncompressedSize
  return typeof size === 'number' && Number.isFinite(size) ? size : null
}

/**
 * Read one entry as UTF-8 text, refusing anything over `maxBytes`.
 *
 * Never throws for a bad archive: callers turn `unreadable` into their own
 * "not a valid file" result, and `too-large` into a refusal that names the limit.
 */
export async function readEntryBounded(
  entry: JSZip.JSZipObject,
  maxBytes: number = MAX_ENTRY_BYTES,
): Promise<BoundedReadResult> {
  const declared = declaredSize(entry)
  if (declared !== null && declared > maxBytes) return { ok: false, reason: 'too-large' }

  return new Promise<BoundedReadResult>((resolve) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const settle = (result: BoundedReadResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    let stream: NodeJS.ReadableStream
    try {
      stream = entry.nodeStream('nodebuffer')
    } catch {
      settle({ ok: false, reason: 'unreadable' })
      return
    }
    // Destroy on EVERY exit path whoever initiated it: an unlistened error on a
    // stream that was never destroyed is how this turns into a crash.
    const stop = (reason: BoundedReadFailure): void => {
      settle({ ok: false, reason })
      const destroyable = stream as unknown as { destroy?: () => void }
      try { destroyable.destroy?.() } catch { /* already gone */ }
    }
    stream.on('data', (chunk: Buffer) => {
      if (settled) return
      total += chunk.length
      if (total > maxBytes) {
        stop('too-large')
        return
      }
      chunks.push(chunk)
    })
    stream.on('error', () => stop('unreadable'))
    stream.on('end', () => {
      if (settled) return
      try {
        settle({ ok: true, text: Buffer.concat(chunks, total).toString('utf8') })
      } catch {
        settle({ ok: false, reason: 'unreadable' })
      }
    })
  })
}

/** Whether a file is small enough to hand to JSZip at all. */
export function archiveWithinBudget(filePath: string, maxCompressedBytes = 64 * 1024 * 1024): boolean {
  try {
    const stat = fs.statSync(filePath)
    return stat.isFile() && stat.size <= maxCompressedBytes
  } catch {
    return false
  }
}

/** Load a package for in-place editing, or null when the file is not usable. */
export async function loadArchive(filePath: string): Promise<JSZip | null> {
  if (!archiveWithinBudget(filePath)) return null
  try {
    return await JSZip.loadAsync(fs.readFileSync(filePath))
  } catch {
    return null
  }
}
