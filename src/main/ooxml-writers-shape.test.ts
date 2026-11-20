import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { MAX_XML_DEPTH, MAX_XML_TAGS, MAX_CDATA_TOTAL } from './docx-zip'
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
