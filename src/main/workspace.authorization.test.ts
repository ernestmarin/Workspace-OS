import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IPC } from './ipc-channels'
import { setMainWindow } from './main-window'
import { getWorkspaceRoot } from './workspace-root'

/**
 * IPC-WORKSPACE-02 — `workspace:open-recent` reassigns the authoritative root.
 *
 * `openWorkspacePath(dir)` only checks that `dir` is an existing directory, then
 * calls `setWorkspaceRoot(dir)`. That single value is what every filesystem
 * validator in the app scopes to, so a foreign frame naming `/home/<user>` (or
 * `/`) would silently widen the boundary for every later operation — the same
 * class of change as `fs:open-folder-dialog`, which IPC-WATCH-01 guarded, but
 * with a **caller-supplied** path instead of a native dialog.
 *
 * `workspace:close` clears the root and `workspace:recents` returns the user's
 * recent folder paths; both are included here (IPC-CLASS-01 verdict A).
 *
 * The menu module is registered for real (native `Menu` mocked); the workspace
 * root is the real one, because "did the root move?" is the claim.
 */

const state = vi.hoisted(() => ({ userData: '', recents: [] as string[], calls: [] as string[] }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
  Menu: {
    buildFromTemplate: () => ({ popup: vi.fn() }),
    setApplicationMenu: () => state.calls.push('setApplicationMenu'),
  },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
}))
vi.mock('./updater', () => ({ checkForUpdatesManual: vi.fn() }))
vi.mock('./snapshots', () => ({ snapshots: { list: () => [] } }))
vi.mock('./recent-workspaces', () => ({
  loadRecentWorkspaces: () => state.recents,
  pruneRecentWorkspaces: () => state.recents,
  clearRecentWorkspaces: () => state.calls.push('clearRecents'),
  recordRecentWorkspace: () => state.calls.push('recordRecent'),
}))

const { registerMenu } = await import('./menu')

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

function makeWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: { parent: null }, send: vi.fn() } }
}
function source(win: ReturnType<typeof makeWindow>) {
  return { sender: win.webContents, senderFrame: win.webContents.mainFrame }
}

let owner: ReturnType<typeof makeWindow>
let userDir = ''
let otherDir = ''

beforeAll(() => {
  registerMenu({ handle: handlers.set.bind(handlers) } as never, true)
})

beforeEach(async () => {
  state.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-ws-data-'))
  state.recents = []
  state.calls = []
  userDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-ws-a-'))
  otherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-ws-b-'))
  owner = makeWindow()
  setMainWindow(owner as never)
})
afterEach(async () => {
  for (const d of [state.userData, userDir, otherDir]) await fs.rm(d, { recursive: true, force: true })
})

const unauthorized = [
  { kind: 'a missing frame', event: () => ({ sender: owner.webContents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: {} } }) },
  { kind: 'a stale top-level frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: null } }) },
  { kind: 'a foreign window', event: () => source(makeWindow()) },
]

const channels = [
  { channel: IPC.WORKSPACE_OPEN_RECENT, args: () => [userDir] },
  { channel: IPC.WORKSPACE_CLOSE, args: () => [] },
  { channel: IPC.WORKSPACE_RECENTS, args: () => [] },
]

describe.each(channels)('$channel', ({ channel, args }) => {
  it.each(unauthorized)('refuses $kind without moving the workspace root', async ({ event }) => {
    // Start from a known root so "unchanged" is meaningful.
    await handlers.get(IPC.WORKSPACE_OPEN_RECENT)!(source(owner), otherDir)
    expect(getWorkspaceRoot()).toBe(path.resolve(otherDir))

    await expect(handlers.get(channel)!(event(), ...args())).rejects.toThrow(/IPC call rejected/)
    expect(getWorkspaceRoot()).toBe(path.resolve(otherDir))
  })
})

describe('the registered main window keeps the surface', () => {
  it('opens a recent folder for the current owner, and only for the owner', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    await expect(handlers.get(IPC.WORKSPACE_OPEN_RECENT)!(source(replacement), userDir)).resolves.toBe(true)
    expect(getWorkspaceRoot()).toBe(path.resolve(userDir))
    // The root change reaches the window and the menu is rebuilt.
    expect(replacement.webContents.send).toHaveBeenCalledWith(IPC.WORKSPACE_ROOT_CHANGED, path.resolve(userDir))
    expect(state.calls).toContain('setApplicationMenu')
  })

  it('lists recents and closes the folder', async () => {
    state.recents = [userDir, otherDir]
    await expect(handlers.get(IPC.WORKSPACE_RECENTS)!(source(owner))).resolves.toEqual([userDir, otherDir])

    await handlers.get(IPC.WORKSPACE_OPEN_RECENT)!(source(owner), userDir)
    expect(getWorkspaceRoot()).toBe(path.resolve(userDir))
    await expect(handlers.get(IPC.WORKSPACE_CLOSE)!(source(owner))).resolves.toBeUndefined()
    expect(getWorkspaceRoot()).toBeNull()
  })

  it('keeps the surviving input validation', async () => {
    const event = source(owner)
    // A non-string or a non-directory is still refused by the handler itself.
    await expect(handlers.get(IPC.WORKSPACE_OPEN_RECENT)!(event, 42)).resolves.toBe(false)
    await expect(handlers.get(IPC.WORKSPACE_OPEN_RECENT)!(event, path.join(userDir, 'missing'))).resolves.toBe(false)
    expect(getWorkspaceRoot()).toBeNull()
  })
})
