import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'

/**
 * WATCH-02 — a native dialog must parent to the window that exists NOW.
 *
 * `registerWatcherHandlers(ipcMain, win)` captured the window it was handed and
 * passed it to `dialog.showOpenDialog(win, …)` / `showSaveDialog(win, …)`
 * forever. On macOS, closing the window and reopening from the dock runs
 * `app.on('activate') → createWindow()`, which makes a new window: the handlers
 * then parent a dialog to a destroyed one. Electron throws
 * "Object has been destroyed" for that parent, so the picker the user asked for
 * never appears — the same class the module already fixed for *sends*
 * (`main-window.ts` resolves the live window at send time) and only left in the
 * dialogs.
 *
 * The suite registers the module with window A, then makes B the live window and
 * checks which window the dialog was parented to. The dialog itself is mocked:
 * it is the OS's, not ours, and the property under test is the argument.
 */

const state = vi.hoisted(() => ({
  root: '',
  open: [] as string[],
  save: [] as string[],
}))

const dialogCalls = vi.hoisted(() => ({ open: [] as unknown[][], save: [] as unknown[][] }))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(async (...args: unknown[]) => {
      dialogCalls.open.push(args)
      const picked = state.open.shift()
      return picked ? { canceled: false, filePaths: [picked] } : { canceled: true, filePaths: [] }
    }),
    showSaveDialog: vi.fn(async (...args: unknown[]) => {
      dialogCalls.save.push(args)
      const picked = state.save.shift()
      return picked ? { canceled: false, filePath: picked } : { canceled: true }
    }),
  },
  shell: { showItemInFolder: vi.fn() },
}))
vi.mock('../workspace-root', () => ({
  getWorkspaceRoot: () => state.root || null,
  setWorkspaceRoot: (dir: string) => {
    state.root = dir
    return dir
  },
}))
vi.mock('../host-profile', () => ({
  appStateDir: (dir: string) => path.join(dir, '.workspace-os'),
  contentRoot: (dir: string) => dir,
  contentRootRel: () => '',
}))
vi.mock('../menu', () => ({ rebuildMenu: vi.fn() }))
vi.mock('../fs/treeWatcher', () => ({ watchTree: () => ({ close: vi.fn() }) }))

const { registerWatcherHandlers } = await import('./watcher')

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, Handler>()

const makeWindow = (): Record<string, unknown> => ({
  isDestroyed: () => false,
  webContents: { isDestroyed: () => false, mainFrame: { parent: null }, send: vi.fn() },
})
const source = (win: ReturnType<typeof makeWindow>) => ({
  sender: (win.webContents as { mainFrame: unknown }),
  senderFrame: (win.webContents as { mainFrame: unknown }).mainFrame,
})

/** The window the module was registered with — the one that must NOT be used. */
let registrationWindow: ReturnType<typeof makeWindow>
let liveWindow: ReturnType<typeof makeWindow>

beforeAll(() => {
  registrationWindow = makeWindow()
  registerWatcherHandlers(
    { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) } as never,
    registrationWindow as never,
  )
})

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-watch-dialog-'))
  state.open.length = 0
  state.save.length = 0
  dialogCalls.open.length = 0
  dialogCalls.save.length = 0
  liveWindow = makeWindow()
  // A window replacement after registration: this is the live one now.
  setMainWindow(liveWindow as never)
})
afterEach(async () => {
  if (state.root) await fs.rm(state.root, { recursive: true, force: true })
})

describe('dialogs parent to the live window, not the one that registered the handlers', () => {
  it('the folder picker uses the current window', async () => {
    state.open.push(state.root)
    await handlers.get(IPC.FS_OPEN_FOLDER_DIALOG)!(source(liveWindow))

    expect(dialogCalls.open).toHaveLength(1)
    expect(dialogCalls.open[0][0]).toBe(liveWindow)
    expect(dialogCalls.open[0][0]).not.toBe(registrationWindow)
  })

  it('the save-copy dialog uses the current window', async () => {
    const src = path.join(state.root, 'note.md')
    await fs.writeFile(src, 'hello')
    state.save.push(path.join(state.root, 'copy.md'))

    await handlers.get(IPC.FS_SAVE_COPY_DIALOG)!(source(liveWindow), src)

    expect(dialogCalls.save).toHaveLength(1)
    expect(dialogCalls.save[0][0]).toBe(liveWindow)
  })

  it('with no live window it refuses before opening any dialog', async () => {
    // Deliberate: authorization never inherits the delivery fallback. With no
    // registered owner the call is rejected, so the unparented branch of the
    // dialog helper is defensive rather than reachable through IPC.
    setMainWindow(null as never)
    await expect(handlers.get(IPC.FS_OPEN_FOLDER_DIALOG)!(source(liveWindow))).rejects.toThrow(
      /IPC call rejected/,
    )
    expect(dialogCalls.open).toHaveLength(0)
  })
})
