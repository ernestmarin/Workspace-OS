import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerFsHandlers } from './fs'
import { trash } from '../trash'
import { setMainWindow } from '../main-window'
import { IPC } from '../ipc-channels'

/**
 * IPC-FS-01 — the workspace filesystem surface had confinement but no origin
 * check.
 *
 * Every one of these eight handlers took `_event` and ignored it. `sanitize()`
 * / `validateFilePath()` confine a path to the workspace root, which stops
 * traversal — it says nothing about WHO asked. So any renderer that could reach
 * the preload bridge (a stale top-level frame after navigation, a detached or
 * child frame, or a webContents that is not the registered owner) could
 * overwrite, delete, rename or create files inside the user's workspace.
 *
 * The guard is the same one `trash.ts` already uses: the live registered main
 * window and its CURRENT main frame. Read and write are both covered — a
 * read-only escape is still a privacy breach.
 */

let root: string
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => root }))
vi.mock('../host-profile', () => ({ appStateDir: (dir: string) => path.join(dir, '.workspace-os') }))

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, Handler>()
beforeAll(() => registerFsHandlers({ handle: handlers.set.bind(handlers) } as never))

function makeWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: { parent: null } } }
}
function source(win: ReturnType<typeof makeWindow>) {
  return { sender: win.webContents, senderFrame: win.webContents.mainFrame }
}
let owner: ReturnType<typeof makeWindow>
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-fs-ipc-'))
  owner = makeWindow()
  setMainWindow(owner as never)
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

const exists = async (p: string): Promise<boolean> => fs.stat(p).then(() => true, () => false)

/** Each channel, with arguments that WOULD mutate the workspace if allowed. */
const mutating: Array<{ channel: string; args: (file: string) => unknown[]; intact: (file: string, sibling: string) => Promise<void> }> = [
  {
    channel: IPC.FS_WRITE_FILE,
    args: (file) => [file, 'overwritten'],
    intact: async (file) => { expect(await fs.readFile(file, 'utf8')).toBe('original') },
  },
  {
    channel: IPC.FS_DELETE,
    args: (file) => [file],
    intact: async (file) => { expect(await exists(file)).toBe(true) },
  },
  {
    channel: IPC.FS_RENAME,
    args: (file) => [file, 'renamed.txt'],
    intact: async (file, sibling) => {
      expect(await exists(file)).toBe(true)
      expect(await exists(sibling)).toBe(false)
    },
  },
  {
    channel: IPC.FS_CREATE,
    args: () => [root, 'planted.txt'],
    intact: async () => { expect(await exists(path.join(root, 'planted.txt'))).toBe(false) },
  },
]

const reading: Array<{ channel: string; args: (file: string) => unknown[] }> = [
  { channel: IPC.FS_READ_FILE, args: (file) => [file] },
  { channel: IPC.FS_READ_FILE_BYTES, args: (file) => [file] },
  { channel: IPC.FS_READ_DIR, args: () => [root] },
  { channel: IPC.FS_LIST_FILES, args: () => [] },
]

const unauthorized: Array<{ kind: string; event: () => unknown }> = [
  { kind: 'a missing frame', event: () => ({ sender: owner.webContents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: {} } }) },
  { kind: 'a stale top-level frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: null } }) },
  { kind: 'a foreign window', event: () => source(makeWindow()) },
]

async function seed(): Promise<{ file: string; sibling: string }> {
  await fs.writeFile(path.join(root, 'target.txt'), 'original')
  return { file: path.join(root, 'target.txt'), sibling: path.join(root, 'renamed.txt') }
}

describe.each(mutating)('$channel', ({ channel, args, intact }) => {
  it.each(unauthorized)('refuses $kind without touching the workspace', async ({ event }) => {
    const { file, sibling } = await seed()
    await expect(handlers.get(channel)!(event(), ...args(file))).rejects.toThrow(/IPC call rejected/)
    await intact(file, sibling)
    // Refusal must not snapshot the file into the recovery store either.
    expect(await trash.list()).toEqual([])
  })
})

describe.each(reading)('$channel', ({ channel, args }) => {
  it.each(unauthorized)('refuses $kind', async ({ event }) => {
    const { file } = await seed()
    await expect(handlers.get(channel)!(event(), ...args(file))).rejects.toThrow(/IPC call rejected/)
  })
})

describe('the registered main window keeps the whole surface', () => {
  it('reads, lists, creates, renames, writes and deletes after the owner is replaced', async () => {
    // A reopened window is a NEW owner; the guard must not pin the old one.
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    const event = source(replacement)
    const call = (channel: string, ...args: unknown[]): Promise<unknown> => handlers.get(channel)!(event, ...args)

    await fs.mkdir(path.join(root, 'nested'))
    await fs.writeFile(path.join(root, 'nested', 'deep.txt'), 'deep')
    await fs.writeFile(path.join(root, 'plain.txt'), 'plain')

    expect(await call(IPC.FS_LIST_FILES)).toContain(path.join(root, 'nested', 'deep.txt'))
    const listing = await call(IPC.FS_READ_DIR, root) as Array<{ name: string; size: number }>
    expect(listing.find((entry) => entry.name === 'plain.txt')).toMatchObject({ name: 'plain.txt', size: 5 })
    expect(await call(IPC.FS_READ_FILE, path.join(root, 'plain.txt'))).toBe('plain')
    expect(Buffer.from(await call(IPC.FS_READ_FILE_BYTES, path.join(root, 'plain.txt')) as Uint8Array).toString()).toBe('plain')

    const created = await call(IPC.FS_CREATE, root, 'new.txt', false) as string
    expect(await fs.readFile(created, 'utf8')).toBe('')
    await call(IPC.FS_CREATE, root, 'newdir', true)
    expect((await fs.stat(path.join(root, 'newdir'))).isDirectory()).toBe(true)

    await call(IPC.FS_RENAME, created, 'moved.txt')
    expect(await exists(path.join(root, 'moved.txt'))).toBe(true)
    expect(await exists(created)).toBe(false)

    // Write snapshots the prior version into trash, then replaces the file.
    await call(IPC.FS_WRITE_FILE, path.join(root, 'plain.txt'), 'changed')
    expect(await fs.readFile(path.join(root, 'plain.txt'), 'utf8')).toBe('changed')
    const snapshots = await trash.list()
    expect(snapshots).toHaveLength(1)
    expect(await fs.readFile(snapshots[0].storedPath, 'utf8')).toBe('plain')

    // Delete is reversible: the original leaves the workspace, the store has it.
    await call(IPC.FS_DELETE, path.join(root, 'moved.txt'))
    expect(await exists(path.join(root, 'moved.txt'))).toBe(false)
    const afterDelete = await trash.list()
    const deleted = afterDelete.find((entry) => entry.originalPath === path.join(root, 'moved.txt'))
    expect(deleted).toBeDefined()
    await trash.restore(deleted!.id)
    expect(await exists(path.join(root, 'moved.txt'))).toBe(true)
  })
})
