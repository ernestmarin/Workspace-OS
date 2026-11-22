import fs from 'fs'
import path from 'path'

/**
 * Picks a non-colliding path: `report.pdf`, then `report (2).pdf`.
 *
 * Overwriting silently is the one outcome to avoid — a fetched file that
 * destroys a file of the same name is indistinguishable from data loss, and the
 * user had no chance to see it coming.
 *
 * Shared by the browser downloads and the Drive fetch: both put a file whose
 * name comes from a remote service into a local folder, and both had the same
 * failure available. The suffix goes before the last extension, so
 * `archive.tar.gz` becomes `archive.tar (2).gz` — the same rule Windows and
 * macOS use, which keeps the association with the `.tar.gz` intact.
 */
export function uniquePath(dir: string, filename: string): string {
  const ext = path.extname(filename)
  const stem = path.basename(filename, ext)
  let candidate = path.join(dir, filename)
  let n = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${n})${ext}`)
    n += 1
  }
  return candidate
}
