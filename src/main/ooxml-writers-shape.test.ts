import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { MAX_XML_DEPTH, MAX_XML_TAGS, MAX_CDATA_TOTAL, loadValidatedXlsx } from './docx-zip'
import { setCellValue } from './xlsx-cell-writer'
import { setRangeValues } from './xlsx-range-writer'
import { setShapeText } from './pptx-shape-writer'
import { setSlideTableCells } from './pptx-table-writer'

const shapes = [
  ['doctype', '<!DOCTYPE x><x/>'],
  ['entity', '<!ENTITY x "value"><x/>'],
  ['depth', '<x>'.repeat(MAX_XML_DEPTH + 1) + '</x>'.repeat(MAX_XML_DEPTH + 1)],
  ['tags', '<x>' + '<a/>'.repeat(MAX_XML_TAGS + 1) + '</x>'],
  ['cdata', '<x><![CDATA[' + 'x'.repeat(MAX_CDATA_TOTAL + 1) + ']]></x>'],
] as const
const writers = [
  { name: 'xlsx-cell', ext: 'xlsx', part: 'xl/worksheets/sheet1.xml', write: (p: string) => setCellValue(p, 'Sheet1', 'A1', 42) },
  { name: 'xlsx-range', ext: 'xlsx', part: 'xl/worksheets/custom-name.xml', write: (p: string) => setRangeValues(p, 'Sheet1', 'A1', [[42]]) },
  { name: 'pptx-shape', ext: 'pptx', part: 'ppt/slides/slide1.xml', write: (p: string) => setShapeText(p, 'target', 42) },
  { name: 'pptx-table', ext: 'pptx', part: 'ppt/slides/slide1.xml', write: (p: string) => setSlideTableCells(p, 'target', [[42]]) },
]

describe('N+2b real ZIP writer shape rejection preserves original bytes', () => {
  for (const writer of writers) {
    for (const [shape, xml] of shapes) {
      it(`${writer.name}: ${shape}`, async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-ooxml-shape-'))
        try {
          const file = path.join(dir, `test.${writer.ext}`)
          const zip = new JSZip()
          zip.file(writer.part, xml)
          const original = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
          fs.writeFileSync(file, original)
          expect(await writer.write(file)).toMatchObject({ ok: false, reason: 'invalid-xml-shape' })
          expect(fs.readFileSync(file)).toEqual(original)
          expect(fs.readdirSync(dir)).toEqual([path.basename(file)])
        } finally {
          fs.rmSync(dir, { recursive: true, force: true })
        }
      })
    }
  }
})


describe('N+2c XLSX auxiliary XML and entry budget', () => {
  for (const writer of writers.filter((w) => w.ext === 'xlsx')) {
    for (const part of ['xl/styles.xml', 'xl/worksheets/sheet1.xml.extra', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/drawings/vmlDrawing1.vml']) {
      it(`${writer.name}: rejects auxiliary ${part}`, async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-xlsx-budget-'))
        try {
          const file = path.join(dir, 'test.xlsx')
          const zip = new JSZip()
          zip.file(part, '<!DOCTYPE x><x/>')
          const original = await zip.generateAsync({ type: 'nodebuffer' })
          fs.writeFileSync(file, original)
          expect(await writer.write(file)).toMatchObject({ ok: false, reason: 'invalid-xml-shape' })
          expect(fs.readFileSync(file)).toEqual(original)
        } finally { fs.rmSync(dir, { recursive: true, force: true }) }
      })
    }
    it(`${writer.name}: rejects too many individually small entries`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-xlsx-count-'))
      try {
        const file = path.join(dir, 'test.xlsx')
        const zip = new JSZip()
        for (let i = 0; i < 2049; i++) zip.file(`part${i}.xml`, '<x/>')
        const original = await zip.generateAsync({ type: 'nodebuffer' })
        fs.writeFileSync(file, original)
        expect(await writer.write(file)).toMatchObject({ ok: false, reason: 'sheet-too-large' })
        expect(fs.readFileSync(file)).toEqual(original)
      } finally { fs.rmSync(dir, { recursive: true, force: true }) }
    })
  }
})


describe('N+2c snapshot identity and cumulative inflation', () => {
  it('rejects cumulative bytes across individually bounded binary parts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-xlsx-total-'))
    try {
      const file = path.join(dir, 'test.xlsx')
      const zip = new JSZip()
      const part = Buffer.alloc(1024 * 1024, 65)
      for (let i = 0; i < 65; i++) zip.file(`media${i}.bin`, part)
      const original = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
      fs.writeFileSync(file, original)
      expect(await loadValidatedXlsx(file)).toMatchObject({ ok: false, reason: 'sheet-too-large' })
      expect(fs.readFileSync(file)).toEqual(original)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  for (const writer of writers.filter((w) => w.ext === 'xlsx')) {
    it(`${writer.name}: parses the validated snapshot and refuses a pathname replaced under it`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-xlsx-snapshot-'))
      const file = path.join(dir, 'test.xlsx')
      const load = JSZip.loadAsync.bind(JSZip)
      let replaced = false
      try {
        const workbook = new ExcelJS.Workbook()
        workbook.addWorksheet('Sheet1').getCell('A1').value = 1
        await workbook.xlsx.writeFile(file)
        // Deterministic race seam: execute the real validator's ZIP loader,
        // then replace the path before control returns to the writer.
        const spy = vi.spyOn(JSZip, 'loadAsync').mockImplementation(async (...args) => {
          const zip = await load(...args)
          if (!replaced) {
            replaced = true
            fs.writeFileSync(file, 'replacement is not a ZIP')
          }
          return zip
        })
        try {
          // IPC-DOC-WRITE-01 tightened this expectation on purpose. The old
          // one asserted `{ ok: true }` — i.e. the writer replaced a path that
          // changed under it, which is the data loss the guard now prevents.
          // The N+2c property survives and gets stronger: reaching the
          // identity check at all proves the workbook was parsed from the
          // validated snapshot, because re-reading the path would have failed
          // earlier with `not-valid-xlsx` (the replacement is not a ZIP).
          expect(await writer.write(file)).toEqual({ ok: false, reason: 'changed-on-disk' })
          expect(replaced).toBe(true)
        } finally { spy.mockRestore() }
        // The replacement is still there, byte for byte: refused, not overwritten.
        expect(fs.readFileSync(file, 'utf8')).toBe('replacement is not a ZIP')
      } finally { fs.rmSync(dir, { recursive: true, force: true }) }
    })
  }
})
