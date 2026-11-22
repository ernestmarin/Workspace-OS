import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * IPC-DOC-WRITE-02 (wiring half) — every engine-free document writer must put
 * its temp file in place through `commitTemp`, and none may `rename` over the
 * document directly.
 *
 * The behavioural proof lives in the xlsx and docx conflict suites; this is the
 * mechanical one, for the writers whose fixtures are expensive and for the next
 * writer somebody adds. A new writer that renames directly fails here — the same
 * reason the IPC sweep exists instead of trusting review to remember.
 */

const WRITERS = [
  'xlsx-cell-writer.ts',
  'xlsx-range-writer.ts',
  'docx-cards-writer.ts',
  'docx-cc-writer.ts',
  'docx-table-writer.ts',
  'pptx-shape-writer.ts',
  'pptx-table-writer.ts',
]

const source = (name: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'src/main', name), 'utf8')

describe('document writers replace files only through commitTemp', () => {
  for (const name of WRITERS) {
    it(`${name} commits through the guard`, () => {
      const src = source(name)
      expect(src).toContain('commitTemp(')
      expect(src).not.toMatch(/fs\.renameSync\(/)
    })
  }

  it('the writers on the docx/pptx path read bytes and identity from one descriptor', () => {
    for (const name of WRITERS.filter((n) => !n.startsWith('xlsx-'))) {
      expect(source(name)).toContain('readWithIdentity(')
    }
  })

  it('the guard itself still refuses on a changed file', () => {
    // If `commitTemp` ever stopped checking, the writers above would all still
    // "look" wired. This keeps the primitive honest at the source level.
    const id = fs.readFileSync(path.join(process.cwd(), 'src/main/doc-identity.ts'), 'utf8')
    expect(id).toMatch(/export function commitTemp/)
    expect(id).toMatch(/if \(changedSince\(identity, filePath\)\) \{/)
  })
})
