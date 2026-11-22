import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * IPC-DIALOG-PARENT-01 — one rule for every native dialog in the main process.
 *
 * The bug class is small and repetitive: a module captures the `BrowserWindow` it
 * was registered with and parents dialogs to it forever. It works until
 * `createWindow()` replaces the window (macOS `activate`, or any reopen), and then
 * Electron throws "Object has been destroyed" instead of showing a picker. It has
 * been found twice (WATCH-02, OFFICE-02) and a third time in `lok.ts` while fixing
 * those two, so the control is mechanical rather than remembered.
 *
 * Behaviour is covered by `watcher.dialog-parent.test.ts` and
 * `office.dialog-parent.test.ts`; this is the sweep that catches the next call
 * site — the ones whose modules need a heavy harness to get as far as a dialog.
 */

const MAIN = path.join(process.cwd(), 'src/main')

function sources(dir = MAIN): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sources(full))
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) out.push(full)
  }
  return out
}

/** First argument names that are legitimate: a live-resolved parent, or options. */
const ALLOWED = new Set([
  'parent', // the live window, resolved by dialogParent() at call time
  'options',
  'opts',
  'saveOptions',
  'openOptions',
  'pickOptions',
])

interface CallSite {
  file: string
  line: number
  first: string
}

function callSites(): CallSite[] {
  const sites: CallSite[] = []
  for (const file of sources()) {
    const text = fs.readFileSync(file, 'utf8')
    const re = /dialog\.show(?:Open|Save)Dialog\(\s*([A-Za-z_$][\w$]*|\{)/g
    for (const m of text.matchAll(re)) {
      sites.push({
        file: path.relative(process.cwd(), file),
        line: text.slice(0, m.index!).split('\n').length,
        first: m[1],
      })
    }
  }
  return sites
}

describe('native dialogs resolve their parent at call time', () => {
  it('no dialog is parented to a captured window identifier', () => {
    const offenders = callSites()
      .filter((s) => s.first !== '{' && !ALLOWED.has(s.first))
      .map((s) => `${s.file}:${s.line} → ${s.first}`)
    expect(offenders).toEqual([])
  })

  it('the modules that own dialogs go through the shared helper', () => {
    for (const name of ['watcher.ts', 'office.ts', 'lok.ts', 'apps.ts']) {
      expect(fs.readFileSync(path.join(MAIN, 'handlers', name), 'utf8')).toContain('dialogParent()')
    }
  })

  it('the sweep sees the dialogs it claims to police', () => {
    // Guard against a regex that matches nothing and therefore passes.
    const sites = callSites()
    expect(sites.length).toBeGreaterThanOrEqual(10)
    expect(sites.some((s) => s.file.endsWith('handlers/watcher.ts'))).toBe(true)
    expect(sites.some((s) => s.first === '{')).toBe(true) // mail.ts: unparented by design
  })

  it('the helper itself never returns a destroyed window', () => {
    const src = fs.readFileSync(path.join(MAIN, 'main-window.ts'), 'utf8')
    expect(src).toMatch(/export function dialogParent\(\): BrowserWindow \| null \{\s*return mainWindow\(\)/)
  })
})
