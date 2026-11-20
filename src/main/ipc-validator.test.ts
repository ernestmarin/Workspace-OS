import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { validateFilePath, validateOpenPath, validateFileName, IpcValidationError } from './ipc-validator'

describe('validateFilePath', () => {
  let root: string
  let outside: string

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-root-'))
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-out-'))
    fs.writeFileSync(path.join(root, 'doc.txt'), 'hi')
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
  })

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  })

  it('allows a file inside the root', () => {
    expect(validateFilePath(path.join(root, 'doc.txt'), root)).toBe(path.join(root, 'doc.txt'))
  })

  it('allows a not-yet-existing file inside the root', () => {
    const target = path.join(root, 'new', 'file.txt')
    expect(validateFilePath(target, root)).toBe(target)
  })

  it('rejects lexical traversal with ../', () => {
    expect(() => validateFilePath(path.join(root, '..', 'etc'), root)).toThrow(IpcValidationError)
  })

  it('rejects an absolute path outside the root', () => {
    expect(() => validateFilePath(path.join(outside, 'secret.txt'), root)).toThrow(IpcValidationError)
  })

  it('rejects a symlink inside the root that points outside it', () => {
    const link = path.join(root, 'escape-link')
    fs.symlinkSync(outside, link)
    expect(() => validateFilePath(path.join(link, 'secret.txt'), root)).toThrow(IpcValidationError)
  })

  it('rejects non-string input', () => {
    expect(() => validateFilePath(42, root)).toThrow(IpcValidationError)
  })
})

describe('validateFileName', () => {
  it('accepts a plain name', () => {
    expect(validateFileName('report.docx')).toBe('report.docx')
  })

  it('rejects path separators', () => {
    expect(() => validateFileName('../evil')).toThrow(IpcValidationError)
    expect(() => validateFileName('a/b')).toThrow(IpcValidationError)
  })

  it('rejects null bytes', () => {
    expect(() => validateFileName('a\0b')).toThrow(IpcValidationError)
  })
})

/**
 * Workspace-relative paths.
 *
 * The app passes these around by design — a case artifact is stored relative so
 * the case file survives being moved — but the validator resolved them against
 * process.cwd(), which for a packaged app is `/`. So "report.pdf" became
 * "/report.pdf" and came back as "Path escapes workspace root": a message about
 * security for what was an arithmetic mistake, and one that read as if the file
 * were somewhere it should not be.
 */
describe('relative paths', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-rel-'))
    fs.mkdirSync(path.join(root, 'cv'), { recursive: true })
    fs.writeFileSync(path.join(root, 'cv', 'CV.pdf'), 'x')
    fs.writeFileSync(path.join(root, 'Report (2).pdf'), 'x')
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('resolves a relative path against the workspace, not the process', () => {
    expect(validateFilePath('cv/CV.pdf', root)).toBe(path.join(root, 'cv', 'CV.pdf'))
  })

  it('handles the spaces and brackets a real filename has', () => {
    expect(validateFilePath('Report (2).pdf', root)).toBe(path.join(root, 'Report (2).pdf'))
  })

  it('still takes an absolute path inside the workspace', () => {
    const abs = path.join(root, 'cv', 'CV.pdf')
    expect(validateFilePath(abs, root)).toBe(abs)
  })

  it('still refuses to climb out with a relative path', () => {
    expect(() => validateFilePath('../../etc/passwd', root)).toThrow(/escapes workspace root/)
    expect(() => validateFilePath('cv/../../..', root)).toThrow(/escapes workspace root/)
  })

  it('still refuses an absolute path outside the workspace', () => {
    expect(() => validateFilePath('/etc/passwd', root)).toThrow(/escapes workspace root/)
  })

  /*
   * Control characters in a path are the injection vector behind the LOK-host
   * arbitrary-write finding: a newline in a path becomes a SECOND line in the
   * newline-framed sidecar protocol (std::getline), and statSync treats it as
   * an ordinary filename byte so it would otherwise pass. Both validators
   * reject the whole class up front.
   */
  it('rejects a newline / control char in the path (LOK-host injection guard)', () => {
    const evil = 'x' + String.fromCharCode(10) + '0 new scalc /tmp/evil/f'
    expect(() => validateFilePath(evil, root)).toThrow(/control character/)
    expect(() => validateFilePath('a' + String.fromCharCode(13) + 'b', root)).toThrow(/control character/)
    expect(() => validateFilePath('a' + String.fromCharCode(0) + 'b', root)).toThrow(/control character/)
  })

  it('validateOpenPath rejects a newline in the path too', () => {
    const evil = '/tmp/x' + String.fromCharCode(10) + '0 new scalc /tmp/evil/f.docx'
    expect(() => validateOpenPath(evil)).toThrow(/control character/)
  })
})

describe('dangling and looping symlink escapes (SEC-01)', () => {
  let root: string
  let outside: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-sec01-root-'))
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-sec01-out-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  })

  it('rejects a dangling leaf symlink inside the workspace pointing to a non-existent file outside', () => {
    const outsideTarget = path.join(outside, 'created-via-dangling-link.txt')
    const danglingLeaf = path.join(root, 'innocent.txt')
    fs.symlinkSync(outsideTarget, danglingLeaf)
    expect(() => validateFilePath(danglingLeaf, root)).toThrow(IpcValidationError)
  })

  it('rejects a path beneath an intermediate dangling symlink pointing outside', () => {
    const outsideSubdir = path.join(outside, 'missing-subdir')
    const danglingDir = path.join(root, 'linked-dir')
    fs.symlinkSync(outsideSubdir, danglingDir)
    expect(() => validateFilePath(path.join(danglingDir, 'evil.txt'), root)).toThrow(IpcValidationError)
  })

  it('rejects a symlink loop (ELOOP) instead of treating it as a fresh leaf', () => {
    const loopA = path.join(root, 'loop-a')
    const loopB = path.join(root, 'loop-b')
    fs.symlinkSync(loopB, loopA)
    fs.symlinkSync(loopA, loopB)
    expect(() => validateFilePath(loopA, root)).toThrow(IpcValidationError)
  })
})
