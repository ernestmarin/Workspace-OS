import fs from 'fs'
import path from 'path'

/**
 * Which local copy belongs to which Drive file.
 *
 * `drive:open` fetches a Drive file INTO the workspace and hands back an
 * ordinary path. Two things have to stay true about that copy:
 *
 *  1. **Two different Drive files with the same name must not overwrite each
 *     other.** A Drive folder can hold `report.docx` in two places; the local
 *     folder cannot, and silently keeping the second one is data loss. Without
 *     this map the local path was decided by the file's *name* alone.
 *  2. **Re-opening the same Drive file must refresh that copy**, not create
 *     `report (2).docx`, `report (3).docx`, … — the canvas, the office engine
 *     and the agent all hold the path, so a new path per open would break them.
 *
 * Hence the id → path map: same id, same file, overwrite in place; unknown id,
 * allocate a non-colliding name.
 *
 * Stored in the workspace store (`<root>/.workspace-os/drive-copies.json`), not
 * in `Drive/` — the Drive folder is the user's, and a bookkeeping file there
 * would show up as if it were one of their documents. The file is bounded and
 * survives corruption: a broken index must never make `drive:open` fail, it must
 * only cost one re-download with a fresh name.
 *
 * Absolute paths are stored so a moved workspace invalidates them by
 * construction (the containment check in `drive:open` rejects them and allocates
 * a fresh copy) rather than by trusting a stale string.
 */

export interface DriveCopyEntry {
  path: string
  at: string
}

/** Enough for a working set; the oldest entries are dropped first. */
export const DRIVE_COPIES_MAX = 500

interface IndexFile {
  version: 1
  files: Record<string, DriveCopyEntry>
}

export class DriveCopyIndex {
  constructor(private readonly file: string) {}

  private read(): IndexFile {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<IndexFile>
      const files = raw?.files && typeof raw.files === 'object' ? raw.files : {}
      return { version: 1, files }
    } catch {
      // Missing or corrupted: an empty index. A copy that has to be fetched
      // again under a new name is a small cost; a failed open is not.
      return { version: 1, files: {} }
    }
  }

  private write(index: IndexFile): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    // Write-then-rename: a crash mid-write must not leave half a JSON file that
    // the next open reads as "no mappings at all".
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(index, null, 2), 'utf8')
    fs.renameSync(tmp, this.file)
  }

  /** The local copy recorded for this Drive file, or null. */
  get(fileId: string): string | null {
    const entry = this.read().files[fileId]
    return entry && typeof entry.path === 'string' ? entry.path : null
  }

  /** Record (or refresh) the local copy for this Drive file. */
  set(fileId: string, absPath: string, now = Date.now()): void {
    const index = this.read()
    index.files[fileId] = { path: absPath, at: new Date(now).toISOString() }
    const ids = Object.keys(index.files)
    if (ids.length > DRIVE_COPIES_MAX) {
      ids
        .sort((a, b) => (index.files[a].at < index.files[b].at ? -1 : index.files[a].at > index.files[b].at ? 1 : 0))
        .slice(0, ids.length - DRIVE_COPIES_MAX)
        .forEach((id) => delete index.files[id])
    }
    this.write(index)
  }
}
