import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'

/**
 * IPC-SEARCH-01 — the search / knowledge / link surface reads the user's notes
 * and none of its thirteen handlers looked at the event.
 *
 * `validateSearchQuery()` and `validateFilePath()` constrain the *input*; they
 * do not answer "who is asking". Every handler here returns note content or
 * note structure, so an unguarded call is a privacy path even though nothing is
 * written.
 *
 * The SQLite index and the indexer are mocked (an external boundary; the claim
 * is about authorization, not about FTS). Scoping (`scopeByPath`, `scopeGraph`,
 * `inRoot`), input validation and the guard are the real implementations.
 */

const state = vi.hoisted(() => ({ root: '', userData: '' }))

vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => state.root || null }))
vi.mock('../host-profile', () => ({ contentRel: (_root: string, name: string) => name }))

const calls = vi.hoisted(() => ({
  query: 0, symbols: 0, ask: 0, backlinks: 0, outgoing: 0, related: 0, graph: 0, resolve: 0, text: 0,
  start: [] as string[], prioritize: [] as string[],
}))

vi.mock('../search/index-db', () => ({
  SearchIndex: class {
    query(): unknown[] { calls.query++; return [{ path: path.join(state.root, 'a.md') }] }
    searchSymbols(): unknown[] { calls.symbols++; return [{ path: path.join(state.root, 'a.md') }] }
    ask(): unknown[] { calls.ask++; return [{ path: path.join(state.root, 'a.md'), score: 1 }] }
    text(): null { calls.text++; return null }
    backlinksFor(): unknown[] { calls.backlinks++; return [{ path: path.join(state.root, 'a.md') }] }
    outgoingLinks(): unknown[] { calls.outgoing++; return [{ resolvedPath: null }] }
    graph(): { nodes: unknown[]; edges: unknown[] } { calls.graph++; return { nodes: [], edges: [] } }
    relatedNotes(): unknown[] { calls.related++; return [{ path: path.join(state.root, 'a.md') }] }
    resolveName(): string { calls.resolve++; return path.join(state.root, 'a.md') }
    close(): void { /* no database in this unit */ }
  },
}))
vi.mock('../search/indexer', () => ({
  Indexer: class {
    status(): unknown { return { running: false, indexed: 0, queued: 0, done: 0, total: 0 } }
    async start(root: string): Promise<void> { calls.start.push(root) }
    prioritize(file: string): void { calls.prioritize.push(file) }
    async stop(): Promise<void> { /* nothing running */ }
  },
}))

const { registerSearchHandlers } = await import('./search')

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, Handler>()

function makeWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: { parent: null }, send: vi.fn() } }
}
function source(win: ReturnType<typeof makeWindow>) {
  return { sender: win.webContents, senderFrame: win.webContents.mainFrame }
}

let owner: ReturnType<typeof makeWindow>
let root = ''
beforeAll(() => registerSearchHandlers({ handle: handlers.set.bind(handlers) } as never))
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-search-ipc-'))
  state.root = root
  state.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-search-data-'))
  await fs.writeFile(path.join(root, 'a.md'), '# note\nsecret body\n')
  owner = makeWindow()
  setMainWindow(owner as never)
  calls.query = calls.symbols = calls.ask = calls.backlinks = calls.outgoing = calls.related = calls.graph = calls.resolve = calls.text = 0
  calls.start.length = 0
  calls.prioritize.length = 0
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(state.userData, { recursive: true, force: true })
})

const unauthorized: Array<{ kind: string; event: () => unknown }> = [
  { kind: 'a missing frame', event: () => ({ sender: owner.webContents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: {} } }) },
  { kind: 'a stale top-level frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: null } }) },
  { kind: 'a foreign window', event: () => source(makeWindow()) },
]

