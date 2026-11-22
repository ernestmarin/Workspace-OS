import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * IPC-UPLOAD-01 — `chat:upload` was capped per call, never across calls.
 *
 * `writeUpload` refused any single file over 25 MB, and that was the whole
 * budget: a renderer could drop 25 MB, wait, drop 25 MB again, forever, into
 * `<workspace>/.workspace-os/uploads/`. A chat surface that receives drops from
 * the user is exactly where a stuck loop or a repeated paste lands, and the
 * folder lives inside the user's workspace — so the failure mode is the disk
 * filling up under a project they are working in.
 *
 * The per-call cap stays (a single huge file is its own problem). This adds a
 * workspace-wide budget over everything under `uploads/`, checked BEFORE the
 * write so a refusal leaves nothing behind. The budget is overridable through
 * `WOS_MAX_UPLOADS_BYTES` so the behaviour can be exercised without writing half
 * a gigabyte; the default is unchanged for the app.
 *
 * Real filesystem throughout: real folders, real bytes.
 */

const { MAX_UPLOAD_BYTES, MAX_UPLOADS_BYTES, uploadsBytes, writeUpload } = await import('./chat')

let root = ''

const uploadsRoot = (): string => path.join(root, '.workspace-os', 'uploads')
const allFiles = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? allFiles(path.join(dir, e.name)) : [path.join(dir, e.name)],
      )
    : []

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-uploads-'))
  delete process.env['WOS_MAX_UPLOADS_BYTES']
})
afterEach(() => {
  delete process.env['WOS_MAX_UPLOADS_BYTES']
  fs.rmSync(root, { recursive: true, force: true })
})

describe('the workspace upload budget', () => {
  it('refuses a drop that would push the folder over the budget, writing nothing', () => {
    process.env['WOS_MAX_UPLOADS_BYTES'] = '25'
    const ten = new Uint8Array(10)

    writeUpload(root, 'a.bin', ten)
    writeUpload(root, 'b.bin', new Uint8Array(10))
    expect(uploadsBytes(uploadsRoot())).toBe(20)

    expect(() => writeUpload(root, 'c.bin', ten)).toThrow(/uploads folder is full/i)
    // Nothing landed: still two files, still 20 bytes.
    expect(allFiles(uploadsRoot())).toHaveLength(2)
    expect(uploadsBytes(uploadsRoot())).toBe(20)
  })

  it('allows a drop that lands exactly on the budget', () => {
    process.env['WOS_MAX_UPLOADS_BYTES'] = '25'
    writeUpload(root, 'a.bin', new Uint8Array(20))
    writeUpload(root, 'b.bin', new Uint8Array(5))
    expect(uploadsBytes(uploadsRoot())).toBe(25)
    expect(() => writeUpload(root, 'c.bin', new Uint8Array(1))).toThrow(/uploads folder is full/i)
  })

  it('does not follow symlinks out of the uploads folder', () => {
    process.env['WOS_MAX_UPLOADS_BYTES'] = '100'
    writeUpload(root, 'a.bin', new Uint8Array(10))
    // A link inside uploads/ pointing at a 10 MB file elsewhere must not be
    // counted — the budget is about what this folder stores, and following the
    // link would both inflate it and make it depend on somebody else's file.
    const outside = path.join(root, 'outside.bin')
    fs.writeFileSync(outside, Buffer.alloc(1024 * 1024))
    const day = fs.readdirSync(uploadsRoot())[0]
    fs.symlinkSync(outside, path.join(uploadsRoot(), day, 'link.bin'))

    expect(uploadsBytes(uploadsRoot())).toBe(10)
    writeUpload(root, 'b.bin', new Uint8Array(10))
    expect(uploadsBytes(uploadsRoot())).toBe(20)
  })

  it('falls back to the shipped default when the override is nonsense', () => {
    process.env['WOS_MAX_UPLOADS_BYTES'] = 'not-a-number'
    expect(MAX_UPLOADS_BYTES).toBe(512 * 1024 * 1024)
    writeUpload(root, 'a.bin', new Uint8Array(16))
    // Well under the default: the drop is accepted.
    expect(allFiles(uploadsRoot())).toHaveLength(1)
  })

  it('keeps the per-call cap and the free-name suffixing', () => {
    expect(() => writeUpload(root, 'huge.bin', new Uint8Array(MAX_UPLOAD_BYTES + 1))).toThrow(/larger than/)
    writeUpload(root, 'same.txt', new Uint8Array(1))
    const second = writeUpload(root, 'same.txt', new Uint8Array(1))
    expect(path.basename(second)).toBe('same (2).txt')
  })
})
