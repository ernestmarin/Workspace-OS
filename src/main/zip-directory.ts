/**
 * The ZIP directory, read BEFORE any library looks at the archive.
 *
 * `JSZip.loadAsync` parses the central directory eagerly: every record becomes a
 * JS object with its name, dates, offsets and flags, and only then does `zip.files`
 * exist for a caller to count. So checking `entries.length > MAX` *after*
 * `loadAsync` checks the budget at the one moment it is already too late — the
 * allocation the budget exists to prevent has happened. Shape of the problem:
 * the plain-ZIP counter is 16 bits, so a hand-built record can declare 65 535
 * entries in a three-megabyte file — far under the 64 MiB file cap that supposedly
 * bounds the work — and a ZIP64 record can declare millions in the same footprint.
 * Either way the library builds that many objects before anybody counts them.
 *
 * The declared entry count is in the End Of Central Directory record — 22 bytes
 * at the end of the file (plus an optional comment). Reading it first turns the
 * entry budget into a real pre-check: the archive is refused before any object is
 * built.
 *
 * Deliberately narrow: this finds the EOCD, reports the declared counts and the
 * central-directory extent, and says when it cannot tell. It does not validate
 * local headers, CRCs or compression — the library that will parse the archive
 * stays the authority on structure. A count can lie, and a lying count only ever
 * makes this check *less* protective; every later bound (per-entry bytes, total
 * inflated bytes, XML shape) still runs, and the read of every entry is still
 * counted.
 *
 * ZIP64: when the 16-bit fields saturate (`0xFFFF`) the real count lives in the
 * ZIP64 EOCD record, located through the locator that precedes the EOCD. Real
 * `.xlsx`/`.docx` files never need it; a hostile one may use it to hide a huge
 * count behind a marker, so the saturated case is resolved rather than trusted.
 */

const EOCD_SIGNATURE = 0x06054b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const EOCD_MIN_BYTES = 22
const MAX_COMMENT_BYTES = 0xffff
const ZIP64_LOCATOR_BYTES = 20
const ZIP64_EOCD_MIN_BYTES = 56
const UINT64_MAX = BigInt(Number.MAX_SAFE_INTEGER)

/**
 * How many parts a docx/pptx may declare before we refuse it outright.
 *
 * Word and PowerPoint packages are dozens of parts; a heavy deck with embedded
 * media is hundreds. 4096 is a generous ceiling that still bounds the library's
 * directory index, which is the cost this module exists to keep off the budget.
 */
export const MAX_OOXML_ENTRIES = 4096

export type ZipDirectoryResult =
  | { ok: true; entries: number; centralDirectoryBytes: number; zip64: boolean }
  | { ok: false; reason: 'no-eocd' | 'multi-disk' | 'zip64-unreadable' }

/** Total entries declared on every disk; `0xFFFF` means "see the ZIP64 record". */
function readZip64Entries(buffer: Buffer): ZipDirectoryResult | null {
  const locator = buffer.length - EOCD_MIN_BYTES - ZIP64_LOCATOR_BYTES
  if (locator < 0 || buffer.readUInt32LE(locator) !== ZIP64_LOCATOR_SIGNATURE) return null
  const recordOffset = Number(buffer.readBigUInt64LE(locator + 8))
  if (!Number.isSafeInteger(recordOffset) || recordOffset + ZIP64_EOCD_MIN_BYTES > buffer.length) {
    return { ok: false, reason: 'zip64-unreadable' }
  }
  if (buffer.readUInt32LE(recordOffset) !== ZIP64_EOCD_SIGNATURE) {
    return { ok: false, reason: 'zip64-unreadable' }
  }
  // The ZIP64 record keeps disk numbers at 16 and counts at 24 (this disk) / 32
  // (total). A multi-disk archive is refused rather than guessed at.
  const disk = buffer.readUInt32LE(recordOffset + 16)
  const diskWithCd = buffer.readUInt32LE(recordOffset + 20)
  if (disk !== 0 || diskWithCd !== 0) return { ok: false, reason: 'multi-disk' }
  const total = buffer.readBigUInt64LE(recordOffset + 32)
  // A count past 2^53 is not a number we can reason about; it is also far past
  // any budget, so it is reported as its saturation rather than rounded.
  const entries = total > UINT64_MAX ? Number.MAX_SAFE_INTEGER : Number(total)
  return { ok: true, entries, centralDirectoryBytes: 0, zip64: true }
}

export function readZipDirectory(buffer: Buffer): ZipDirectoryResult {
  if (buffer.length < EOCD_MIN_BYTES) return { ok: false, reason: 'no-eocd' }
  // The EOCD sits within the last 22 bytes plus a comment of at most 64 KiB, and
  // its own comment length must reach exactly the end of the buffer. That rule —
  // not "the last signature found" — is what keeps a comment that contains the
  // four signature bytes from being mistaken for the record.
  const earliest = Math.max(0, buffer.length - EOCD_MIN_BYTES - MAX_COMMENT_BYTES)
  for (let pos = buffer.length - EOCD_MIN_BYTES; pos >= earliest; pos -= 1) {
    if (buffer.readUInt32LE(pos) !== EOCD_SIGNATURE) continue
    const commentLength = buffer.readUInt16LE(pos + 20)
    if (pos + EOCD_MIN_BYTES + commentLength !== buffer.length) continue

    const disk = buffer.readUInt16LE(pos + 4)
    const diskWithCd = buffer.readUInt16LE(pos + 6)
    if (disk !== 0 || diskWithCd !== 0) return { ok: false, reason: 'multi-disk' }

    const entriesOnDisk = buffer.readUInt16LE(pos + 8)
    const entriesTotal = buffer.readUInt16LE(pos + 10)
    const centralDirectoryBytes = buffer.readUInt32LE(pos + 12)

    if (entriesTotal === 0xffff || entriesOnDisk === 0xffff) {
      const zip64 = readZip64Entries(buffer)
      if (zip64) return zip64
      // Saturated counters with no readable ZIP64 record: the declared count is
      // not the count. Refusing is the honest answer.
      return { ok: false, reason: 'zip64-unreadable' }
    }
    return { ok: true, entries: entriesTotal, centralDirectoryBytes, zip64: false }
  }
  return { ok: false, reason: 'no-eocd' }
}
