import { app, ipcMain, session, type BrowserWindow, type DownloadItem } from 'electron'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import fs from 'fs'
import path from 'path'
import { BROWSER_PARTITION } from '../security'
import { getWorkspaceRoot } from '../workspace-root'
import { uniquePath } from '../util/unique-path'
import { assertMainWindowFrame } from '../main-window'

/**
 * Downloads from the in-app browser.
 *
 * They land in the WORKSPACE, under `Downloads/`, not in a hidden application
 * folder. This is a workspace: a file you just downloaded is a file you are
 * about to use, and it should appear in the Files surface beside everything
 * else rather than somewhere you have to go and find it.
 *
 * Falls back to the OS Downloads folder when no workspace is open, because the
 * alternative — refusing the download, or burying it in userData — is worse
 * than putting it where the user already expects downloads to be.
 *
 * No prompt: a save dialog per download is the thing everyone turns off. The
 * destination is predictable and collisions are resolved by suffixing, which
 * is what browsers do.
 */

export interface DownloadRecord {
  id: string
  filename: string
  savePath: string
  url: string
  /** Bytes received / total (total is 0 when the server does not say). */
  received: number
  total: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startedAt: number
}

const active = new Map<string, DownloadRecord>()
let seq = 0

/** The folder downloads go to, creating it on first use. */
export function downloadDir(): string {
  const root = getWorkspaceRoot()
  const dir = root ? path.join(root, 'Downloads') : app.getPath('downloads')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* fall through — the save will surface any real problem */
  }
  return dir
}

// Shared with the Drive fetch, which had the same collision available and did
// not resolve it (IPC-DRIVE-03). Re-exported so every existing caller and test
// keeps importing it from here.
export { uniquePath }

/**
 * Strips anything that could escape the download folder.
 *
 * A server controls Content-Disposition, so the filename is untrusted input:
 * `../../.ssh/authorized_keys` must become a plain name. Handles Windows
 * separators too, because a path is not made safe by the platform it arrives
 * on.
 */
export function safeName(name: string): string {
  const base = String(name || 'download')
    .replace(/[\\/]+/g, '_')
    // Control characters can hide the real extension in a file listing.
    .replace(/[\x00-\x1f\x7f]/g, '')
    // A leading dot hides the file, and ".." is how traversal begins.
    .replace(/^\.+/, '')
    .trim()
  return base || 'download'
}

/** Registers the download handler on the browser partition. */
export function registerDownloads(getWindow: () => BrowserWindow | null): void {
  const ses = session.fromPartition(BROWSER_PARTITION)
  // The list the browser's Downloads button opens on (it then follows the events).
  ipcHandle(ipcMain, IPC.BROWSER_DOWNLOADS, (event) => {
    assertMainWindowFrame(event)
    return listDownloads()
  })

  ses.on('will-download', (_event, item: DownloadItem) => {
    const id = `dl-${Date.now().toString(36)}-${++seq}`
    const dir = downloadDir()
    const target = uniquePath(dir, safeName(item.getFilename()))
    item.setSavePath(target)

    const record: DownloadRecord = {
      id,
      filename: path.basename(target),
      savePath: target,
      url: item.getURL(),
      received: 0,
      total: item.getTotalBytes(),
      state: 'progressing',
      startedAt: Date.now(),
    }
    active.set(id, record)

    const emit = (): void => {
      const win = getWindow()
      if (win && !win.isDestroyed()) win.webContents.send(IPC.BROWSER_DOWNLOAD_EVENT, { ...record })
    }
    emit()

    item.on('updated', (_e, state) => {
      record.received = item.getReceivedBytes()
      record.total = item.getTotalBytes()
      record.state = state === 'interrupted' ? 'interrupted' : 'progressing'
      emit()
    })

    item.once('done', (_e, state) => {
      record.state =
        state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      record.received = item.getReceivedBytes()
      emit()
      // Kept briefly so the UI can show the finished state, then dropped — this
      // is a live list, not a history.
      setTimeout(() => active.delete(id), 60_000)
    })
  })
}

/** Everything currently in flight (or just finished). */
export function listDownloads(): DownloadRecord[] {
  return [...active.values()].sort((a, b) => b.startedAt - a.startedAt)
}
