import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * IPC-SEARCH-02 — the guard's *position*, not only its presence.
 *
 * `ensureIndex()` opens `userData/search-index.db` on first use, and the note
 * filed at IPC-SEARCH-01 said the lazy open was harmless "because the guard runs
 * first". That is a claim about order, and order is exactly what a test asserting
 * *presence* cannot see — the same shape of blind spot as IPC-ZIP-INDEX-01, where
 * the entry budget existed but sat after the allocation it was meant to prevent.
 *
 * So this test reads the module's own text: every channel registered in
 * `search.ts` must call `assertMainWindowFrame(event)` before anything touches
 * the index, the filesystem or the workspace root. If somebody moves the guard
 * below `ensureIndex()`, the outcome for a legitimate caller is identical and the
 * old tests stay green — this one fails.
 *
 * A source-level invariant, stated as such: it proves order in the registration
 * block, not runtime behaviour. Behaviour stays with `search.authorization.test.ts`.
 */

const SRC = path.join(process.cwd(), 'src/main/handlers/search.ts')

interface HandlerBlock {
  channel: string
  body: string
}

/** Split the registration block into one body per `ipcHandle(ipcMain, IPC.X, …)`. */
function handlerBlocks(source: string): HandlerBlock[] {
  const starts = [...source.matchAll(/ipcHandle\(\s*ipcMain,\s*(IPC\.[A-Z_0-9]+)/g)]
  return starts.map((m, i) => ({
    channel: m[1],
    body: source.slice(m.index!, i + 1 < starts.length ? starts[i + 1].index! : source.length),
  }))
}

/** Everything that can only be legitimate AFTER the caller is known. */
const SIDE_EFFECTS = [
  { name: 'ensureIndex(', why: 'opens the search database' },
  { name: 'getWorkspaceRoot(', why: 'resolves the workspace the answer is scoped to' },
  { name: 'fsSync.', why: 'touches the filesystem' },
  { name: 'fs.', why: 'touches the filesystem asynchronously' },
  { name: 'validateFilePath(', why: 'resolves a path against the workspace root' },
]

describe('every search channel checks who is asking before it does anything', () => {
  const source = fs.readFileSync(SRC, 'utf8')
  const blocks = handlerBlocks(source)

  it('the module registers the channels this test thinks it registers', () => {
    // A parser that silently matched nothing would make every case below pass.
    expect(blocks.length).toBeGreaterThanOrEqual(13)
    expect(blocks.map((b) => b.channel)).toContain('IPC.SEARCH_QUERY')
  })

  it('the guard is the first statement of every handler', () => {
    const offenders = blocks
      .filter((b) => {
        const afterOpen = b.body.slice(b.body.indexOf('=>') + 2)
        const firstStatement = afterOpen
          .split('\n')
          .map((l) => l.trim())
          // Skip the opening brace line(s) and any comment above the body.
          .find((l) => l.length > 0 && l !== '{' && l !== '}' && !l.startsWith('//'))
        return firstStatement !== 'assertMainWindowFrame(event)'
      })
      .map((b) => b.channel)
    expect(offenders).toEqual([])
  })

  it('the guard precedes every side effect in the handler body', () => {
    const offenders: string[] = []
    for (const { channel, body } of blocks) {
      const guard = body.indexOf('assertMainWindowFrame(event)')
      if (guard < 0) {
        offenders.push(`${channel}: no guard`)
        continue
      }
      for (const effect of SIDE_EFFECTS) {
        const at = body.indexOf(effect.name)
        // `ensureIndex()`'s own definition lives outside the blocks; any hit
        // before the guard means the handler did the work before asking who.
        if (at >= 0 && at < guard) offenders.push(`${channel}: ${effect.name} before the guard`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the parser sees the side effects it claims to look for', () => {
    // Otherwise "no offenders" would just mean "nothing matched".
    const withIndex = blocks.filter((b) => b.body.includes('ensureIndex('))
    expect(withIndex.length).toBeGreaterThan(5)
    expect(SIDE_EFFECTS.map((e) => e.name)).toContain('ensureIndex(')
  })
})
