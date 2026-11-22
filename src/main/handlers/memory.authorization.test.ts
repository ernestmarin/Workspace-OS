import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'

/**
 * IPC-MEM-01 — the workspace memory store.
 *
 * Fifteen channels the IPC-CLASS-01 triage put in verdict A (`memory:status`
 * stays B: it reports the store size and timestamps):
 *
 *   - the write side — `remember`, `correct`, `confirm`, `forget` — mutates the
 *     personal memory store; `forget` is destructive and `correct` keeps the old
 *     version as history;
 *   - the read side — `query`, `recent`, `history`, `similar`, `search`, `list`,
 *     `stats`, `lastTidy` — returns what the app has been told about the user;
 *   - the model side — `propose` reads a session digest and calls the person's
 *     model; `tidy` reorganises the store; `meaning` reports the embedder.
 *
 * The memory service, the embedder, the proposals and the tidy are mocked at
 * their boundaries, so a refusal must leave every counter empty and the app
 * state dir untouched.
 */

const state = vi.hoisted(() => ({
  root: '',
  userData: '',
  calls: [] as string[],
}))

vi.mock('electron', () => ({
  app: { getPath: (n: string) => (n === 'userData' ? state.userData : state.root) },
}))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => state.root || null }))
vi.mock('../memory/embedder', () => ({ workerEmbedder: (dir: string) => ({ dir }) }))
vi.mock('../memory/memory-service', () => {
  const rec = (name: string) => () => {
    state.calls.push(name)
    return name === 'confirm' || name === 'forget' ? true : []
  }
  return {
    setEmbedder: () => state.calls.push('setEmbedder'),
    embedderStatus: () => 'ready',
    embedPending: async () => state.calls.push('embedPending'),
    remember: rec('remember'),
    correct: rec('correct'),
    confirm: rec('confirm'),
    history: rec('history'),
    similar: rec('similar'),
    search: rec('search'),
    recallMeaning: rec('recallMeaning'),
    toMatchQuery: (q: string) => q.trim().length > 0,
    list: rec('list'),
    forget: rec('forget'),
    stats: () => {
      state.calls.push('stats')
      return { count: 0 }
    },
  }
})
vi.mock('../memory/proposals', () => ({
  proposeFromSession: async (_ctx: unknown, digest: { turns: unknown[] }) => {
    state.calls.push('proposeFromSession')
    return { proposed: digest.turns.length, skipped: 0 }
  },
}))
vi.mock('../memory/tidy', () => ({
  tidy: async () => {
    state.calls.push('tidy')
    return { moved: 0 }
  },
  tidyDue: () => false,
  lastTidy: (ctx: { root: string | null }) => {
    state.calls.push('lastTidy')
    return ctx.root ? null : null
  },
}))
vi.mock('../agent/providerText', () => ({
  runProviderOneShot: async () => {
    state.calls.push('runProviderOneShot')
    return 'model output'
  },
}))
vi.mock('../memory/pulse-memory', () => ({
  PulseMemory: class {
    status() {
      state.calls.push('pulse.status')
      return 'available'
    }
    query() {
      state.calls.push('pulse.query')
      return []
    }
    recent() {
      state.calls.push('pulse.recent')
      return []
    }
    close() {
      state.calls.push('pulse.close')
    }
  },
}))

const { registerMemoryHandlers } = await import('./memory')

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, Handler>()

function makeWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: { parent: null }, send: vi.fn() } }
}
function source(win: ReturnType<typeof makeWindow>) {
  return { sender: win.webContents, senderFrame: win.webContents.mainFrame }
}

let owner: ReturnType<typeof makeWindow>

beforeAll(() => {
  process.env.WOS_NO_TIDY = '1'
  const ipcMain = { handle: handlers.set.bind(handlers) }
  registerMemoryHandlers(ipcMain as never)
})

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-mem-root-'))
  state.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-mem-data-'))
  state.calls = []
  owner = makeWindow()
  setMainWindow(owner as never)
})
afterEach(async () => {
  for (const d of [state.root, state.userData]) await fs.rm(d, { recursive: true, force: true })
})

const unauthorized = [
  { kind: 'a missing frame', event: () => ({ sender: owner.webContents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: {} } }) },
  { kind: 'a stale top-level frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: null } }) },
  { kind: 'a foreign window', event: () => source(makeWindow()) },
]