const channels: Array<{ channel: string; args: () => unknown[]; counted?: keyof typeof calls }> = [
  { channel: IPC.SEARCH_QUERY, args: () => ['note'], counted: 'query' },
  { channel: IPC.SEARCH_SYMBOLS, args: () => ['note'], counted: 'symbols' },
  { channel: IPC.SEARCH_INDEX_STATUS, args: () => [] },
  { channel: IPC.SEARCH_START, args: () => [] },
  { channel: IPC.SEARCH_PRIORITIZE, args: () => [path.join(root, 'a.md')] },
  { channel: IPC.KNOWLEDGE_SEARCH, args: () => ['secret', 5], counted: 'ask' },
  { channel: IPC.KNOWLEDGE_READ, args: () => ['a.md', 0], counted: 'text' },
  { channel: IPC.LINKS_BACKLINKS, args: () => [path.join(root, 'a.md')], counted: 'backlinks' },
  { channel: IPC.LINKS_OUTGOING, args: () => [path.join(root, 'a.md')], counted: 'outgoing' },
  { channel: IPC.LINKS_STUBS, args: () => [], counted: 'graph' },
  { channel: IPC.LINKS_GRAPH, args: () => [], counted: 'graph' },
  { channel: IPC.LINKS_RELATED, args: () => [path.join(root, 'a.md')], counted: 'related' },
  { channel: IPC.LINKS_RESOLVE, args: () => ['Some Note'], counted: 'resolve' },
]

describe.each(channels)('$channel', ({ channel, args, counted }) => {
  it.each(unauthorized)('refuses $kind without reaching the index', async ({ event }) => {
    const before = counted ? (calls[counted] as number) : 0
    await expect(handlers.get(channel)!(event(), ...args())).rejects.toThrow(/IPC call rejected/)
    if (counted) expect(calls[counted]).toBe(before)
    expect(calls.start).toEqual([])
    expect(calls.prioritize).toEqual([])
    // Nothing was indexed on behalf of the caller.
    expect(await fs.readdir(state.userData)).toEqual([])
  })
})

describe('the registered main window keeps the surface', () => {
  it('answers every channel for the current owner and indexes only workspace paths', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    const event = source(replacement)
    const call = (channel: string, ...args: unknown[]): Promise<unknown> => handlers.get(channel)!(event, ...args)

    expect(await call(IPC.SEARCH_QUERY, 'note')).toEqual([{ path: path.join(root, 'a.md') }])
    expect(await call(IPC.SEARCH_SYMBOLS, 'note')).toHaveLength(1)
    expect(await call(IPC.SEARCH_INDEX_STATUS)).toMatchObject({ indexed: 0 })
    await call(IPC.SEARCH_START)
    expect(calls.start).toEqual([root])

    await call(IPC.SEARCH_PRIORITIZE, path.join(root, 'a.md'))
    expect(calls.prioritize).toEqual([path.join(root, 'a.md')])
    // A path outside the workspace is still dropped by the pre-existing scope check.
    await call(IPC.SEARCH_PRIORITIZE, path.join(os.tmpdir(), 'elsewhere.md'))
    expect(calls.prioritize).toHaveLength(1)

    // knowledge:search returns workspace-relative paths; knowledge:read extracts text.
    expect(await call(IPC.KNOWLEDGE_SEARCH, 'secret', 5)).toEqual([{ path: 'a.md', score: 1 }])
    const read = await call(IPC.KNOWLEDGE_READ, 'a.md', 0) as { path: string; text: string; more: boolean }
    expect(read.path).toBe('a.md')
    expect(read.text).toContain('secret body')
    expect(read.more).toBe(false)

    expect(await call(IPC.LINKS_BACKLINKS, path.join(root, 'a.md'))).toHaveLength(1)
    expect(await call(IPC.LINKS_OUTGOING, path.join(root, 'a.md'))).toEqual([{ resolvedPath: null }])
    expect(await call(IPC.LINKS_STUBS)).toEqual([])
    expect(await call(IPC.LINKS_GRAPH)).toEqual({ nodes: [], edges: [] })
    expect(await call(IPC.LINKS_RELATED, path.join(root, 'a.md'))).toHaveLength(1)
    expect(await call(IPC.LINKS_RESOLVE, 'Some Note')).toBe(path.join(root, 'a.md'))
  })

  it('keeps the surviving input validation', async () => {
    const event = source(owner)
    await expect(handlers.get(IPC.SEARCH_QUERY)!(event, '')).rejects.toThrow()
    await expect(handlers.get(IPC.LINKS_RESOLVE)!(event, '')).rejects.toThrow(/non-empty string/)
    await expect(handlers.get(IPC.LINKS_RESOLVE)!(event, 'x'.repeat(501))).rejects.toThrow(/too long/)
    // Traversal is still refused before the index is consulted.
    await expect(handlers.get(IPC.LINKS_BACKLINKS)!(event, '../outside.md')).rejects.toThrow()
    await expect(handlers.get(IPC.KNOWLEDGE_READ)!(event, '../outside.md', 0)).rejects.toThrow()
  })
})
