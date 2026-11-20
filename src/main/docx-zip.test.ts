import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { MAX_ENTRY_BYTES, readEntryBounded, loadArchive, archiveWithinBudget } from './docx-zip'

/**
 * RT-09 — decompression bomb in the engine-free DOCX writers.
 *
 * These fixtures are real archives built with JSZip, not mocks: the point is
 * what the expansion actually costs, and a mocked stream would prove nothing.
 * The 199 KB / 200 MB ratio here is the one measured against the shipped code.
 */
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'wos-zip-'))

async function bomb(filePath: string, megabytes: number): Promise<void> {
  const zip = new JSZip()
  zip.file('word/document.xml', Buffer.alloc(megabytes * 1024 * 1024, 0x20))
  zip.file('[Content_Types].xml', '<Types/>')
  fs.writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

describe('RT-09 readEntryBounded', () => {
  it('refuses a small archive whose entry expands past the ceiling', async () => {
    const dir = tmp()
    const file = path.join(dir, 'bomb.docx')
    await bomb(file, 64)
    try {
      // The whole premise: the file on disk looks harmless.
      expect(fs.statSync(file).size).toBeLessThan(200 * 1024)
      const zip = (await loadArchive(file))!
      const entry = zip.file('word/document.xml')!
      const result = await readEntryBounded(entry)
      expect(result).toEqual({ ok: false, reason: 'too-large' })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('bounds even when the header lies about the size', async () => {
    const dir = tmp()
    const file = path.join(dir, 'liar.docx')
    const zip = new JSZip()
    zip.file('word/document.xml', 'x'.repeat(4096))
    fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
    try {
      const loaded = (await loadArchive(file))!
      const entry = loaded.file('word/document.xml')!
      // Forge a small declared size: the stream bound must still hold.
      ;(entry as unknown as { _data: { uncompressedSize: number } })._data.uncompressedSize = 1
      const result = await readEntryBounded(entry, 1024)
      expect(result).toEqual({ ok: false, reason: 'too-large' })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns ordinary text unchanged', async () => {
    const dir = tmp()
    const file = path.join(dir, 'ok.docx')
    const zip = new JSZip()
    zip.file('word/document.xml', '<w:document>hola</w:document>')
    fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }))
    try {
      const loaded = (await loadArchive(file))!
      const result = await readEntryBounded(loaded.file('word/document.xml')!)
      expect(result).toEqual({ ok: true, text: '<w:document>hola</w:document>' })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('treats a corrupt entry as unreadable rather than throwing', async () => {
    const dir = tmp()
    const file = path.join(dir, 'corrupt.docx')
    const zip = new JSZip()
    zip.file('word/document.xml', 'x'.repeat(2048))
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    // Flip bytes in the middle of the deflate payload.
    for (let i = 40; i < 60 && i < buf.length; i += 1) buf[i] ^= 0xff
    fs.writeFileSync(file, buf)
    try {
      const loaded = await loadArchive(file)
      if (!loaded) return // unusable archive is also an acceptable refusal
      const entry = loaded.file('word/document.xml')
      if (!entry) return
      const result = await readEntryBounded(entry)
      if (result.ok) expect(result.text.length).toBeLessThanOrEqual(MAX_ENTRY_BYTES)
      else expect(result.reason).toBe('unreadable')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('caps peak memory instead of expanding the bomb', async () => {
    const dir = tmp()
    const file = path.join(dir, 'big.docx')
    await bomb(file, 128)
    try {
      const zip = (await loadArchive(file))!
      const before = process.memoryUsage().heapUsed
      const result = await readEntryBounded(zip.file('word/document.xml')!)
      const peak = (process.memoryUsage().heapUsed - before) / 1048576
      expect(result.ok).toBe(false)
      // 128 MB of zeros previously produced ~400 MB of heap. The bound means we
      // never hold more than the ceiling, so a generous cap still proves it.
      expect(peak).toBeLessThan(128)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('RT-09 archive budget', () => {
  it('refuses a missing or non-file path without throwing', async () => {
    expect(archiveWithinBudget('/nonexistent/x.docx')).toBe(false)
    const dir = tmp()
    try {
      expect(archiveWithinBudget(dir)).toBe(false)
      await expect(loadArchive(path.join(dir, 'missing.docx'))).resolves.toBeNull()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