const channels = [
  { channel: IPC.MEMORY_QUERY, args: () => [{ types: ['decision'], limit: 5 }] },
  { channel: IPC.MEMORY_RECENT, args: () => [5] },
  { channel: IPC.MEMORY_REMEMBER, args: () => [{ kind: 'fact', text: 'the API key lives in 1Password' }] },
  { channel: IPC.MEMORY_CORRECT, args: () => ['mem-1', 'the key lives in Vaultwarden', 'you', 'typed'] },
  { channel: IPC.MEMORY_CONFIRM, args: () => ['mem-1'] },
  { channel: IPC.MEMORY_HISTORY, args: () => ['mem-1'] },
  { channel: IPC.MEMORY_SIMILAR, args: () => ['where does the key live', 'workspace'] },
  { channel: IPC.MEMORY_SEARCH, args: () => ['key', 10] },
  { channel: IPC.MEMORY_MEANING, args: () => [] },
  { channel: IPC.MEMORY_PROPOSE, args: () => [{ title: 'a session', turns: [{ ask: 'fix the parser', outcome: 'done' }] }, 'small-model'] },
  { channel: IPC.MEMORY_TIDY, args: () => [] },
  { channel: IPC.MEMORY_LASTTIDY, args: () => [] },
  { channel: IPC.MEMORY_LIST, args: () => [{ limit: 10 }] },
  { channel: IPC.MEMORY_FORGET, args: () => ['mem-1'] },
  { channel: IPC.MEMORY_STATS, args: () => [] },
]

describe.each(channels)('$channel', ({ channel, args }) => {
  it.each(unauthorized)('refuses $kind without touching the store or the model', async ({ event }) => {
    await expect(handlers.get(channel)!(event(), ...args())).rejects.toThrow(/IPC call rejected/)
    expect(state.calls).toEqual([])
    expect(await fs.readdir(state.root)).toEqual([])
    expect(await fs.readdir(state.userData)).toEqual([])
  })
})

describe('the registered main window keeps the memory surface', () => {
  it('reaches every store operation and the model path', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    const event = source(replacement)
    const call = (channel: string, ...args: unknown[]): Promise<unknown> => handlers.get(channel)!(event, ...args)

    await call(IPC.MEMORY_QUERY, { types: ['decision'] })
    await call(IPC.MEMORY_RECENT, 5)
    await call(IPC.MEMORY_REMEMBER, { kind: 'fact', text: 'the API key lives in 1Password' })
    await call(IPC.MEMORY_CORRECT, 'mem-1', 'the key lives in Vaultwarden', 'you', 'typed')
    await call(IPC.MEMORY_CONFIRM, 'mem-1')
    await call(IPC.MEMORY_HISTORY, 'mem-1')
    await call(IPC.MEMORY_SIMILAR, 'where does the key live', 'global')
    await call(IPC.MEMORY_SEARCH, 'key', 10)
    await call(IPC.MEMORY_SEARCH, '', 10)
    expect(await call(IPC.MEMORY_MEANING)).toEqual({ status: 'ready' })
    expect(await call(IPC.MEMORY_PROPOSE, { turns: [{ ask: 'fix the parser', outcome: 'done' }] }, 'small-model')).toEqual({ proposed: 1, skipped: 0 })
    await call(IPC.MEMORY_TIDY)
    await call(IPC.MEMORY_LASTTIDY)
    await call(IPC.MEMORY_LIST, { limit: 10 })
    await call(IPC.MEMORY_FORGET, 'mem-1')
    expect(await call(IPC.MEMORY_STATS)).toEqual({ count: 0 })

    for (const name of [
      'pulse.query',
      'pulse.recent',
      'remember',
      'correct',
      'confirm',
      'history',
      'similar',
      'recallMeaning',
      'search',
      'proposeFromSession',
      'tidy',
      'lastTidy',
      'list',
      'forget',
      'stats',
    ]) {
      expect(state.calls, `${name} was not reached`).toContain(name)
    }
  })

  it('still refuses an empty memory and an unknown id, without touching the store', async () => {
    const event = source(owner)
    const before = [...state.calls]
    await expect(handlers.get(IPC.MEMORY_REMEMBER)!(event, { text: '   ' })).rejects.toThrow(/needs text/)
    await expect(handlers.get(IPC.MEMORY_CORRECT)!(event, 'mem-1', 'x'.repeat(2001))).rejects.toThrow(/too long/)
    await expect(handlers.get(IPC.MEMORY_FORGET)!(event, '')).rejects.toThrow(/Which memory/)
    expect(state.calls).toEqual(before)
  })
})
