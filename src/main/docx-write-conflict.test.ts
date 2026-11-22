import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { cardsEndName, cardsStartName, setDocCards, type CardTemplate } from './docx-cards-writer'

/**
 * IPC-DOC-WRITE-02 — the docx/pptx writers had the same blind spot as the xlsx
 * ones: read the package, edit it in memory, verify a temp file, `rename` it over
 * the original. Anybody saving in between lost their work, silently.
 *
 * The seam is real: `readWithIdentity` captures the identity synchronously and
 * the writer only then `await`s the ZIP parse, so starting the write without
 * awaiting and replacing the file immediately reproduces "another application
 * saved while we were working" exactly — with no detector stubbed out.
 */

const TAG = 'wos-collection-c1'
const TEMPLATE: CardTemplate = {
  lines: [{ segments: [{ field: 'Name' }] }],
}
const RECORDS = [{ Name: 'Ada Lovelace' }]

const cardsXml = (tag = TAG): string =>
  '<w:body>' +
  `<w:bookmarkStart w:id="1" w:name="${cardsStartName(tag)}"/><w:bookmarkEnd w:id="1"/>` +
  '<w:p><w:r><w:t>placeholder</w:t></w:r></w:p>' +
  `<w:bookmarkStart w:id="2" w:name="${cardsEndName(tag)}"/><w:bookmarkEnd w:id="2"/>` +
  '</w:body>'

let dir = ''
let file = ''

async function writeFixture(): Promise<void> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file('word/document.xml', `<w:document>${cardsXml()}</w:document>`)
  zip.file('word/styles.xml', '<w:styles/>')
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-docx-conflict-'))
  file = path.join(dir, 'dir.docx')
  await writeFixture()
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('a .docx that changed under the writer', () => {
  it('is refused with changed-on-disk and left byte for byte', async () => {
    const pending = setDocCards(file, TAG, RECORDS, TEMPLATE)
    // Another application's save: a new file moved over the path.
    fs.writeFileSync(`${file}.other`, 'someone else saved this')
    fs.renameSync(`${file}.other`, file)
    const before = fs.readFileSync(file)

    expect(await pending).toEqual({ ok: false, reason: 'changed-on-disk' })
    expect(fs.readFileSync(file).equals(before)).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toBe('someone else saved this')
  })

  it('leaves no temp file behind', async () => {
    const pending = setDocCards(file, TAG, RECORDS, TEMPLATE)
    fs.writeFileSync(`${file}.other`, 'x')
    fs.renameSync(`${file}.other`, file)
    await pending
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('still writes when nothing touched it', async () => {
    expect(await setDocCards(file, TAG, RECORDS, TEMPLATE)).toEqual({ ok: true })
    const zip = await JSZip.loadAsync(fs.readFileSync(file))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('Ada Lovelace')
  })
})
