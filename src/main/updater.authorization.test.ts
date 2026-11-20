import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setMainWindow } from './main-window'
import { initUpdater, registerUpdaterHandlers } from './updater'
import { IPC } from './ipc-channels'

const { install, dialog } = vi.hoisted(() => ({ install: vi.fn(), dialog: vi.fn() }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: { quitAndInstall: install } } }))
vi.mock('electron', () => ({ app: { isPackaged: false }, dialog: { showMessageBox: dialog } }))
vi.mock('./crash-reporter', () => ({ log: vi.fn() }))

function windowStub() {
  return { isDestroyed: vi.fn(() => false), webContents: { mainFrame: { parent: null }, isDestroyed: vi.fn(() => false) } }
}
function event(win: ReturnType<typeof windowStub>) {
  return { sender: win.webContents, senderFrame: win.webContents.mainFrame }
}
const handlers = new Map<string, (event?: unknown) => Promise<unknown>>()
beforeAll(() => registerUpdaterHandlers({ handle: handlers.set.bind(handlers) } as never))
let win: ReturnType<typeof windowStub>
beforeEach(() => {
  vi.clearAllMocks()
  win = windowStub()
  setMainWindow(win as never)
  initUpdater(win as never, true)
})

describe.each([IPC.UPDATER_CHECK, IPC.UPDATER_INSTALL])('%s owner authorization', channel => {
  it.each(['absent', 'null frame', 'child', 'stale frame', 'other owner', 'destroyed window', 'destroyed contents', 'replaced owner'])('rejects %s without effects', async scenario => {
    let source: unknown = event(win)
    switch (scenario) {
      case 'absent': source = undefined; break
      case 'null frame': source = { ...event(win), senderFrame: null }; break
      case 'child': source = { ...event(win), senderFrame: { parent: win.webContents.mainFrame } }; break
      case 'stale frame': source = { ...event(win), senderFrame: { parent: null } }; break
      case 'other owner': source = event(windowStub()); break
      case 'destroyed window': win.isDestroyed.mockReturnValue(true); break
      case 'destroyed contents': win.webContents.isDestroyed.mockReturnValue(true); break
      case 'replaced owner': setMainWindow(windowStub() as never); break
    }
    await expect(handlers.get(channel)!(source)).rejects.toThrow(/IPC call rejected/)
    expect(install).not.toHaveBeenCalled()
    expect(dialog).not.toHaveBeenCalled()
  })
  it('accepts the registered replacement without re-registering handlers', async () => {
    const replacement = windowStub()
    setMainWindow(replacement as never)
    await handlers.get(channel)!(event(replacement))
    expect(channel === IPC.UPDATER_CHECK ? dialog : install).toHaveBeenCalledTimes(1)
  })
})
