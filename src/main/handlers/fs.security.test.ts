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

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-sec07-'))
    state.root = root
  })

  afterEach(() => {
    state.root = ''
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('allows deleting a normal user file named .workspace-os-notes.md (not internal store)', async () => {
    const userDotFile = path.join(root, '.workspace-os-notes.md')
    fs.writeFileSync(userDotFile, 'notes', 'utf8')
    const del = handlers.get(IPC.FS_DELETE)!
    await expect(del({ senderFrame: { parent: null } }, userDotFile)).resolves.toBeUndefined()
    expect(fs.existsSync(userDotFile)).toBe(false)
  })

  it('still blocks deleting .workspace-os and entries inside .workspace-os/', async () => {
    const internalDir = path.join(root, '.workspace-os')
    fs.mkdirSync(internalDir, { recursive: true })
    const internalFile = path.join(internalDir, 'db.sqlite')
    fs.writeFileSync(internalFile, 'db', 'utf8')
    const del = handlers.get(IPC.FS_DELETE)!
    await expect(del({ senderFrame: { parent: null } }, internalDir)).rejects.toThrow(/internal store/i)
    await expect(del({ senderFrame: { parent: null } }, internalFile)).rejects.toThrow(/internal store/i)
  })

  it('FS_CREATE refuses to truncate an existing file', async () => {
    const existing = path.join(root, 'important.md')
    fs.writeFileSync(existing, 'DO NOT LOSE ME', 'utf8')
    const create = handlers.get(IPC.FS_CREATE)!
    await expect(create({ senderFrame: { parent: null } }, root, 'important.md', false)).rejects.toThrow()
    expect(fs.readFileSync(existing, 'utf8')).toBe('DO NOT LOSE ME')
  })

  it('FS_RENAME refuses to silently clobber an existing destination file', async () => {
    const a = path.join(root, 'draft.md')
    const b = path.join(root, 'final.md')
    fs.writeFileSync(a, 'draft', 'utf8')
    fs.writeFileSync(b, 'PRECIOUS FINAL', 'utf8')
    const rename = handlers.get(IPC.FS_RENAME)!
    await expect(rename({ senderFrame: { parent: null } }, a, 'final.md')).rejects.toThrow(/already exists/i)
    expect(fs.readFileSync(b, 'utf8')).toBe('PRECIOUS FINAL')
    expect(fs.readFileSync(a, 'utf8')).toBe('draft')
  })
})
