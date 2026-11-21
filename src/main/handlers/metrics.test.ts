import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Point the workspace root at a temp dir so validateFilePath has a concrete
// boundary to enforce for the refreshForFile traversal test.
let workspaceRoot = ''
vi.mock('../workspace-root', () => ({
  getWorkspaceRoot: () => workspaceRoot || null,
}))

// The metrics singleton reads app.getPath('userData'); give it a temp dir so
// the accepted-path case (which reaches metrics.list()) doesn't crash.
let userDataDir = ''
vi.mock('electron', () => ({
  default: { app: { getPath: () => userDataDir } },
  app: { getPath: () => userDataDir },
}))

import { registerMetricHandlers } from './metrics'
import { IpcValidationError } from '../ipc-validator'
import { setMainWindow } from '../main-window'

/**
 * The registered main window and an event from its current main frame. Since
 * IPC-REFRESH-01 every handler refuses anything else, so a fabricated `{}` event
 * would make these traversal assertions pass by refusal instead of validation.
 */
function ownerEvent(): { sender: unknown; senderFrame: unknown } {
  const frame = { parent: null }
  const webContents = { isDestroyed: () => false, mainFrame: frame, send: vi.fn() }
  setMainWindow({ isDestroyed: () => false, webContents } as never)
  return { sender: webContents, senderFrame: frame }
}

/** A minimal IpcMain that records handlers so a test can invoke them directly. */
function fakeIpcMain(): {
  ipcMain: { handle: (c: string, h: (...a: unknown[]) => unknown) => void }
  invoke: (c: string, ...a: unknown[]) => Promise<unknown>
  invokeAs: (event: unknown, c: string, ...a: unknown[]) => Promise<unknown>
} {
  const handlers = new Map<string, (...a: unknown[]) => unknown>()
  return {
    ipcMain: { handle: (c, h) => void handlers.set(c, h) },
    invoke: async (c, ...a) => {
      const h = handlers.get(c)
      if (!h) throw new Error(`no handler for ${c}`)
      return h(ownerEvent(), ...a)
    },
    invokeAs: async (event, c, ...a) => {
      const h = handlers.get(c)
      if (!h) throw new Error(`no handler for ${c}`)
      return h(event, ...a)
    },
  }
}

describe('metric:refreshForFile path-traversal rejection', () => {
  let dir: string
  // Register the handlers ONCE — `ipcHandle` guards against duplicate channel
  // registration process-wide, so re-registering per test would throw.
  const f = fakeIpcMain()
  registerMetricHandlers(f.ipcMain as never)
  const invoke = f.invoke

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-metrics-h-'))
    workspaceRoot = dir
    userDataDir = dir // metrics.json lives here; empty until a metric is created
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('refuses an event that is not the registered main window', async () => {
    // Pins why `invoke` speaks as the owner: the refusal of an empty event is
    // independent of the path validation asserted below.
    await expect(f.invokeAs({}, 'metric:refreshForFile', path.join(dir, 'note.md'))).rejects.toThrow(/IPC call rejected/)
  })

  it('rejects a "../../etc/passwd" traversal path (escapes workspace root)', async () => {
    await expect(invoke('metric:refreshForFile', path.join(dir, '..', '..', 'etc', 'passwd'))).rejects.toBeInstanceOf(
      IpcValidationError
    )
  })

  it('rejects an absolute path outside the workspace root', async () => {
    await expect(invoke('metric:refreshForFile', '/etc/passwd')).rejects.toBeInstanceOf(IpcValidationError)
  })

  it('rejects an empty / non-string path', async () => {
    await expect(invoke('metric:refreshForFile', '')).rejects.toBeInstanceOf(IpcValidationError)
    await expect(invoke('metric:refreshForFile', 123)).rejects.toBeInstanceOf(IpcValidationError)
  })

  it('accepts an in-workspace path (no metrics sourced there → empty result)', async () => {
    const inside = path.join(dir, 'book.xlsx')
    fs.writeFileSync(inside, 'x')
    const res = await invoke('metric:refreshForFile', inside)
    expect(res).toEqual([])
  })
})
