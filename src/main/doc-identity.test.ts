import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { changedSince, fileIdentity, sameIdentity } from './doc-identity'

/**
 * IPC-DOC-WRITE-01 (detector half) — the identity that guards every document
 * write. Real files, real stats: if this comparison is loose, the writers think
 * nothing changed while something did, which is exactly the failure it exists to
 * prevent.
 */

let dir = ''
const file = (name = 'a.xlsx'): string => path.join(dir, name)

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-identity-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('fileIdentity', () => {
  it('is stable while nothing touches the file', () => {
    fs.writeFileSync(file(), 'one')
    const first = fileIdentity(file())
    expect(first).not.toBeNull()
    expect(sameIdentity(first!, fileIdentity(file()))).toBe(true)
    expect(changedSince(first!, file())).toBe(false)
  })

  it('sees an in-place size change', () => {
    fs.writeFileSync(file(), 'one')
    const before = fileIdentity(file())!
    fs.writeFileSync(file(), 'one and a half')
    expect(changedSince(before, file())).toBe(true)
  })

  it('sees a same-size edit through the mtime', () => {
    fs.writeFileSync(file(), 'abc')
    const before = fileIdentity(file())!
    const later = new Date(Date.now() + 5_000)
    fs.writeFileSync(file(), 'xyz')
    fs.utimesSync(file(), later, later)
    expect(changedSince(before, file())).toBe(true)
  })

  it('sees a replace-by-rename even when size and mtime match', () => {
    fs.writeFileSync(file(), 'abc')
    const before = fileIdentity(file())!
    const copy = file('copy.xlsx')
    fs.writeFileSync(copy, 'abc')
    fs.utimesSync(copy, new Date(before.mtimeMs), new Date(before.mtimeMs))
    fs.renameSync(copy, file())
    // Same name, same bytes, same time — a different file. dev+ino catch it.
    expect(changedSince(before, file())).toBe(true)
  })

  it('treats a vanished file as changed', () => {
    fs.writeFileSync(file(), 'abc')
    const before = fileIdentity(file())!
    fs.unlinkSync(file())
    expect(changedSince(before, file())).toBe(true)
  })

  it('refuses anything that is not a regular file', () => {
    expect(fileIdentity(path.join(dir, 'nope.xlsx'))).toBeNull()
    const sub = path.join(dir, 'sub')
    fs.mkdirSync(sub)
    expect(fileIdentity(sub)).toBeNull()
    expect(sameIdentity({ dev: 1, ino: 2, size: 3, mtimeMs: 4 }, null)).toBe(false)
  })
})
