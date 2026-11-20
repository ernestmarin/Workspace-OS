import { describe, it, expect } from 'vitest'
import { zipSync, unzipSync } from 'fflate'
import { newZipBudgetState, zipBudgetFilter, type ZipBudget } from './zipBudget'

/**
 * The archive budget for `.wosapp` import, exercised against REAL archives
 * built with `fflate` rather than a hand-written filter signature — the point
 * is that the budget binds the library's actual inflation, not our idea of it.
 *
 * A deflate bomb is small on disk and huge when expanded. The compressed-size
 * check on the file is necessary but not sufficient; this is the other half.
 */
const tiny: ZipBudget = { maxTotalBytes: 1024, maxEntryBytes: 512, maxEntries: 8 }

function unzipWithBudget(bytes: Uint8Array, budget: ZipBudget) {
  const state = newZipBudgetState()
  const entries = unzipSync(bytes, { filter: zipBudgetFilter(budget, state) })
  return { entries: Object.keys(entries), state }
}

describe('zipBudgetFilter (batch RT-03)', () => {
  it('accepts an ordinary small archive', () => {
    const zip = zipSync({ 'app.json': new TextEncoder().encode('{}'), 'index.html': new TextEncoder().encode('<p>x</p>') })
    const { entries, state } = unzipWithBudget(zip, tiny)
    expect(entries.sort()).toEqual(['app.json', 'index.html'])
    expect(state.rejected).toBeNull()
    expect(state.bytes).toBeGreaterThan(0)
  })

  it('refuses an entry that expands past the per-entry limit (deflate bomb)', () => {
    // 200 KB of zeros compresses to a few hundred bytes.
    const bomb = new Uint8Array(200 * 1024)
    const zip = zipSync({ 'index.html': bomb })
    expect(zip.byteLength).toBeLessThan(200 * 1024)
    const { entries, state } = unzipWithBudget(zip, tiny)
    expect(entries).toEqual([])
    expect(state.rejected).toMatch(/larger than/)
  })

  it('refuses an archive that expands past the total limit across entries', () => {
    const part = new Uint8Array(400)
    const zip = zipSync({ 'a.txt': part, 'b.txt': part, 'c.txt': part })
    const { state } = unzipWithBudget(zip, tiny)
    expect(state.rejected).toMatch(/larger than/i)
  })

  it('refuses an archive with too many entries even when each one is tiny', () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < 40; i += 1) files[`f${i}.txt`] = new Uint8Array([1])
    const zip = zipSync(files)
    const { state } = unzipWithBudget(zip, tiny)
    expect(state.rejected).toMatch(/at most 8 files/)
  })

  it('stops accepting once a rejection is recorded', () => {
    const zip = zipSync({ 'huge.txt': new Uint8Array(4096), 'ok.txt': new Uint8Array([1]) })
    const { entries, state } = unzipWithBudget(zip, tiny)
    // Whatever else is in the archive, the first refusal ends the import.
    expect(state.rejected).not.toBeNull()
    expect(entries.every((n) => n !== 'huge.txt')).toBe(true)
  })

  it('does not spend the entry allowance on directory entries', () => {
    const zip = zipSync({ 'dir/': new Uint8Array(0), 'dir/a.txt': new Uint8Array([1]) })
    const { entries, state } = unzipWithBudget(zip, tiny)
    expect(state.rejected).toBeNull()
    expect(entries).toContain('dir/a.txt')
    expect(state.entries).toBe(1)
  })
})

describe('zipBudgetFilter under the production limits (batch RT-03)', () => {
  // The import path used to accept any entry whose ORIGINAL size was within
  // 2 × 5 MB, with no aggregate and no entry-count bound — so an archive of
  // 200 such entries could demand ~2 GB of inflation and still be "checked".
  const prod: ZipBudget = {
    maxTotalBytes: 20 * 1024 * 1024,
    maxEntryBytes: 5 * 1024 * 1024,
    maxEntries: 200,
  }

  it('rejects the aggregate that the old per-entry check allowed', () => {
    const state = newZipBudgetState()
    const filter = zipBudgetFilter(prod, state)
    // Eight 4 MB entries are individually fine and collectively 32 MB.
    for (let i = 0; i < 8; i += 1) {
      filter({ name: `f${i}.md`, size: 100, originalSize: 4 * 1024 * 1024, compression: 0 })
    }
    expect(state.rejected).toMatch(/larger than 20 MB/)
  })

  it('still accepts the legitimate worst case', () => {
    const state = newZipBudgetState()
    const filter = zipBudgetFilter(prod, state)
    for (let i = 0; i < 4; i += 1) {
      expect(filter({ name: `f${i}.md`, size: 100, originalSize: 4 * 1024 * 1024, compression: 0 })).toBe(true)
    }
    expect(state.rejected).toBeNull()
  })
})
