import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { setCellValue } from './xlsx-cell-writer'
import { setRangeValues } from './xlsx-range-writer'

/**
 * IPC-DOC-WRITE-01 / -02 (guard half) — a write must not replace a file that
 * changed since it was read.
 *
 * The writers read the package, edit it in memory, verify a temp file and
 * `rename` it over the original. That protects against a crash, not against
 * Excel/LibreOffice/a sync client/another window saving in between: the rename
 * would destroy that save and report success.
 *
 * The race here is real, not mocked. Both writers capture the identity of the
 * bytes synchronously (open + fstat + read), and only then `await` the ZIP parse:
 * so calling the writer without awaiting, and replacing the file immediately,
 * is exactly the "somebody else saved while we were working" case — with the
 * identity already taken. No detector is stubbed; the guard runs for real.
 */

let dir = ''
const file = (name = 'book.xlsx'): string => path.join(dir, name)

async function makeFixture(p = file()): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const s1 = wb.addWorksheet('Sheet1')
  s1.getCell('A1').value = 10
  s1.getCell('B2').value = 23.4
  await wb.xlsx.writeFile(p)
}

/** Another application's save: a NEW file, moved over the path. */
function externalSave(p: string, value: number): void {
  const replacement = `${p}.other-app`
  fs.writeFileSync(replacement, `saved elsewhere (${value})`)
  fs.renameSync(replacement, p)
}

const fingerprint = (p: string): { bytes: Buffer; ino: bigint } => ({
  bytes: fs.readFileSync(p),
  ino: fs.lstatSync(p, { bigint: true }).ino,
})

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-writeguard-'))
  await makeFixture()
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('a file that changed under us', () => {
  it('is not replaced by a single-cell write', async () => {
    // Identity is captured inside this call, synchronously, before it yields.
    const pending = setCellValue(file(), 'Sheet1', 'B2', 55.5)
    externalSave(file(), 1)
    const before = fingerprint(file())

    expect(await pending).toEqual({ ok: false, reason: 'changed-on-disk' })
    const after = fingerprint(file())
    expect(after.bytes.equals(before.bytes)).toBe(true)
    expect(after.ino).toBe(before.ino)
  })

  it('is not replaced by a range write', async () => {
    const pending = setRangeValues(file(), 'Sheet1', 'A1', [[1, 2], [3, 4]])
    externalSave(file(), 2)
    const before = fingerprint(file())

    expect(await pending).toEqual({ ok: false, reason: 'changed-on-disk' })
    expect(fingerprint(file()).bytes.equals(before.bytes)).toBe(true)
  })

  it('leaves no temp file behind when it refuses', async () => {
    const pending = setCellValue(file(), 'Sheet1', 'B2', 1)
    externalSave(file(), 3)
    await pending
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('still writes when nothing touched the file (the guard is not a blanket refusal)', async () => {
    expect(await setCellValue(file(), 'Sheet1', 'B2', 55.5)).toEqual({ ok: true })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(file())
    expect(wb.getWorksheet('Sheet1')!.getCell('B2').value).toBe(55.5)
  })
})
