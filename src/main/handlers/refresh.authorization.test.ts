import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'
import { IpcValidationError } from '../ipc-validator'

/**
 * IPC-REFRESH-01 — the two "refresh everything sourced from this file" hooks.
 *
 * `metric:refreshForFile` and `collection:refreshForFile` are called on every
 * save. They re-read a source file and rewrite derived values in the workspace,
 * so an unauthorized caller could trigger workspace writes on any document it
 * can name. Validation confined the path; nothing established who was asking.
 *
 * The two stores are replaced by counters that return nothing, so "was the store
 * even consulted?" is the observable — the refresh machinery itself is out of
 * scope here.
 */

const state = vi.hoisted(() => ({ root: '', consulted: [] as string[] }))
const mockStore = (name: string) => ({
  list: () => {
    state.consulted.push(name)
    return []
  },
})

vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => state.root || null }))
vi.mock('../metrics', async (orig) => ({
  ...(await orig() as object),
  metrics: mockStore('metrics'),
  isSourced: () => false,
}))
vi.mock('../collections', async (orig) => ({
  ...(await orig() as object),
  collections: mockStore('collections'),
  isSourcedCollection: () => false,
}))

const { registerMetricHandlers } = await import('./metrics')
const { registerCollectionHandlers } = await import('./collections')

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
})

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-refresh-ipc-'))
  state.root = root
  state.consulted = []
  await fs.writeFile(path.join(root, 'report.docx'), 'fake docx')
  owner = makeWindow()
  setMainWindow(owner as never)
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const unauthorized = [
  { kind: 'a missing frame', event: () => ({ sender: owner.webContents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: {} } }) },
  { kind: 'a stale top-level frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: null } }) },
  { kind: 'a foreign window', event: () => source(makeWindow()) },
]

const channels = [
  { channel: IPC.METRIC_REFRESHFORFILE, store: 'metrics' },
  { channel: IPC.COLLECTION_REFRESHFORFILE, store: 'collections' },
]

describe.each(channels)('$channel', ({ channel, store }) => {
  it.each(unauthorized)('refuses $kind before the store is consulted', async ({ event }) => {
    await expect(handlers.get(channel)!(event(), path.join(root, 'report.docx'))).rejects.toThrow(/IPC call rejected/)
    expect(state.consulted).toEqual([])
  })

  it('answers the current owner and reaches its own store', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    await expect(
      handlers.get(channel)!(source(replacement), path.join(root, 'report.docx')),
    ).resolves.toEqual([])
    expect(state.consulted).toEqual([store])
  })

  it('keeps the surviving path validation', async () => {
    const event = source(owner)
    await expect(handlers.get(channel)!(event, '/etc/passwd')).rejects.toBeInstanceOf(IpcValidationError)
    await expect(handlers.get(channel)!(event, '../outside.docx')).rejects.toBeInstanceOf(IpcValidationError)
    await expect(handlers.get(channel)!(event, 42)).rejects.toBeInstanceOf(IpcValidationError)
    expect(state.consulted).toEqual([])
  })
})
