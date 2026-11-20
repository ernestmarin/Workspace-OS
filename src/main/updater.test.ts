import { describe, expect, it, vi } from 'vitest'

const { showMessageBox, checkForUpdates } = vi.hoisted(() => ({
  showMessageBox: vi.fn(async () => ({ response: 0 })),
  checkForUpdates: vi.fn(async () => null),
}))

vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '0.2.28', getAppPath: () => '/Applications/Workspace OS.app/Contents/Resources/app.asar' },
  dialog: { showMessageBox },
}))

vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      logger: null,
      on: vi.fn(),
      checkForUpdates,
      quitAndInstall: vi.fn(),
    },
  },
}))

import * as updaterMod from './updater'

describe('updater signature & destroyed-window guards (SEC-08)', () => {
  it('detects ad-hoc / unsigned macOS bundles via hasDeveloperIdSignature()', () => {
    const checkSig = (updaterMod as Record<string, unknown>).hasDeveloperIdSignature as
      | ((codesignStderr: string) => boolean)
      | undefined
    expect(typeof checkSig).toBe('function')
    expect(checkSig!('Signature=adhoc\nTeamIdentifier=not set\n')).toBe(false)
    expect(checkSig!('Authority=Developer ID Application: Example Corp (ABC1234567)\n')).toBe(true)
  })

  it('does not call dialog.showMessageBox on a destroyed BrowserWindow', () => {
    showMessageBox.mockClear()
    const destroyedWin = { isDestroyed: () => true, webContents: { isDestroyed: () => true, send: vi.fn() } }
    updaterMod.initUpdater(destroyedWin as never, true)
    updaterMod.checkForUpdatesManual()
    expect(showMessageBox).not.toHaveBeenCalled()
  })
})
