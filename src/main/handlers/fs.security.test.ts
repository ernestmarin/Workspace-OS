import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const state = vi.hoisted(() => ({ root: '' }))

vi.mock('../workspace-root', () => ({
  getWorkspaceRoot: () => state.root || null,
  requireWorkspaceRoot: () => {
    if (!state.root) throw new Error('No workspace folder is open')
    return state.root
  },
}))

vi.mock('../trash', () => ({
  trash: {
    moveToTrash: vi.fn(async (p: string) => {
      fs.rmSync(p, { recursive: true, force: true })
    }),
  },
}))

import { IPC } from '../ipc-channels'
import { registerFsHandlers } from './fs'
import { setMainWindow } from '../main-window'

describe('fs handler overwrite & internal-prefix boundaries (SEC-07)', () => {
  let root: string
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

  beforeAll(() => {
    const fakeIpc = {
      handle: (ch: string, fn: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(ch, fn)
      },
      removeHandler: (ch: string) => {
        handlers.delete(ch)
      },
    }
    registerFsHandlers(fakeIpc as never)
  })

  // IPC-FS-01: these boundaries are only reachable from the registered main
  // window's current main frame now. The fixture models that owner instead of a
  // bare `event()`, which used to be accepted as one.
  const owner = { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: { parent: null } } }
  const event = (): unknown => ({ sender: owner.webContents, senderFrame: owner.webContents.mainFrame })

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-sec07-'))
    state.root = root
    setMainWindow(owner as never)
  })

  afterEach(() => {
    state.root = ''
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('refuses the same allowed path when the caller is not the registered main frame', async () => {
    const userFile = path.join(root, 'user-notes.md')
    fs.writeFileSync(userFile, 'notes', 'utf8')
    const del = handlers.get(IPC.FS_DELETE)!
    // The pre-IPC-FS-01 fixture: a top-level frame object and nothing else.
    await expect(del({ senderFrame: { parent: null } }, userFile)).rejects.toThrow(/IPC call rejected/)
    expect(fs.readFileSync(userFile, 'utf8')).toBe('notes')
  })

  it('allows deleting a normal user file named .workspace-os-notes.md (not internal store)', async () => {
    const userDotFile = path.join(root, '.workspace-os-notes.md')
    fs.writeFileSync(userDotFile, 'notes', 'utf8')
    const del = handlers.get(IPC.FS_DELETE)!
    await expect(del(event(), userDotFile)).resolves.toBeUndefined()
    expect(fs.existsSync(userDotFile)).toBe(false)
  })

  it('still blocks deleting .workspace-os and entries inside .workspace-os/', async () => {
    const internalDir = path.join(root, '.workspace-os')
    fs.mkdirSync(internalDir, { recursive: true })
    const internalFile = path.join(internalDir, 'db.sqlite')
    fs.writeFileSync(internalFile, 'db', 'utf8')
    const del = handlers.get(IPC.FS_DELETE)!
    await expect(del(event(), internalDir)).rejects.toThrow(/internal store/i)
    await expect(del(event(), internalFile)).rejects.toThrow(/internal store/i)
  })

  it('FS_CREATE refuses to truncate an existing file', async () => {
    const existing = path.join(root, 'important.md')
    fs.writeFileSync(existing, 'DO NOT LOSE ME', 'utf8')
    const create = handlers.get(IPC.FS_CREATE)!
    await expect(create(event(), root, 'important.md', false)).rejects.toThrow()
    expect(fs.readFileSync(existing, 'utf8')).toBe('DO NOT LOSE ME')
  })

  it('FS_RENAME refuses to silently clobber an existing destination file', async () => {
    const a = path.join(root, 'draft.md')
    const b = path.join(root, 'final.md')
    fs.writeFileSync(a, 'draft', 'utf8')
    fs.writeFileSync(b, 'PRECIOUS FINAL', 'utf8')
    const rename = handlers.get(IPC.FS_RENAME)!
    await expect(rename(event(), a, 'final.md')).rejects.toThrow(/already exists/i)
    expect(fs.readFileSync(b, 'utf8')).toBe('PRECIOUS FINAL')
    expect(fs.readFileSync(a, 'utf8')).toBe('draft')
  })
})
