import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'

/**
 * IPC-STORE-01 — the twenty-five derived-state store channels.
 *
 * Metrics, collections, ranges, their transclusion/link tables, the component
 * store and the wiki's read/undo surface. Individually the least alarming
 * channels in the inventory; together they can delete every metric, refresh
 * every collection, sync links into closed files and **undo wiki pages**. The
 * IPC-CLASS-01 triage put all of them in verdict A.
 *
 * The stores are replaced by counters that answer empty, so "was the store
 * consulted?" is the observable. Every channel must (a) refuse four kinds of
 * non-owner caller without touching its store and (b) admit the owner.
 */

const state = vi.hoisted(() => ({ root: '', userData: '', consulted: [] as string[] }))
const store = (name: string) => ({
  list: () => { state.consulted.push(`${name}.list`); return [] },
  get: () => { state.consulted.push(`${name}.get`); return null },
  remove: () => { state.consulted.push(`${name}.remove`) },
  allLinks: () => { state.consulted.push(`${name}.allLinks`); return [] },
  forFile: () => { state.consulted.push(`${name}.forFile`); return [] },
  forMetric: () => { state.consulted.push(`${name}.forMetric`); return [] },
  forCollection: () => { state.consulted.push(`${name}.forCollection`); return [] },
  forRange: () => { state.consulted.push(`${name}.forRange`); return [] },
})

vi.mock('electron', () => ({
  default: { app: { getPath: (n: string) => (n === 'userData' ? state.userData : state.root) } },
  app: { getPath: (n: string) => (n === 'userData' ? state.userData : state.root) },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => state.root || null }))
vi.mock('../host-profile', () => ({ contentRel: (_r: string, n: string) => n }))
vi.mock('../metrics', async (orig) => ({
  ...(await orig() as object),
  metrics: store('metrics'),
  isSourced: () => false,
}))
vi.mock('../transclusions', async (orig) => ({ ...(await orig() as object), transclusions: store('transclusions') }))
vi.mock('../collectionLinks', async (orig) => ({ ...(await orig() as object), collectionLinks: store('collectionLinks') }))
vi.mock('../rangeLinks', async (orig) => ({ ...(await orig() as object), rangeLinks: store('rangeLinks') }))
vi.mock('../collections', async (orig) => ({
  ...(await orig() as object),
  collections: store('collections'),
  isSourcedCollection: () => false,
}))
vi.mock('../ranges', async (orig) => ({
  ...(await orig() as object),
  ranges: store('ranges'),
  isSourcedRange: () => false,
}))
vi.mock('../wiki/wiki-store', async (orig) => ({
  ...(await orig() as object),
  changes: () => { state.consulted.push('wiki.changes'); return [] },
  sources: () => { state.consulted.push('wiki.sources'); return {} },
  check: () => { state.consulted.push('wiki.check'); return null },
  undo: () => { state.consulted.push('wiki.undo'); return { restored: [] } },
  changePages: () => { state.consulted.push('wiki.changePages'); return [] },
  wikiDir: () => path.join(state.root, 'Wiki'),
}))
vi.mock('../wiki/wiki-page', () => ({ WIKI_DIR: 'Wiki' }))
vi.mock('../agent/providerText', () => ({ runProviderOneShot: async () => 'page' }))
vi.mock('../search/extract', () => ({ extractText: async () => 'text' }))
vi.mock('./search', () => ({ indexNow: async () => {} }))

const { registerMetricHandlers } = await import('./metrics')
const { registerCollectionHandlers } = await import('./collections')
const { registerRangeHandlers } = await import('./ranges')
const { registerComponentsHandlers } = await import('./components')
const { registerWikiHandlers } = await import('./wiki')

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

