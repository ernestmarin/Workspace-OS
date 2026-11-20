import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * RT-05 — the IPC surface, audited structurally.
 *
 * There are ~440 channels across ~50 registering modules. Auditing that by
 * reading files is a snapshot, not a guarantee: nothing today stops the next
 * commit from pointing preload at a channel nobody registers (a renderer promise
 * that never settles, with no error anywhere) or from declaring a channel and
 * forgetting to wire it. Two invariants make the map falsifiable:
 *
 *   1. every channel main registers is declared in the IPC registry, and
 *   2. every channel preload can invoke is registered by main.
 *
 * Push channels are the documented exception and are listed by hand below: those
 * flow main → renderer, so "no invoke handler" is correct, and the list is short
 * enough that adding one is a visible decision rather than an accident.
 *
 * This reads source text on purpose. `ipcHandle` mutates a process-global set and
 * importing 50 modules with their Electron dependencies would test the harness,
 * not the surface.
 */

const MAIN_PUSH_CHANNELS = new Set([
  'agent:activity', 'agent:artifact', 'agent:artifacts', 'agent:assistant-response',
  'agent:assistant-text', 'agent:done', 'agent:output', 'agent:pty-exit',
  'agent:pty-output', 'agent:run-meta', 'browser:download', 'fs:watch-event',
  'mail:new-mail', 'notify:open', 'routines:updated', 'runs:updated',
  'shell:output', 'speech:event', 'speech:playback', 'terminal:data', 'terminal:exit',
  // Push channels that were previously hardcoded at BOTH ends and are now in the
  // registry; grouped here by origin so the list reads as a decision.
  'apps:test-progress', 'browser:open-tab', 'codex:question', 'lok:callback',
  'updater:update-ready', 'wiki:changed', 'workspace:root-changed',
])

/**
 * `agent:action-invoke` is pushed by main and answered with a fire-and-forget
 * `send` on `agent:action-result` (reqId-correlated in main), so it has an
 * `ipcMain.on` listener rather than an invoke handler.
 */
const FIRE_AND_FORGET_RESPONSES = new Set(['agent:action-result'])

const root = path.resolve(__dirname, '../..')
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8')

const ipcSource = read('src/main/ipc-channels.ts')
/** const name → channel value. */
const byName = new Map<string, string>()
/** channel value → const name. */
const declared = new Map<string, string>()
for (const m of ipcSource.matchAll(/^\s{2}([A-Z_0-9]+):\s*'([^']+)'/gm)) {
  byName.set(m[1], m[2])
  declared.set(m[2], m[1])
}

/** Every `.ts` under src/main except its own tests. */
function mainSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return mainSources(full)
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return []
    return [full]
  })
}

/** Resolves `IPC.FOO` and `'literal:channel'` registrations, wherever registered. */
function registeredHandlers(): { channel: string; file: string; literal: boolean }[] {
  const found: { channel: string; file: string; literal: boolean }[] = []
  const re = /ipc(?:Handle|Main\.handle)\(\s*(?:[A-Za-z_$][\w$.]*\s*,\s*)?(?:IPC\.([A-Z_0-9]+)|'([^']+)')/g
  for (const file of mainSources(path.join(root, 'src/main'))) {
    if (file.endsWith('ipc-surface.test.ts')) continue
    const source = fs.readFileSync(file, 'utf8')
    for (const m of source.matchAll(re)) {
      const channel = m[2] ?? byName.get(m[1]) ?? `UNKNOWN_CONST:${m[1]}`
      found.push({ channel, file: path.relative(root, file), literal: m[2] !== undefined })
    }
  }
  return found
}

const handlers = registeredHandlers()
const handlerChannels = new Set(handlers.map((h) => h.channel))

describe('RT-05 IPC surface completeness', () => {
  it('extracts the registry and the handler registrations at all', () => {
    // Guards the extraction itself: a silent parse failure would make every
    // assertion below vacuously pass.
    expect(declared.size).toBeGreaterThan(200)
    expect(handlers.length).toBeGreaterThan(200)
  })

  it('never registers a channel that is missing from the IPC registry', () => {
    const undeclared = handlers
      .filter((h) => !declared.has(h.channel))
      .map((h) => `${h.channel} (${h.file})`)
    expect(undeclared).toEqual([])
  })

  it('resolves every IPC constant used by a handler', () => {
    expect(handlers.filter((h) => h.channel.startsWith('UNKNOWN_CONST'))).toEqual([])
  })

  it('registers each channel exactly once (a duplicate throws at startup)', () => {
    const counts = new Map<string, number>()
    for (const h of handlers) counts.set(h.channel, (counts.get(h.channel) ?? 0) + 1)
    expect([...counts].filter(([, n]) => n > 1)).toEqual([])
  })

  it('registers, in main, every channel preload can invoke', () => {
    const preload = read('src/preload/index.ts')
    const invoked = new Set<string>()
    const re = /ipcRenderer\.(?:invoke|send)\(\s*(?:IPC\.([A-Z_0-9]+)|'([^']+)')/g
    for (const m of preload.matchAll(re)) invoked.add(m[2] ?? byName.get(m[1]) ?? `UNKNOWN_CONST:${m[1]}`)
    expect(invoked.size).toBeGreaterThan(200)
    const orphans = [...invoked].filter(
      (c) => !handlerChannels.has(c) && !MAIN_PUSH_CHANNELS.has(c) && !FIRE_AND_FORGET_RESPONSES.has(c),
    )
    expect(orphans).toEqual([])
  })

  it('keeps every push channel out of the invoke surface', () => {
    const preload = read('src/preload/index.ts')
    // A push channel must never be invoked from preload: it has no handler, so
    // the promise would never settle. `on` is the only correct use.
    // Exact call matching, not substring: `IPC.SPEECH_PLAYBACK` is a prefix of
    // `IPC.SPEECH_PLAYBACK_DONE`, which IS invoked.
    for (const channel of MAIN_PUSH_CHANNELS) {
      const name = declared.get(channel)
      expect(new RegExp(`ipcRenderer\\.invoke\\(IPC\\.${name}[,)]`).test(preload), channel).toBe(false)
    }
  })

  it('hardcodes no channel string in preload or in a registration site', () => {
    const preload = read('src/preload/index.ts')
    expect(preload.match(/ipcRenderer\.(?:invoke|send|on|removeListener)\(\s*'/g) ?? []).toEqual([])
    const literal = handlers.filter((h) => h.literal).map((h) => `${h.channel} (${h.file})`)
    expect(literal).toEqual([])
  })

  it('declares a channel for every one of them, including the push set', () => {
    for (const channel of MAIN_PUSH_CHANNELS) expect(declared.has(channel), channel).toBe(true)
    for (const channel of FIRE_AND_FORGET_RESPONSES) expect(declared.has(channel), channel).toBe(true)
  })
})
