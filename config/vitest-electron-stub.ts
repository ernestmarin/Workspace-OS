/**
 * Minimal Node-side placeholder for `electron` when Vitest runs unit tests
 * outside an Electron binary (e.g. headless CI or ELECTRON_SKIP_BINARY_DOWNLOAD).
 *
 * Mirrors what importing CJS `electron` (`module.exports = '/path/to/electron'`)
 * yields in Node when the binary IS installed: named exports (`app`, `ipcMain`,
 * etc.) are `undefined` unless a test explicitly calls `vi.mock('electron', ...)`,
 * without throwing `Electron failed to install correctly` at module load time.
 */
export const app = undefined
export const BrowserWindow = undefined
export const clipboard = undefined
export const contextBridge = undefined
export const crashReporter = undefined
export const dialog = undefined
export const globalShortcut = undefined
export const ipcMain = undefined
export const ipcRenderer = undefined
export const Menu = undefined
export const nativeImage = undefined
export const nativeTheme = undefined
export const Notification = undefined
export const protocol = undefined
export const safeStorage = undefined
export const screen = undefined
export const session = undefined
export const shell = undefined
export const Tray = undefined
export const utilityProcess = undefined
export const webContents = undefined
export default ''
