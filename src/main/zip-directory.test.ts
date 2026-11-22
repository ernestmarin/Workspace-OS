import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { readZipDirectory } from './zip-directory'
import { loadValidatedXlsx, MAX_XLSX_ENTRIES } from './docx-zip'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * IPC-ZIP-INDEX-01 — the entry budget used to be checked after `JSZip.loadAsync`,
 * which has already built one object per record. These tests drive REAL archive
 * bytes: a produced ZIP, a produced ZIP with a comment, handcrafted records where
 * the point is the declared count rather than a parseable archive, and the
 * integration path that must now refuse before the library ever sees the bytes.
 */

const eocd = (opts: {
  entries: number
  comment?: string
  disk?: number
  diskWithCd?: number
  cdBytes?: number
}): Buffer => {
  const comment = Buffer.from(opts.comment ?? '', 'utf8')
  const b = Buffer.alloc(22)
  b.writeUInt32LE(0x06054b50, 0)
  b.writeUInt16LE(opts.disk ?? 0, 4)
  b.writeUInt16LE(opts.diskWithCd ?? 0, 6)
  b.writeUInt16LE(Math.min(opts.entries, 0xffff), 8)
  b.writeUInt16LE(Math.min(opts.entries, 0xffff), 10)
  b.writeUInt32LE(opts.cdBytes ?? 0, 12)
  b.writeUInt32LE(0, 16)
  b.writeUInt16LE(comment.length, 20)
  return Buffer.concat([b, comment])
}

/** A ZIP64 EOCD record + locator + EOCD (all 16-bit counters saturated). */
const zip64 = (entries: bigint, opts: { disk?: number } = {}): Buffer => {
  const record = Buffer.alloc(56)
  record.writeUInt32LE(0x06064b50, 0)
  record.writeBigUInt64LE(44n, 4) // size of the remainder
  record.writeUInt16LE(45, 12) // version made by
  record.writeUInt16LE(45, 14) // version needed
  record.writeUInt32LE(opts.disk ?? 0, 16)
  record.writeUInt32LE(0, 20) // disk with CD start
  record.writeBigUInt64LE(entries, 24)
  record.writeBigUInt64LE(entries, 32)

  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50, 0)
  locator.writeUInt32LE(0, 4) // disk with the ZIP64 EOCD
  locator.writeBigUInt64LE(0n, 8) // the record starts the file, in these fixtures
  locator.writeUInt32LE(1, 16)

  const tail = Buffer.alloc(22)
  tail.writeUInt32LE(0x06054b50, 0)
  tail.writeUInt16LE(0xffff, 8)
  tail.writeUInt16LE(0xffff, 10)
  return Buffer.concat([record, locator, tail])
}

describe('readZipDirectory', () => {
  it('reports the entry count of a real archive', async () => {
    const zip = new JSZip()
    zip.file('a.xml', '<a/>')
    zip.file('b.xml', '<b/>')
    zip.file('c/d.xml', '<d/>')
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    // What the library itself sees, including the folder entry JSZip adds.
    const parsed = await JSZip.loadAsync(bytes)

    const got = readZipDirectory(bytes)
    expect(got).toMatchObject({ ok: true, entries: Object.keys(parsed.files).length, zip64: false })
  })

  it('reports a large declared count without needing a parseable archive', () => {
    // No local headers, no central directory: only the count matters here. The
    // plain-ZIP counter is 16 bits, so the largest lie it can tell is 65 535 —
    // about 65k objects; past that the archive must use the ZIP64 record.
    const got = readZipDirectory(eocd({ entries: 60_000 }))
    expect(got).toMatchObject({ ok: true, entries: 60_000 })
  })

  it('is not fooled by the signature inside the archive comment', async () => {
    const zip = new JSZip()
    zip.file('a.xml', '<a/>')
    // The comment carries a whole fake EOCD claiming 60000 entries.
    const fake = eocd({ entries: 60_000, comment: 'tail' }).toString('latin1')
    const bytes = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      comment: fake,
    })
    const got = readZipDirectory(bytes)
    expect(got).toMatchObject({ ok: true, entries: 1 })
  })

  it('resolves saturated counters through the ZIP64 record instead of trusting the marker', () => {
    expect(readZipDirectory(zip64(70_000n))).toMatchObject({ ok: true, entries: 70_000, zip64: true })
    expect(readZipDirectory(zip64(2n))).toMatchObject({ ok: true, entries: 2, zip64: true })
  })

  it('refuses saturated counters with no readable ZIP64 record', () => {
    const tail = Buffer.alloc(22)
    tail.writeUInt32LE(0x06054b50, 0)
    tail.writeUInt16LE(0xffff, 10)
    expect(readZipDirectory(tail)).toEqual({ ok: false, reason: 'zip64-unreadable' })
  })

  it('refuses multi-disk archives rather than guessing', () => {
    expect(readZipDirectory(eocd({ entries: 2, disk: 1 }))).toEqual({ ok: false, reason: 'multi-disk' })
    expect(readZipDirectory(zip64(2n, { disk: 1 }))).toEqual({ ok: false, reason: 'multi-disk' })
  })

  it('reports no EOCD for bytes that are not an archive', () => {
    expect(readZipDirectory(Buffer.from('not a zip at all, just text'))).toEqual({
      ok: false,
      reason: 'no-eocd',
    })
    expect(readZipDirectory(Buffer.alloc(0))).toEqual({ ok: false, reason: 'no-eocd' })
  })
})

describe('loadValidatedXlsx refuses before the library builds anything', () => {
  it('a tiny file declaring 60k entries is refused as too large, not as unparseable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-zipindex-'))
    try {
      const file = path.join(dir, 'bomb.xlsx')
      // A few hundred bytes that declare 60 000 entries. If the library
      // ran first it would fail with "not-valid-xlsx" (there is no central
      // directory to parse); the pre-check answers "sheet-too-large" instead,
      // which is only reachable before the archive is handed over.
      fs.writeFileSync(file, eocd({ entries: 60_000 }))
      expect(await loadValidatedXlsx(file)).toEqual({ ok: false, reason: 'sheet-too-large' })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a real archive over the entry budget is still refused with the same reason', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-zipindex-'))
    try {
      const zip = new JSZip()
      for (let i = 0; i < MAX_XLSX_ENTRIES + 1; i += 1) zip.file(`part${i}.xml`, '<x/>')
      const file = path.join(dir, 'many.xlsx')
      fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
      expect(await loadValidatedXlsx(file)).toEqual({ ok: false, reason: 'sheet-too-large' })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a quiet workbook still loads with its bytes and identity intact', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-zipindex-'))
    try {
      const zip = new JSZip()
      zip.file('[Content_Types].xml', '<Types/>')
      zip.file('xl/workbook.xml', '<workbook/>')
      const file = path.join(dir, 'ok.xlsx')
      fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
      const got = await loadValidatedXlsx(file)
      expect(got.ok).toBe(true)
      if (got.ok) expect(got.identity.size).toBe(fs.statSync(file).size)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
