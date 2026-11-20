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

/** Shape budgets for the XML inside that entry — expansion is one threat, structure is another. */
export const MAX_XML_DEPTH = 256
export const MAX_XML_TAGS = 50_000
export const MAX_CDATA_TOTAL = 512 * 1024
// Any ENTITY/DOCTYPE is unsupported in OOXML word/document.xml (billion-laughs vector).
const ENTITY_DECL_RE = /<!ENTITY/i
const DOCTYPE_RE = /<!DOCTYPE/i

/** What went wrong, as a short reason the callers already know how to report. */
export type BoundedReadFailure = 'too-large' | 'unreadable' | 'invalid-shape'

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
 * Validates XML *shape* after size is known to be within budget.
 *
 * Bounds expansion (RT-09) but not structure — deeply nested XML and entity
 * expansion inside a legitimately-sized file were still unhandled. This checks:
 *  - no <!DOCTYPE / <!ENTITY declarations (billion-laughs / XXE vector)
 *  - nesting depth ceiling (stack exhaustion via 10k-deep <a><a>...)
 *  - total element count ceiling (CPU exhaustion via 100k siblings)
 *  - CDATA total ceiling (abuse via <![CDATA[huge]]> bypass)
 *
 * Pure string scan, no XML parser instantiation — a parser that itself
 * expands entities or builds a DOM would be the vulnerability.
 */
export function validateXmlShape(xml: string): { ok: true } | { ok: false; reason: BoundedReadFailure } {
  if (ENTITY_DECL_RE.test(xml) || DOCTYPE_RE.test(xml)) {
    return { ok: false, reason: 'invalid-shape' }
  }
  // CDATA total: sum of all CDATA section contents.
  let cdataTotal = 0
  const cdataRe = /<!\[CDATA\[([\s\S]*?)\]\]>/g
  let cm: RegExpExecArray | null
  while ((cm = cdataRe.exec(xml)) !== null) {
    cdataTotal += cm[1].length
    if (cdataTotal > MAX_CDATA_TOTAL) return { ok: false, reason: 'invalid-shape' }
  }
  // Depth + tag count via single-pass tag scan.
  // Matches comments, declarations, CDATA, processing instructions, and normal tags.
  const tagRe = /<[^>]*>/g
  let depth = 0
  let maxDepth = 0
  let tagCount = 0
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(xml)) !== null) {
    const tag = m[0]
    tagCount += 1
    if (tagCount > MAX_XML_TAGS) return { ok: false, reason: 'invalid-shape' }
    // Skip self-closing, comments, CDATA, DOCTYPE, processing instructions.
    if (tag.endsWith('/>')) continue
    if (tag.startsWith('<!--')) continue
    if (tag.startsWith('<![CDATA[')) continue
    if (tag.startsWith('<!')) continue
    if (tag.startsWith('<?')) continue
    if (tag.startsWith('</')) {
      depth -= 1
      if (depth < 0) depth = 0 // malformed, but don't let depth go negative
    } else {
      depth += 1
      if (depth > maxDepth) maxDepth = depth
      if (maxDepth > MAX_XML_DEPTH) return { ok: false, reason: 'invalid-shape' }
    }
  }
  return { ok: true }
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
  const read = await readEntryCounted(entry, maxBytes)
  return read.ok ? { ok: true, text: read.text } : read
}

type CountedReadResult =
  | { ok: true; text: string; bytes: number }
  | { ok: false; reason: BoundedReadFailure }

async function readEntryCounted(
  entry: JSZip.JSZipObject,
  maxBytes: number = MAX_ENTRY_BYTES,
  checkShape = true,
): Promise<CountedReadResult> {
  const declared = declaredSize(entry)
  if (declared !== null && declared > maxBytes) return { ok: false, reason: 'too-large' }

  return new Promise<CountedReadResult>((resolve) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const settle = (result: CountedReadResult): void => {
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
        const text = Buffer.concat(chunks, total).toString('utf8')
        const shape = checkShape ? validateXmlShape(text) : { ok: true as const }
        if (!shape.ok) {
          settle({ ok: false, reason: shape.reason })
          return
        }
        settle({ ok: true, text, bytes: total })
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

/** XLSX budgets cover every entry: exceljs inflates even unrecognised parts. */
export const MAX_XLSX_ENTRIES = 2048
export const MAX_XLSX_TOTAL_BYTES = 64 * 1024 * 1024
export type XlsxSnapshotResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; reason: 'invalid-xml-shape' | 'sheet-too-large' | 'not-valid-xlsx' }

/** Read once from an open descriptor, bounded even if the path grows/replaces. */
export async function loadValidatedXlsx(filePath: string): Promise<XlsxSnapshotResult> {
  let buffer: Buffer
  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, 'r')
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_XLSX_TOTAL_BYTES) return { ok: false, reason: 'sheet-too-large' }
    const storage = Buffer.alloc(stat.size + 1)
    let total = 0
    while (total < storage.length) {
      const count = fs.readSync(fd, storage, total, storage.length - total, null)
      if (count === 0) break
      total += count
    }
    if (total > stat.size) return { ok: false, reason: 'sheet-too-large' }
    buffer = storage.subarray(0, total)
  } catch {
    return { ok: false, reason: 'not-valid-xlsx' }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
  try {
    const zip = await JSZip.loadAsync(buffer)
    const entries = Object.values(zip.files)
    if (entries.length > MAX_XLSX_ENTRIES) return { ok: false, reason: 'sheet-too-large' }
    let total = 0
    for (const entry of entries) {
      if (entry.dir) continue
      // XML, relationship and VML parts all reach XML parsers in exceljs.
      // Media and unknown parts still consume the shared inflation budget.
      const xml = /\.(xml|rels|vml)/i.test(entry.name)
      const read = await readEntryCounted(entry, Math.min(MAX_ENTRY_BYTES, MAX_XLSX_TOTAL_BYTES - total), xml)
      if (!read.ok) return { ok: false, reason: read.reason === 'invalid-shape' ? 'invalid-xml-shape' : read.reason === 'too-large' ? 'sheet-too-large' : 'not-valid-xlsx' }
      total += read.bytes
    }
    return { ok: true, buffer }
  } catch {
    return { ok: false, reason: 'not-valid-xlsx' }
  }
}
