import fs from 'fs'

/**
 * "Is the file I read still the file on disk?"
 *
 * The document writers (xlsx cell/range, and the docx/pptx families after them)
 * all work the same way: read the whole package into memory, change one thing,
 * write a verified temp file, then `rename` it over the original. That sequence
 * is safe against a CRASH — the real file is never truncated — but it says
 * nothing about anybody else writing to the file in the meantime. Excel,
 * LibreOffice, a sync client or the person themselves can save between our read
 * and our rename, and the rename then destroys those changes with no trace.
 * Losing an editor's save is data loss of the worst kind: silent, and blamed on
 * "the app overwrote my work".
 *
 * The fix is to remember the identity of the file whose BYTES we read and to
 * re-check it immediately before replacing it. Identity here is the tuple the OS
 * already gives us: device + inode (a replace-by-rename shows up even when size
 * and mtime happen to match), plus size and mtime in milliseconds (an in-place
 * save keeps the inode). All four must agree.
 *
 * This narrows the window to the microseconds between the check and the rename.
 * It cannot close it — nothing portable can, short of holding a lock the other
 * editor respects — and a check that pretends otherwise would be worse than the
 * honest one. What matters is that the window no longer spans an entire
 * exceljs round-trip.
 */

export interface FileIdentity {
  dev: number
  ino: number
  size: number
  mtimeMs: number
}

export function fileIdentity(filePath: string): FileIdentity | null {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return null
    return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs }
  } catch {
    return null
  }
}

export function sameIdentity(a: FileIdentity, b: FileIdentity | null): boolean {
  return b !== null && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs
}

/**
 * True when the file is no longer the one we read — changed, replaced, or gone.
 *
 * A missing file counts as changed: it means something else is active on that
 * path, and re-creating it with our stale copy would be a guess dressed up as a
 * save.
 */
export function changedSince(identity: FileIdentity, filePath: string): boolean {
  return !sameIdentity(identity, fileIdentity(filePath))
}

/**
 * Bytes and identity from ONE descriptor.
 *
 * `readFileSync(path)` + `statSync(path)` are two lookups of the same name: a
 * file replaced between them gives us the identity of one file and the bytes of
 * another, which would make the guard compare the wrong thing. Opening once and
 * using `fstat` on the open descriptor ties the identity to the bytes actually
 * parsed. Bounded by size, like every other whole-file read in this tree.
 */
export function readWithIdentity(
  filePath: string,
  maxBytes = 64 * 1024 * 1024,
): { bytes: Buffer; identity: FileIdentity } | null {
  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, 'r')
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > maxBytes) return null
    const storage = Buffer.alloc(stat.size + 1)
    let total = 0
    while (total < storage.length) {
      const count = fs.readSync(fd, storage, total, storage.length - total, null)
      if (count === 0) break
      total += count
    }
    // Grew past what we were told: somebody else is writing. Refusing is the
    // honest answer; a partial read is not a snapshot.
    if (total > stat.size) return null
    return {
      bytes: storage.subarray(0, total),
      identity: { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs },
    }
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

export type CommitResult = { ok: true } | { ok: false; reason: 'changed-on-disk' | 'write-failed' }

/**
 * Put a verified temp file in place of `filePath` — or refuse.
 *
 * The single place where every engine-free writer (xlsx, docx, pptx) replaces a
 * document, so the conflict check cannot be forgotten in one of them:
 *
 *  - the file changed since it was read → remove the temp file, say so, and
 *    leave whatever is on disk alone;
 *  - the rename fails → remove the temp file and report `write-failed`.
 *
 * Returns the reason instead of throwing because every caller answers with
 * `{ ok: false, reason }` and none of them may corrupt a document to report an
 * error.
 */
export function commitTemp(tmp: string, filePath: string, identity: FileIdentity): CommitResult {
  const discard = (): void => {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch {
      /* best-effort cleanup */
    }
  }
  if (changedSince(identity, filePath)) {
    discard()
    return { ok: false, reason: 'changed-on-disk' }
  }
  try {
    fs.renameSync(tmp, filePath)
    return { ok: true }
  } catch {
    discard()
    return { ok: false, reason: 'write-failed' }
  }
}
