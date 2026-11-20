import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { setDocCards } from './docx-cards-writer'
import { setDocTableCells } from './docx-table-writer'

/**
 * RT-09 end-to-end: the three engine-free DOCX writers refuse a package whose
 * `word/document.xml` expands past the ceiling, and say why. Before the shared
 * bounded reader this expanded ~400 MB of heap and then failed on an anchor
 * check — the work was done and discarded, which is exactly the denial of
 * service a 199 KB file should not be able to cause.
 */
const template = { lines: [{ segments: [{ literal: 'x' }] }] }
const grid = [['Region', 'Revenue'], ['LATAM', 9]]

async function makeDocx(dir: string, xmlBytes: number): Promise<string> {
  const zip = new JSZip()
  zip.file('word/document.xml', Buffer.alloc(xmlBytes, 0x20))
  zip.file('[Content_Types].xml', '<Types/>')
  const file = path.join(dir, 'bomb.docx')
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  return file
}

describe('RT-09 writers refuse an expanding package', () => {
  it('setDocCards reports document-too-large instead of expanding it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-docx-'))
    try {
      const file = await makeDocx(dir, 64 * 1024 * 1024)
      expect(fs.statSync(file).size).toBeLessThan(200 * 1024)
      const result = await setDocCards(file, 'cards', [], template as never)
      expect(result).toEqual({ ok: false, reason: 'document-too-large' })
      // The file on disk is untouched — nothing was rewritten.
      expect(fs.statSync(file).size).toBeLessThan(200 * 1024)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('setDocTableCells reports document-too-large instead of expanding it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-docx-'))
    try {
      const file = await makeDocx(dir, 64 * 1024 * 1024)
      const result = await setDocTableCells(file, 'table', grid)
      expect(result).toEqual({ ok: false, reason: 'document-too-large' })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('still writes an ordinary small document', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-docx-'))
    try {
      const file = path.join(dir, 'ok.docx')
      const zip = new JSZip()
      zip.file('word/document.xml',
        '<w:document><w:body><w:sdt><w:sdtPr><w:tag w:val="wos-cards"/></w:sdtPr></w:sdt></w:body></w:document>')
      fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }))
      const result = await setDocCards(file, 'cards', [], template as never)
      // No anchor region in this fixture: the point is that it is NOT rejected
      // as a size problem, which is what the bound could otherwise mask.
      expect(result.ok === false && result.reason === 'document-too-large').toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
