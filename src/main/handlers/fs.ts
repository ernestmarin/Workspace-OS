import { IpcMain } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError, validateFilePath, validateFileName } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'
import { isAuthorizedArtifact } from '../artifact-allowlist'
import { trash } from '../trash'
import { assertMainWindowFrame } from '../main-window'

function sanitize(filePath: unknown): string {
  const root = getWorkspaceRoot()
  if (!root) throw new IpcValidationError('No workspace folder is open')
  return validateFilePath(filePath, root)
}

/**
 * READ path: like sanitize, but also permits a case artifact the user attached
 * that lives outside the active workspace (vetted earlier by
 * cases:authorize-artifact). Read-only — writes stay workspace-confined.
 */
function sanitizeRead(filePath: unknown): string {
  if (typeof filePath === 'string' && !/[\x00-\x1f]/.test(filePath) && isAuthorizedArtifact(filePath)) {
    return filePath
  }
  return sanitize(filePath)
}

/** True if the path is inside the workspace's own `.workspace-os` store. */
function isInternalPath(resolved: string): boolean {
  const root = getWorkspaceRoot()
  if (!root) return false
  const internalRoot = path.resolve(root, '.workspace-os')
  return resolved === internalRoot || resolved.startsWith(internalRoot + path.sep)
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p)
    return true
  } catch {
    return false
  }
}

// Quick-open file enumeration — bounded, yielding, breadth-first (mirrors the
// search indexer's walk) so huge workspaces list shallow files first and never
// stall the main process.
const LIST_IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'release', 'coverage', 'target', '.git'])
const LIST_MAX_FILES = 20_000
const LIST_MAX_DEPTH = 8

async function listWorkspaceFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const dirs: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  let dh = 0
  let n = 0
  while (dh < dirs.length && files.length < LIST_MAX_FILES) {
    const { dir, depth } = dirs[dh++]
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (files.length >= LIST_MAX_FILES) break
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < LIST_MAX_DEPTH && !LIST_IGNORE_DIRS.has(e.name)) dirs.push({ dir: full, depth: depth + 1 })
      } else if (e.isFile()) {
        files.push(full)
      }
      if (++n % 500 === 0) await new Promise((r) => setImmediate(r)) // keep the UI responsive
    }
  }
  return files
}

/**
 * IPC-FS-01 — origin check for the whole surface, first in every handler.
 *
 * `sanitize()` confines a path to the workspace; it does not answer "who is
 * asking". Without this, any frame that could reach the preload bridge — a
 * stale top-level frame after navigation, a child/detached frame, or a
 * webContents that is not the registered owner — could read, overwrite, rename
 * or delete files inside the user's workspace. Reads are guarded too: a
 * read-only escape is still a privacy breach. The call is `assertMainWindowFrame`
 * deliberately, not a local alias, so the structural inventory in
 * `ipc-authorization.test.ts` recognises these handlers by name.
 */
export function registerFsHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.FS_READ_DIR, async (event, dirPath: unknown) => {
    assertMainWindowFrame(event)
    try {
      const resolved = sanitize(dirPath)
      const entries = await fs.readdir(resolved, { withFileTypes: true })
      // WOS-013: size and mtime come back with the listing. Without them the
      // Files surface cannot sort or filter by anything but name — the reason
      // its order was hardcoded. One stat per entry, in parallel, and a failed
      // stat degrades to zeroes rather than losing the whole directory: a
      // permission-denied file should still be listed.
      return await Promise.all(
        entries.map(async (e) => {
          const full = path.join(resolved, e.name)
          let size = 0
          let mtimeMs = 0
          try {
            const st = await fs.stat(full)
            size = st.size
            mtimeMs = st.mtimeMs
          } catch {
            /* broken symlink, races with a delete, no permission — still list it */
          }
          return { name: e.name, path: full, isDirectory: e.isDirectory(), size, mtimeMs }
        }),
      )
    } catch (err) {
      if (err instanceof IpcValidationError) throw err
      throw new Error(`Cannot read directory: ${(err as Error).message}`)
    }
  })

  // Every file under the workspace root (bounded walk) — quick-open's data source.
  ipcHandle(ipcMain, IPC.FS_LIST_FILES, async (event) => {
    assertMainWindowFrame(event)
    const root = getWorkspaceRoot()
    if (!root) return []
    return listWorkspaceFiles(root)
  })

  ipcHandle(ipcMain, IPC.FS_READ_FILE, async (event, filePath: unknown) => {
    assertMainWindowFrame(event)
    const resolved = sanitizeRead(filePath)
    return fs.readFile(resolved, 'utf-8')
  })

  ipcHandle(ipcMain, IPC.FS_READ_FILE_BYTES, async (event, filePath: unknown) => {
    assertMainWindowFrame(event)
    const resolved = sanitizeRead(filePath)
    const buf = await fs.readFile(resolved)
    // Return as Uint8Array — transfers cleanly over IPC
    return new Uint8Array(buf)
  })

  ipcHandle(ipcMain, IPC.FS_WRITE_FILE, async (event, filePath: unknown, content: unknown) => {
    assertMainWindowFrame(event)
    if (typeof content !== 'string') throw new IpcValidationError('content must be a string')
    const resolved = sanitize(filePath)
    // Snapshot the prior version before overwriting (skip the trash store itself).
    if (!isInternalPath(resolved) && (await exists(resolved))) {
      await trash.moveToTrash(resolved, 'overwrite', false, false)
    }
    await fs.writeFile(resolved, content, 'utf-8')
  })

  ipcHandle(ipcMain, IPC.FS_DELETE, async (event, filePath: unknown) => {
    assertMainWindowFrame(event)
    const resolved = sanitize(filePath)
    if (isInternalPath(resolved)) {
      throw new IpcValidationError('Cannot delete internal store (.workspace-os)')
    }
    const stat = await fs.stat(resolved)
    await trash.moveToTrash(resolved, 'delete', stat.isDirectory(), true)
  })

  ipcHandle(ipcMain, IPC.FS_RENAME, async (event, oldPath: unknown, newName: unknown) => {
    assertMainWindowFrame(event)
    const resolvedOld = sanitize(oldPath)
    const name = validateFileName(newName)
    const newPath = path.join(path.dirname(resolvedOld), name)
    // Ensure new path is also within root and does not silently clobber an existing entry.
    const resolvedNew = sanitize(newPath)
    if (resolvedNew !== resolvedOld && (await exists(resolvedNew))) {
      throw new Error(`Destination already exists: ${name}`)
    }
    await fs.rename(resolvedOld, resolvedNew)
  })

  ipcHandle(ipcMain, IPC.FS_CREATE, async (event, dirPath: unknown, name: unknown, isDirectory: unknown) => {
    assertMainWindowFrame(event)
    const resolvedDir = sanitize(dirPath)
    const fileName = validateFileName(name)
    const target = path.join(resolvedDir, fileName)
    sanitize(target)
    if (isDirectory === true) {
      await fs.mkdir(target)
    } else {
      await fs.writeFile(target, '', { encoding: 'utf-8', flag: 'wx' })
    }
    return target
  })
}
