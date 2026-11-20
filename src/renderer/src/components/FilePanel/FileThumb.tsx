import { useState } from 'react'
import {
  Folder,
  FileText,
  FileSpreadsheet,
  Presentation,
  FileType2,
  Image as ImageIcon,
  File as FileIcon,
} from 'lucide-react'
import { bytesToBlob } from '../../lib/bytesToBlob'
import { useSafeObjectUrl } from '../../lib/useSafeObjectUrl'
import type { FileEntry } from '../../types/fs'
import { isThumbnailable, kindOf, type FileKind } from './fileBrowserModel'
import styles from './FileViews.module.css'

/**
 * A file's picture, for the icon and gallery views.
 *
 * Real images are decoded and shown; everything else gets its kind glyph. A
 * .docx or .pptx thumbnail would mean rendering it through the LibreOffice
 * engine, which is far too much work to do for every tile in a folder — the
 * glyph is the honest answer rather than a blank frame that looks broken.
 *
 * The blob URL is revoked from the effect that created it, closing over the
 * URL itself rather than reading it back out of state. A cleanup that reads
 * state sees a stale value and leaks the current one.
 */

const GLYPH: Record<FileKind, typeof FileIcon> = {
  folder: Folder,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  pdf: FileType2,
  image: ImageIcon,
  text: FileText,
  other: FileIcon,
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  avif: 'image/avif',
}

export function FileThumb({ entry, size = 44 }: { entry: FileEntry; size?: number }): JSX.Element {
  const [failed, setFailed] = useState(false)

  // Depend on the values the read uses. The `entry` object is rebuilt by several
  // callers on every render, so keying on it re-fetched the thumbnail on each
  // render; these primitives are the real inputs. Lifetime (including "do not
  // read at all") is handled inside the hook via the null key.
  const { path: entryPath, name: entryName, isDirectory } = entry
  const thumbnailable = isThumbnailable({ name: entryName, isDirectory })
  const { url: src } = useSafeObjectUrl(
    () => window.workspace.fs.readFileBytes(entryPath),
    (bytes) => {
      const ext = entryName.split('.').pop()?.toLowerCase() ?? 'png'
      return bytesToBlob(bytes, MIME[ext] ?? 'image/png')
    },
    thumbnailable ? entryPath : null,
  )

  if (src && !failed) {
    return (
      <img
        src={src}
        className={styles.thumbImg}
        style={{ width: size, height: size }}
        alt={entry.name}
        draggable={false}
        onError={() => setFailed(true)}
      />
    )
  }

  const Glyph = GLYPH[kindOf(entry)]
  return (
    <span className={styles.thumbGlyph} style={{ width: size, height: size }}>
      <Glyph size={Math.round(size * 0.62)} strokeWidth={1.5} />
    </span>
  )
}
