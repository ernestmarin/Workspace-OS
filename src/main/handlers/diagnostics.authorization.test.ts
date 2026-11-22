import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'

/**
 * IPC-DIAG-01 — printing, agents, checkpoints and snapshots.
 *
 * Twelve channels the IPC-CLASS-01 triage put in verdict A:
 *
 *   - `print:document` builds a **hidden BrowserWindow** and sends a document to
 *     a printer (an effect outside the app);
 *   - `agents:list/read/write/delete/build` read and write **agent definitions**
 *     (prompts are user content) in the workspace and the app state dir;
 *   - `checkpoint:list/diff/rollback` walk git history and **restore files**;
 *   - `snapshot:list/save/delete` read and write saved workspace snapshots.
 *
 * Printing, git and the snapshot store are mocked at their boundaries; the guard,
 * the agent file layout and the validation are real.
 */

const state = vi.hoisted(() => ({
  root: '',
  userData: '',
  calls: [] as string[],
  printed: [] as string[],
}))

vi.mock('electron', () => ({
  app: { getPath: (n: string) => (n === 'userData' ? state.userData : state.root) },
  BrowserWindow: class {
    webContents = {
      setWindowOpenHandler: () => {},
      on: () => {},
      print: (_opts: unknown, cb: (ok: boolean, reason: string) => void) => {
        state.printed.push(this.title)
        state.calls.push('print')
        cb(true, '')
      },
    }
    title: string
    constructor(opts: { title?: string }) {
      this.title = opts.title ?? ''
      state.calls.push('new-window')
    }
    async loadURL(url: string) {
      state.calls.push(`loadURL:${url.startsWith('data:text/html') ? 'data' : 'other'}`)
    }
    isDestroyed() {
      return false
    }
    destroy() {
      state.calls.push('destroy')
    }
  },
}))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => state.root || null }))
vi.mock('../host-profile', () => ({
  appStateDir: (root: string) => path.join(root, '.workspace-os'),
  contentRel: (_r: string, n: string) => n,
}))
vi.mock('../menu', () => ({ rebuildMenu: () => state.calls.push('rebuildMenu') }))
vi.mock('../checkpoint', () => ({
  checkpoints: {
    list: () => {
      state.calls.push('checkpoints.list')
      return []
    },
    rollbackTo: (id: string) => {
      state.calls.push(`checkpoints.rollbackTo:${id}`)
      return { ok: true }
    },
    diffSince: (id: string) => {
      state.calls.push(`checkpoints.diffSince:${id}`)
      return []
    },
  },
}))
vi.mock('../snapshots', () => ({
  snapshots: {
    list: () => {
      state.calls.push('snapshots.list')
      return []
    },
    create: (_root: string, name: string) => {
      state.calls.push(`snapshots.create:${name}`)
      return { id: 'snap-1', name }
    },
    remove: (id: string) => {
      state.calls.push(`snapshots.remove:${id}`)
    },
    restore: () => ({ ok: true }),
  },
}))

const { registerPrintHandlers } = await import('../printing')
const { registerAgentsHandlers } = await import('./agents')
const { registerCheckpointHandlers } = await import('./checkpoint')
const { registerSnapshotHandlers } = await import('./snapshots')

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
  const ipcMain = { handle: handlers.set.bind(handlers) }
  registerPrintHandlers(ipcMain as never)
  registerAgentsHandlers(ipcMain as never)
  registerCheckpointHandlers(ipcMain as never)
  registerSnapshotHandlers(ipcMain as never)
})

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-diag-ipc-'))
  state.root = root
  state.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-diag-data-'))
  state.calls = []
  state.printed = []
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
  { channel: IPC.PRINT_DOCUMENT, args: () => ['Report', '<p>secret</p>'] },
  { channel: IPC.AGENTS_LIST, args: () => [] },
  { channel: IPC.AGENTS_READ, args: () => ['reviewer', 'workspace'] },
  { channel: IPC.AGENTS_WRITE, args: () => [{ name: 'reviewer', body: 'You review code.' }] },
  { channel: IPC.AGENTS_DELETE, args: () => ['reviewer', 'workspace'] },
  { channel: IPC.AGENTS_BUILD, args: () => ['an agent that reviews code'] },
  { channel: IPC.CHECKPOINT_LIST, args: () => [] },
  { channel: IPC.CHECKPOINT_ROLLBACK, args: () => ['abcdef1'] },
  { channel: IPC.CHECKPOINT_DIFF, args: () => ['abcdef1'] },
  { channel: IPC.SNAPSHOT_LIST, args: () => [] },
  { channel: IPC.SNAPSHOT_SAVE, args: () => ['before refactor', { open: [] }] },
  { channel: IPC.SNAPSHOT_DELETE, args: () => ['snap-1'] },
]

describe.each(channels)('$channel', ({ channel, args }) => {
  it.each(unauthorized)('refuses $kind without printing, storing or restoring', async ({ event }) => {
    await expect(handlers.get(channel)!(event(), ...args())).rejects.toThrow(/IPC call rejected/)
    expect(state.calls).toEqual([])
    expect(state.printed).toEqual([])
    // No agent file, checkpoint marker or snapshot landed anywhere.
    expect(await fs.readdir(state.root)).toEqual([])
    expect(await fs.readdir(state.userData)).toEqual([])
  })
})

describe('the registered main window keeps the surface', () => {
  it('prints, lists agents and reaches the checkpoint and snapshot stores', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    const event = source(replacement)
    const call = (channel: string, ...args: unknown[]): Promise<unknown> => handlers.get(channel)!(event, ...args)

    await call(IPC.PRINT_DOCUMENT, 'Report', '<p>hello</p>')
    expect(state.printed).toEqual(['Report'])
    expect(state.calls).toContain('destroy')

    expect(await call(IPC.AGENTS_LIST)).toBeTypeOf('object')
    expect(await call(IPC.CHECKPOINT_LIST)).toEqual([])
    expect(await call(IPC.CHECKPOINT_DIFF, 'abcdef1')).toEqual([])
    expect(await call(IPC.CHECKPOINT_ROLLBACK, 'abcdef1')).toEqual({ ok: true })
    expect(await call(IPC.SNAPSHOT_LIST)).toEqual([])
    expect(await call(IPC.SNAPSHOT_SAVE, 'before refactor', { open: [] })).toMatchObject({ id: 'snap-1' })
    await call(IPC.SNAPSHOT_DELETE, 'snap-1')
    expect(state.calls).toContain('snapshots.remove:snap-1')
    expect(state.calls).toContain('snapshots.create:before refactor')
    expect(state.calls).toContain('rebuildMenu')
  })

  it('keeps the surviving validation', async () => {
    const event = source(owner)
    await expect(handlers.get(IPC.PRINT_DOCUMENT)!(event, 42, '<p>x</p>')).rejects.toThrow()
    await expect(handlers.get(IPC.CHECKPOINT_ROLLBACK)!(event, 'not-a-sha')).rejects.toThrow(/checkpoint id/)
    await expect(handlers.get(IPC.CHECKPOINT_DIFF)!(event, '../../etc')).rejects.toThrow(/checkpoint id/)
    expect(state.printed).toEqual([])
  })
})