beforeAll(() => {
  const ipcMain = { handle: handlers.set.bind(handlers) }
  registerMetricHandlers(ipcMain as never)
  registerCollectionHandlers(ipcMain as never)
  registerRangeHandlers(ipcMain as never)
  registerComponentsHandlers(ipcMain as never)
  registerWikiHandlers(ipcMain as never)
})

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-stores-ipc-'))
  state.root = root
  state.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-stores-data-'))
  state.consulted = []
  owner = makeWindow()
  setMainWindow(owner as never)
})
afterEach(async () => {
  for (const d of [root, state.userData]) await fs.rm(d, { recursive: true, force: true })
})

const unauthorized = [
  { kind: 'a missing frame', event: () => ({ sender: owner.webContents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: {} } }) },
  { kind: 'a stale top-level frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: null } }) },
  { kind: 'a foreign window', event: () => source(makeWindow()) },
]

const channels: Array<{ channel: string; args: () => unknown[]; fsOnly?: boolean }> = [
  { channel: IPC.METRIC_DELETE, args: () => ['metric-abc'] },
  { channel: IPC.METRIC_REFRESHALLFROMSOURCE, args: () => [] },
  { channel: IPC.TRANSCLUSION_ALLLINKS, args: () => [] },
  { channel: IPC.TRANSCLUSION_FORFILE, args: () => [path.join(root, 'note.md')] },
  { channel: IPC.TRANSCLUSION_PREVIEWSYNCALL, args: () => ['metric-abc', null] },
  { channel: IPC.TRANSCLUSION_REMOVE, args: () => ['link-abc'] },
  { channel: IPC.COLLECTION_DELETE, args: () => ['coll-abc'] },
  { channel: IPC.COLLECTION_REFRESHALL, args: () => [] },
  { channel: IPC.COLLECTIONLINK_ALLLINKS, args: () => [] },
  { channel: IPC.COLLECTIONLINK_FORFILE, args: () => [path.join(root, 'note.md')] },
  { channel: IPC.COLLECTIONLINK_PREVIEWSYNCALL, args: () => ['coll-abc', null] },
  { channel: IPC.COLLECTIONLINK_REMOVE, args: () => ['clink-abc'] },
  { channel: IPC.RANGE_DELETE, args: () => ['range-abc'] },
  { channel: IPC.RANGE_REFRESHALLFROMSOURCE, args: () => [] },
  { channel: IPC.RANGE_REFRESHFORFILE, args: () => [path.join(root, 'note.md')] },
  { channel: IPC.RANGELINK_ALLLINKS, args: () => [] },
  { channel: IPC.RANGELINK_FORFILE, args: () => [path.join(root, 'note.md')] },
  { channel: IPC.RANGELINK_PREVIEWSYNCALL, args: () => ['range-abc', null] },
  { channel: IPC.RANGELINK_REMOVE, args: () => ['rlink-abc'] },
  { channel: IPC.COMPONENTS_LIST, args: () => [], fsOnly: true },
  { channel: IPC.COMPONENTS_DELETE, args: () => ['c1'], fsOnly: true },
  { channel: IPC.WIKI_CHANGES, args: () => [10] },
  { channel: IPC.WIKI_CHECK, args: () => [] },
  { channel: IPC.WIKI_SOURCES, args: () => [] },
  { channel: IPC.WIKI_UNDO, args: () => ['change-1'] },
]

describe.each(channels)('$channel', ({ channel, args, fsOnly }) => {
  it.each(unauthorized)('refuses $kind before the store is consulted', async ({ event }) => {
    await expect(handlers.get(channel)!(event(), ...args())).rejects.toThrow(/IPC call rejected/)
    expect(state.consulted).toEqual([])
  })

  it('admits the current owner', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    const call = handlers.get(channel)!(source(replacement), ...args())
    // The owner is admitted: whatever the store answers (empty, null, a validation
    // error for an unknown id), it is never the authorization refusal.
    const settled = await call.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    if (!settled.ok) expect(String(settled.error)).not.toMatch(/IPC call rejected/)
    // The component store is a JSON file, not one of the counted stores.
    if (!fsOnly) expect(state.consulted.length).toBeGreaterThan(0)
  })
})
