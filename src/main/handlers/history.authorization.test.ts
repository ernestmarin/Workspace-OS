import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'

/**
 * IPC-HIST-01 — browsing history, bookmarks and the cache.
 *
 * Twelve channels in `src/main/handlers/history.ts`: the eleven `history:*`
 * ones (record, search, suggest, recent, star, unstar, is-starred, bookmarks,
 * forget, forget-since, clear) and `browser:clear-cache`.
 *
 * `history:search` is full-text over **page content**, `history:recent` /
 * `bookmarks` / `suggest` are a record of everything the user has read, and
 * `forget`/`forget-since`/`clear` delete it for good.
 *
 * This module registers with `ipcMain.handle` directly instead of the
 * `ipcHandle` registry, which is why the IPC-CLASS-01 inventory never scanned
 * its snippets (see HISTORY-02). The fixture therefore captures whatever the
 * module passes to `ipcMain.handle`.
 */

const state = vi.hoisted(() => ({
  userData: '',
  calls: [] as string[],
  /** `history.ts` registers with `ipcMain.handle` directly, so the fixture records there. */
  registered: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      state.registered.set(channel, fn)
    },
  },
  session: {
    fromPartition: (part: string) => ({
      clearCache: async () => {
        state.calls.push(`clearCache:${part}`)
      },
    }),
  },
}))
vi.mock('../userdata-path', () => ({ userDataDir: () => state.userData }))
vi.mock('../security', () => ({ BROWSER_PARTITION: 'persist:wos-browser' }))
vi.mock('../browser/history-index', () => ({
  HistoryIndex: class {
    constructor(file: string) {
      state.calls.push(`open:${path.basename(file)}`)
    }
    recordVisit(e: { url: string }) {
      state.calls.push(`recordVisit:${e.url}`)
    }
    search(q: string) {
      state.calls.push(`search:${q}`)
      return []
    }
    suggest(p: string) {
      state.calls.push(`suggest:${p}`)
      return []
    }
    recent() {
      state.calls.push('recent')
      return []
    }
    star(url: string) {
      state.calls.push(`star:${url}`)
    }
    unstar(url: string) {
      state.calls.push(`unstar:${url}`)
    }
    isStarred(url: string) {
      state.calls.push(`isStarred:${url}`)
      return false
    }
    bookmarks() {
      state.calls.push('bookmarks')
      return []
    }
    forget(url: string) {
      state.calls.push(`forget:${url}`)
    }
    forgetSince(since: number) {
      state.calls.push(`forgetSince:${since}`)
      return 0
    }
    clear() {
      state.calls.push('clear')
    }
    close() {
      state.calls.push('close')
    }
  },
}))

const { registerHistoryHandlers } = await import('./history')

const handlers = state.registered

function makeWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: { parent: null }, send: vi.fn() } }
}
function source(win: ReturnType<typeof makeWindow>) {
  return { sender: win.webContents, senderFrame: win.webContents.mainFrame }
}

let owner: ReturnType<typeof makeWindow>

beforeAll(() => {
  registerHistoryHandlers()
})

beforeEach(async () => {
  state.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-hist-'))
  state.calls = []
  owner = makeWindow()
  setMainWindow(owner as never)
})
afterEach(async () => {
  await fs.rm(state.userData, { recursive: true, force: true })
})

/** These handlers register with `ipcMain.handle` directly and are sync, so a
 * refusal is thrown synchronously — wrap so `rejects` sees it. */
function invoke(channel: string, event: unknown, ...args: unknown[]): Promise<unknown> {
  return Promise.resolve().then(() => handlers.get(channel)!(event, ...args))
}

const unauthorized = [
  { kind: 'a missing frame', event: () => ({ sender: owner.webContents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: {} } }) },
  { kind: 'a stale top-level frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: null } }) },
  { kind: 'a foreign window', event: () => source(makeWindow()) },
]

