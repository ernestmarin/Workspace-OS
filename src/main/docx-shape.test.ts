import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { readEntryBounded, validateXmlShape, MAX_XML_DEPTH, MAX_XML_TAGS, MAX_CDATA_TOTAL } from './docx-zip'
import { setDocTableCells } from './docx-table-writer'
import { setDocCards } from './docx-cards-writer'
import { setContentControlText } from './docx-cc-writer'

// Helpers
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'wos-shape-'))
const minimalDocx = async (xml: string, filePath: string): Promise<void> => {
  const zip = new JSZip()
  zip.file('word/document.xml', xml)
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file('_rels/.rels', '<Relationships/>')
  fs.writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}
const simpleXml = (body: string): string =>
  `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`

describe('Lote N+2 — presupuesto de shape OOXML', () => {
  it('validateXmlShape rechaza profundidad excesiva (10k niveles)', () => {
    let deep = ''
    for (let i = 0; i < MAX_XML_DEPTH + 10; i++) deep += '<a>'
    for (let i = 0; i < MAX_XML_DEPTH + 10; i++) deep += '</a>'
    const xml = simpleXml(deep)
    const r = validateXmlShape(xml)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid-shape')
  })

  it('validateXmlShape rechaza <!ENTITY> (billion laughs)', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><w:document><w:body><w:p>&lol2;</w:p></w:body></w:document>`
    const r = validateXmlShape(xml)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid-shape')
  })

  it('validateXmlShape rechaza <!DOCTYPE', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE foo><w:document><w:p>hi</w:p></w:document>`
    expect(validateXmlShape(xml).ok).toBe(false)
  })

  it('validateXmlShape rechaza abuso CDATA (512KB+)', () => {
    const blob = 'x'.repeat(MAX_CDATA_TOTAL + 1)
    const xml = simpleXml(`<w:p><![CDATA[${blob}]]></w:p>`)
    expect(validateXmlShape(xml).ok).toBe(false)
  })

  it('validateXmlShape rechaza explosión de etiquetas (50k+)', () => {
    let many = ''
    for (let i = 0; i < MAX_XML_TAGS + 1; i++) many += '<w:p/>'
    const xml = simpleXml(many)
    expect(validateXmlShape(xml).ok).toBe(false)
  })

  it('validateXmlShape acepta XML normal de Word', () => {
    const xml = simpleXml('<w:p><w:r><w:t>Hola</w:t></w:r></w:p>')
    expect(validateXmlShape(xml)).toEqual({ ok: true })
  })

  it('readEntryBounded aplica shape tras leer (ENTITY)', async () => {
    const dir = tmp()
    const file = path.join(dir, 'entity.docx')
    const xml = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY x "evil">]><w:document><w:body><w:p>&x;</w:p></w:body></w:document>`
    await minimalDocx(xml, file)
    const zip = await JSZip.loadAsync(fs.readFileSync(file))
    const entry = zip.file('word/document.xml')!
    const result = await readEntryBounded(entry)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid-shape')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('readEntryBounded aplica shape tras leer (profundidad)', async () => {
    const dir = tmp()
    const file = path.join(dir, 'deep.docx')
    let deep = ''
    for (let i = 0; i < MAX_XML_DEPTH + 5; i++) deep += '<w:sect>'
    for (let i = 0; i < MAX_XML_DEPTH + 5; i++) deep += '</w:sect>'
    await minimalDocx(simpleXml(deep), file)
    const zip = await JSZip.loadAsync(fs.readFileSync(file))
    const entry = zip.file('word/document.xml')!
    const result = await readEntryBounded(entry)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid-shape')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('los tres escritores reportan invalid-shape sin tocar el fichero', async () => {
    const dir = tmp()
    // Creamos un docx válido para table, cc y cards, pero con ENTITY para disparar shape
    const badXml = `<?xml version="1.0"?><!DOCTYPE foo><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:p><w:t>a</w:t></w:p></w:tc></w:tr></w:tbl><w:bookmarkStart w:name="wos-range-myTag"/></w:body></w:document>`
    const file = path.join(dir, 'shape.docx')
    await minimalDocx(badXml, file)
    const before = fs.readFileSync(file)
    // Intentamos table writer
    const r1 = await setDocTableCells(file, 'wos-range-myTag', [[1]])
    expect(r1.ok).toBe(false)
    expect(r1.reason).toBe('invalid-xml-shape')
    expect(fs.readFileSync(file).equals(before)).toBe(true)

    // CC writer
    const ccBadXml = `<?xml version="1.0"?><!DOCTYPE foo><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:sdt><w:sdtPr><w:tag w:val="wos-metric-x"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>1</w:t></w:r></w:p></w:sdtContent></w:sdt></w:body></w:document>`
    const file2 = path.join(dir, 'shape2.docx')
    await minimalDocx(ccBadXml, file2)
    const before2 = fs.readFileSync(file2)
    const r2 = await setContentControlText(file2, 'wos-metric-x', 2)
    expect(r2.ok).toBe(false)
    expect(r2.reason).toBe('invalid-xml-shape')
    expect(fs.readFileSync(file2).equals(before2)).toBe(true)

    // Cards writer
    const cardsBadXml = `<?xml version="1.0"?><!DOCTYPE foo><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:bookmarkStart w:name="wos-cards-myTag-start"/><w:bookmarkStart w:name="wos-cards-myTag-end"/></w:body></w:document>`
    const file3 = path.join(dir, 'shape3.docx')
    await minimalDocx(cardsBadXml, file3)
    const before3 = fs.readFileSync(file3)
    const r3 = await setDocCards(file3, 'myTag', [{ id: '1', values: {} } as any], { lines: [{ segments: [{ literal: 'hi' }] }] })
    expect(r3.ok).toBe(false)
    expect(r3.reason).toBe('invalid-xml-shape')
    expect(fs.readFileSync(file3).equals(before3)).toBe(true)

    fs.rmSync(dir, { recursive: true, force: true })
  })
})
