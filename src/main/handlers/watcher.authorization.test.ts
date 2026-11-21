import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'

/**
 * IPC-WATCH-01 — `watcher.ts` owns the workspace lifecycle surface and none of
 * its eight handlers looked at the event.
 *
 * This module is not just about watchers: it opens the native folder picker that
 * *decides* the authoritative workspace root, writes notes into the workspace
 * store, copies a workspace file to a user-chosen destination outside it, and
 * reveals an arbitrary path in the OS file manager. `validateFilePath()` (where
 * it is used at all) confines a path; it never asks who is calling.
 */

const state = vi.hoisted(() => ({
  root: '',
  setRoots: [] as string[],
  dialogs: { open: [] as string[], save: [] as string[] },
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(async () => {
      const picked = state.dialogs.open.shift()
      return picked ? { canceled: false, filePaths: [picked] } : { canceled: true, filePaths: [] }
    }),
    showSaveDialog: vi.fn(async () => {
      const picked = state.dialogs.save.shift()
      return picked ? { canceled: false, filePath: picked } : { canceled: true }
    }),
  },
  shell: { showItemInFolder: vi.fn() },
}))

vi.mock('../workspace-root', () => ({
  getWorkspaceRoot: () => state.root || null,
  setWorkspaceRoot: (dir: string) => { state.setRoots.push(dir); state.root = dir; return dir },
}))
vi.mock('../host-profile', () => ({
  appStateDir: (dir: string) => path.join(dir, '.workspace-os'),
  contentRoot: (dir: string) => dir,
  contentRootRel: () => '',
}))
vi.mock('../menu', () => ({ rebuildMenu: vi.fn() }))

const watchTree = vi.fn()
const closes: Array<ReturnType<typeof vi.fn>> = []
vi.mock('../fs/treeWatcher', () => ({
  watchTree: (root: string, opts: unknown) => {
    watchTree(root, opts)
    const close = vi.fn()
    closes.push(close)
    return { close }
  },
}))

const { registerWatcherHandlers } = await import('./watcher')
const { dialog, shell } = await import('electron')

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, Handler>()

function makeWindow() {
  return {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, mainFrame: { parent: null }, send: vi.fn() },
  }
}
function source(win: ReturnType<typeof makeWindow>) {
  return { sender: win.webContents, senderFrame: win.webContents.mainFrame }
}

let owner: ReturnType<typeof makeWindow>
let root = ''
beforeAll(() => registerWatcherHandlers({ handle: handlers.set.bind(handlers) } as never, makeWindow() as never))
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-watch-ipc-'))
  state.root = root
  state.setRoots.length = 0
  state.dialogs.open.length = 0
  state.dialogs.save.length = 0
  owner = makeWindow()
  setMainWindow(owner as never)
  watchTree.mockClear()
  closes.length = 0
  vi.mocked(shell.showItemInFolder).mockClear()
  // Clear the module-level watcher between cases with a legitimate stop.
  await handlers.get(IPC.FS_WATCH_STOP)!(source(owner))
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

const unauthorized: Array<{ kind: string; event: () => unknown }> = [
  { kind: 'a missing frame', event: () => ({ sender: owner.webContents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: {} } }) },
  { kind: 'a stale top-level frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: null } }) },
  { kind: 'a foreign window', event: () => source(makeWindow()) },
]

describe.each([
  { channel: IPC.FS_WATCH_START, args: () => [] },
  { channel: IPC.FS_WATCH_STOP, args: () => [] },
  { channel: IPC.FS_OPEN_FOLDER_DIALOG, args: () => [] },
  { channel: IPC.WORKSPACE_GET_ROOT, args: () => [] },
  { channel: IPC.WORKSPACE_CONTENT_ROOT, args: () => [] },
  { channel: IPC.WORKSPACE_WRITE_AGENT_NOTE, args: () => ['capture.md', 'body'] },
  { channel: IPC.FS_REVEAL, args: () => [path.join(root, 'anything.txt')] },
  { channel: IPC.FS_SAVE_COPY_DIALOG, args: () => [path.join(root, 'source.txt')] },
])('$channel', ({ channel, args }) => {
  it.each(unauthorized)('refuses $kind without acting', async ({ event }) => {
    await fs.writeFile(path.join(root, 'source.txt'), 'source')
    await expect(handlers.get(channel)!(event(), ...args())).rejects.toThrow(/IPC call rejected/)

    // Nothing was watched, opened, revealed, copied or written.
    expect(watchTree).not.toHaveBeenCalled()
    expect(closes.every((close) => close.mock.calls.length === 0)).toBe(true)
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
    expect(state.setRoots).toEqual([])
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
    await expect(fs.stat(path.join(root, '.workspace-os', 'capture.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('the registered main window keeps the surface', () => {
  it('watches, opens a folder, reads roots, writes a note, reveals and saves a copy', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    const event = source(replacement)
    const call = (channel: string, ...args: unknown[]): Promise<unknown> => handlers.get(channel)!(event, ...args)

    expect(await call(IPC.WORKSPACE_GET_ROOT)).toBe(root)
    expect(await call(IPC.WORKSPACE_CONTENT_ROOT)).toEqual({ path: root, rel: '' })

    await call(IPC.FS_WATCH_START)
    expect(watchTree).toHaveBeenCalledWith(root, expect.objectContaining({ depth: 3 }))
    await call(IPC.FS_WATCH_STOP)
    expect(closes[0]).toHaveBeenCalledTimes(1)

    const note = await call(IPC.WORKSPACE_WRITE_AGENT_NOTE, 'captured-page.md', '# hello') as { path: string; ref: string }
    expect(await fs.readFile(note.path, 'utf8')).toBe('# hello')

    await call(IPC.FS_REVEAL, path.join(root, 'source.txt'))
    expect(shell.showItemInFolder).toHaveBeenCalledWith(path.join(root, 'source.txt'))

    // Save-a-copy writes outside the workspace, to a destination the user picks.
    await fs.writeFile(path.join(root, 'report.txt'), 'report')
    const destination = path.join(os.tmpdir(), `wos-copy-${Date.now()}.txt`)
    state.dialogs.save.push(destination)
    expect(await call(IPC.FS_SAVE_COPY_DIALOG, path.join(root, 'report.txt'))).toBe(destination)
    expect(await fs.readFile(destination, 'utf8')).toBe('report')
    await fs.rm(destination, { force: true })

    // The folder picker is the one call that reassigns the authoritative root.
    const picked = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-picked-'))
    try {
      state.dialogs.open.push(picked)
      expect(await call(IPC.FS_OPEN_FOLDER_DIALOG)).toBe(picked)
      expect(state.setRoots).toEqual([picked])
      expect(replacement.webContents.send).toHaveBeenCalled()
    } finally { await fs.rm(picked, { recursive: true, force: true }) }
  })

  it('still validates a note name and body without touching the store', async () => {
    const event = source(owner)
    await expect(handlers.get(IPC.WORKSPACE_WRITE_AGENT_NOTE)!(event, '../escape.md', 'x')).rejects.toThrow(/Invalid note name/)
    await expect(handlers.get(IPC.WORKSPACE_WRITE_AGENT_NOTE)!(event, 'ok.md', 'x'.repeat(2 * 1024 * 1024 + 1))).rejects.toThrow(/Invalid note body/)
    // Path confinement for save-a-copy still applies to workspace files only.
    await expect(handlers.get(IPC.FS_SAVE_COPY_DIALOG)!(event, path.join(os.tmpdir(), 'outside.txt'))).rejects.toThrow()
  })
})