const channels = [
  { channel: IPC.HISTORY_RECORD, args: () => [{ url: 'https://example.com/secret', title: 'Secret' }] },
  { channel: IPC.HISTORY_SEARCH, args: () => [{ query: 'salary' }] },
  { channel: IPC.HISTORY_SUGGEST, args: () => [{ prefix: 'exa' }] },
  { channel: IPC.HISTORY_RECENT, args: () => [{ limit: 10 }] },
  { channel: IPC.HISTORY_STAR, args: () => [{ url: 'https://example.com/secret' }] },
  { channel: IPC.HISTORY_UNSTAR, args: () => [{ url: 'https://example.com/secret' }] },
  { channel: IPC.HISTORY_IS_STARRED, args: () => [{ url: 'https://example.com/secret' }] },
  { channel: IPC.HISTORY_BOOKMARKS, args: () => [{ limit: 10 }] },
  { channel: IPC.HISTORY_FORGET, args: () => [{ url: 'https://example.com/secret' }] },
  { channel: IPC.HISTORY_FORGET_SINCE, args: () => [{ since: 0 }] },
  { channel: IPC.HISTORY_CLEAR, args: () => [] },
  { channel: IPC.BROWSER_CLEAR_CACHE, args: () => [] },
]

describe.each(channels)('$channel', ({ channel, args }) => {
  it.each(unauthorized)('refuses $kind without opening or touching the index', async ({ event }) => {
    await expect(invoke(channel, event(), ...args())).rejects.toThrow(/IPC call rejected/)
    expect(state.calls).toEqual([])
    expect(await fs.readdir(state.userData)).toEqual([])
  })
})

describe('the registered main window keeps the history surface', () => {
  it('records, searches, stars and deletes', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    const event = source(replacement)
    const call = (channel: string, ...args: unknown[]): Promise<unknown> => invoke(channel, event, ...args)

    expect(await call(IPC.HISTORY_RECORD, { url: 'https://example.com/a', title: 'A' })).toEqual({ ok: true })
    expect(await call(IPC.HISTORY_SEARCH, { query: 'salary' })).toEqual([])
    expect(await call(IPC.HISTORY_SUGGEST, { prefix: 'exa' })).toEqual([])
    expect(await call(IPC.HISTORY_RECENT, { limit: 5 })).toEqual([])
    expect(await call(IPC.HISTORY_STAR, { url: 'https://example.com/a' })).toEqual({ ok: true })
    expect(await call(IPC.HISTORY_UNSTAR, { url: 'https://example.com/a' })).toEqual({ ok: true })
    expect(await call(IPC.HISTORY_IS_STARRED, { url: 'https://example.com/a' })).toBe(false)
    expect(await call(IPC.HISTORY_BOOKMARKS, {})).toEqual([])
    expect(await call(IPC.HISTORY_FORGET, { url: 'https://example.com/a' })).toEqual({ ok: true })
    expect(await call(IPC.HISTORY_FORGET_SINCE, { since: 0 })).toEqual({ ok: true, removed: 0 })
    expect(await call(IPC.HISTORY_CLEAR)).toEqual({ ok: true })
    expect(await call(IPC.BROWSER_CLEAR_CACHE)).toEqual({ ok: true })
    // The index is opened lazily on the first owner use (the refusals above never
    // opened it), and never re-opened.
    expect(state.calls.filter((c) => c.startsWith('open:'))).toEqual(['open:browser-history.db'])

    for (const expected of [
      'recordVisit:https://example.com/a',
      'search:salary',
      'suggest:exa',
      'recent',
      'star:https://example.com/a',
      'unstar:https://example.com/a',
      'isStarred:https://example.com/a',
      'bookmarks',
      'forget:https://example.com/a',
      'forgetSince:0',
      'clear',
      'clearCache:persist:wos-browser',
    ]) {
      expect(state.calls, `${expected} was not reached`).toContain(expected)
    }
  })

  it('still answers a record with no url without touching the index', async () => {
    const event = source(owner)
    expect(await invoke(IPC.HISTORY_RECORD, event, {})).toEqual({ ok: false })
    expect(state.calls).toEqual([])
  })
})
