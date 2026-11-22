import { afterAll, afterEach, beforeEach, describe, expect, it, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'

/**
 * IPC-DOC-WRITE-01 (guard half) — a write must not replace a file that changed
 * since it was read.
 *
 * The writers read the package, edit it in memory, verify a temp file and
 * `rename` it over the original. That protects against a crash, not against
 * Excel/LibreOffice/a sync client/another window saving in between: the rename
 * destroys that save and reports success. The guard is the identity re-check
 * immediately before the rename (its detector has real-filesystem tests in
 * `doc-identity.test.ts`).
 *
 * Here the detector is forced to say "it changed" and the two properties under
 * test are purely the writers': they must refuse with a reason, and they must
 * leave the file on disk byte-for-byte as somebody else made it.
 */

vi.mock('./doc-identity', () => ({
  fileIdentity: () => null,
  sameIdentity: () => false,
  changedSince: () => true,
}))

const { setCellValue } = await import('./xlsx-cell-writer')
const { setRangeValues } = await import('./xlsx-range-writer')

let dir = ''
const file = (name = 'book.xlsx'): string => path.join(dir, name)

async function makeFixture(p = file()): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const s1 = wb.addWorksheet('Sheet1')
  s1.getCell('B2').value = 23.4
  await wb.xlsx.writeFile(p)
}

/** A byte-exact fingerprint of the file: what "left untouched" has to mean. */
const fingerprint = (p: string): { bytes: Buffer; id: fs.BigIntStats } =>
  ({ bytes: fs.readFileSync(p), id: fs.lstatSync(p, { bigint: true }) })

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-writeguard-'))
})
beforeEach(async () => {
  await makeFixture()
})
afterEach(() => {
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true })
})
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('a file that changed under us', () => {
  it('is not replaced by a single-cell write', async () => {
    const before = fingerprint(file())
    const res = await setCellValue(file(), 'Sheet1', 'B2', 55.5)

    expect(res.ok).toBe(false)
    expect(res.reason).toBe('changed-on-disk')
    const after = fingerprint(file())
    expect(after.bytes.equals(before.bytes)).toBe(true)
    // Not deleted-and-rewritten either: same inode as before the attempt.
    expect(after.id.ino).toBe(before.id.ino)
  })

  it('is not replaced by a range write', async () => {
    const before = fingerprint(file())
    const res = await setRangeValues(file(), 'Sheet1', 'A1', [[1, 2], [3, 4]])

    expect(res.ok).toBe(false)
    expect(res.reason).toBe('changed-on-disk')
    expect(fingerprint(file()).bytes.equals(before.bytes)).toBe(true)
  })

  it('leaves no temp file behind when it refuses', async () => {
    await setCellValue(file(), 'Sheet1', 'B2', 1)
    await setRangeValues(file(), 'Sheet1', 'A1', [[1]])
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([])
  })
})
