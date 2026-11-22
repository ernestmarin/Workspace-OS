import { appStateDir } from '../host-profile'
import { IpcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'
import { IPC } from '../ipc-channels'
import { assertMainWindowFrame } from '../main-window'

/**
 * Chat's two needs from the main process:
 *
 * UPLOADS. A file dropped from Finder or pasted arrives as its BYTES, read by
 * the window from the drop itself, never as a path: a path from the renderer
 * would let it copy any file on the disk into the workspace. The bytes land in
 * `.workspace-os/uploads/<day>/`, inside the workspace, where a run can read
 * them (images included) and nothing clutters the person's folders.
 *
 * SESSIONS. Conversations are saved as one file per workspace,
 * `.workspace-os/sessions.json`, instead of the window's localStorage, which is
 * small and shared by every workspace: a chat keeps hundreds of messages.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
/**
 * What the uploads folder may hold in total.
 *
 * The per-file cap alone is not a budget: 25 MB refused is a drop refused, but
 * a hundred accepted drops are 2.5 GB inside a workspace the person is working
 * in. A chat surface receives whatever is dropped or pasted, which is precisely
 * where a repeated paste or a stuck loop lands, so the folder needs a bound of
 * its own.
 *
 * Overridable through `WOS_MAX_UPLOADS_BYTES` (the same shape as the other
 * workspace toggles) so the limit can be exercised without writing half a
 * gigabyte; nonsense values fall back to this default.
 */
export const MAX_UPLOADS_BYTES = 512 * 1024 * 1024
const MAX_SESSIONS_BYTES = 40 * 1024 * 1024

const appDir = (root: string): string => appStateDir(root)

/** A file name that stays a file name: no folders, no hidden files, nothing a file system refuses. */
export function safeUploadName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? ''
  const clean = base
    .replace(/[\u0000-\u001f\u007f:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .slice(0, 120)
    .trim()
  return clean || 'upload'
}

/** `name`, or `name (2).ext`… if taken. */
function freePath(dir: string, name: string): string {
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let p = path.join(dir, name)
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${stem} (${i})${ext}`)
  return p
}

/** The budget in force: `WOS_MAX_UPLOADS_BYTES` when it is a usable number. */
export function uploadsBudgetBytes(): number {
  const raw = process.env['WOS_MAX_UPLOADS_BYTES']
  if (raw === undefined || raw === '') return MAX_UPLOADS_BYTES
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : MAX_UPLOADS_BYTES
}

/**
 * Bytes already stored under `dir`, counting every day folder.
 *
 * Symlinks are counted as zero and never followed: the budget is about what this
 * folder stores, and a link inside it must not make the number depend on a file
 * outside it (or make the walk escape the workspace).
 */
export function uploadsBytes(dir: string): number {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += uploadsBytes(full)
    else if (entry.isFile()) {
      try {
        total += fs.statSync(full).size
      } catch {
        /* vanished between readdir and stat: it cannot be using space */
      }
    }
  }
  return total
}

export function writeUpload(root: string, name: string, bytes: Uint8Array, now = new Date()): string {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new IpcValidationError(`That file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`)
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const uploads = path.join(appDir(root), 'uploads')
  // Checked before the write, so a refusal leaves nothing behind — not even the
  // day folder the write would have created.
  const budget = uploadsBudgetBytes()
  const used = uploadsBytes(uploads)
  if (used + bytes.byteLength > budget) {
    throw new IpcValidationError(
      `The uploads folder is full (${Math.floor(budget / 1024 / 1024)} MB). Delete some uploads before adding more.`,
    )
  }
  const dir = path.join(uploads, day)
  fs.mkdirSync(dir, { recursive: true })
  const file = freePath(dir, safeUploadName(name))
  fs.writeFileSync(file, bytes)
  return file
}

export function registerChatHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.CHAT_UPLOAD, (event, name: unknown, data: unknown) => {
    // IPC-SESSION-02: writes dropped bytes into the workspace.
    assertMainWindowFrame(event)
    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('Open a workspace folder first')
    if (typeof name !== 'string' || !name.trim()) throw new IpcValidationError('Which file?')
    if (!(data instanceof Uint8Array)) throw new IpcValidationError('No file data')
    const file = writeUpload(root, name, data)
    return { path: file, name: path.basename(file), size: data.byteLength }
  })

  // Saved only into a workspace the app opened in this run (the one just left
  // still gets its last words), and always into the one named, never the open one by default.
  const opened = new Set<string>()
  ipcHandle(ipcMain, IPC.SESSIONS_LOAD, (event) => {
    // IPC-SESSION-02: returns the whole conversation transcript of the workspace.
    assertMainWindowFrame(event)
    const root = getWorkspaceRoot()
    if (!root) return null
    opened.add(root)
    try {
      return { root, json: fs.readFileSync(path.join(appDir(root), 'sessions.json'), 'utf8') }
    } catch {
      return { root, json: null }
    }
  })
  ipcHandle(ipcMain, IPC.SESSIONS_SAVE, (event, forRoot: unknown, json: unknown) => {
    // `opened` bounds WHICH workspace may be written; the guard bounds WHO may ask.
    // It runs first so a refusal is never reported as the `{ ok: false }` that a
    // not-opened root returns.
    assertMainWindowFrame(event)
    if (typeof forRoot !== 'string' || !opened.has(forRoot)) return { ok: false }
    const root = forRoot
    if (typeof json !== 'string' || json.length > MAX_SESSIONS_BYTES) throw new IpcValidationError('Sessions too large to save')
    const file = path.join(appDir(root), 'sessions.json')
    fs.mkdirSync(appDir(root), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, json)
    fs.renameSync(tmp, file)
    return { ok: true }
  })
}
