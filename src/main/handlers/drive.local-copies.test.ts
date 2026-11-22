import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setMainWindow } from '../main-window'

/**
 * IPC-DRIVE-03 — two Drive files with the same name overwrote each other.
 *
 * `drive:open` fetched a Drive file into `<workspace>/Drive/` and wrote it at
 * `path.join(dir, path.basename(filename))` — the *name* decided the local path,
 * and nothing else did. Opening `report.docx` from one Drive folder and then
 * `report.docx` from another left exactly one file on disk: the second copy,
 * silently, over a document the canvas may have been showing. The browser's
 * download path already resolves collisions (`uniquePath`); this path did not.
 *
 * The fix has to keep two behaviours apart, which is why it is not simply
 * "always suffix":
 *
 *  - **same Drive file opened again** → refresh THAT local copy (a second
 *    `report (2).docx` for every re-open would be worse than useless);
 *  - **different Drive file, same name** → a new local file, never over the
 *    first.
 *
 * The mapping lives in the workspace store (`.workspace-os/drive-copies.json`),
 * keyed by Drive file id. These tests use the real filesystem: real folders,
 * real bytes, real index file. Only the network boundary is mocked.
 */

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  root: '',
  userData: '',
  files: new Map<string, { name: string; bytes: Uint8Array }>(),
}))

vi.mock('electron', () => ({
  app: { getPath: (n: string) => (n === 'userData' ? mock.userData : mock.userData), IpcMain: class {} },
}))
vi.mock('../ipc-registry', () => ({
  ipcHandle: (_ipc: unknown, channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
    mock.handlers.set(channel, handler)
  },
}))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => mock.root || null }))
vi.mock('../mail/safe-secret-store', () => ({ safeSecretStore: () => ({ get: async () => 'token' }) }))
vi.mock('../mail/oauth/client-config', () => ({ resolveGoogleClientId: () => 'cid' }))
vi.mock('../mail/oauth/oauth-flow', () => ({ runGoogleOAuthFlow: vi.fn() }))
vi.mock('../mail/oauth/google-oauth', () => ({
  refreshAccessToken: async () => ({ ok: true, value: { accessToken: 'at', expiresAt: 0 } }),
  EMAIL_SCOPE: 'e',
}))
const connection = { access: 'full' as const, refreshToken: 'rt', clientId: 'cid', email: 'a@b.c' }
vi.mock('../drive/drive-account', () => ({
  canWrite: () => true,
  DriveAccountStore: class {
    get = async (): Promise<typeof connection | null> => connection
    refreshToken = async (): Promise<string | null> => 'rt'
  },
}))
vi.mock('../drive/drive-client', () => ({
  DRIVE_SCOPES: [],
  DriveError: class extends Error {},
  localNameFor: ({ name }: { name: string }) => name,
  listFolder: vi.fn(),
  searchFiles: vi.fn(),
  getFile: vi.fn(async (_t: string, id: string) => {
    const f = mock.files.get(id)
    if (!f) throw new Error(`no such file ${id}`)
    return { id, name: f.name, isFolder: false, isGoogleDoc: false, mimeType: 'application/pdf' }
  }),
  downloadFile: vi.fn(async (_t: string, meta: { id: string }) => {
    const f = mock.files.get(meta.id)!
    return { bytes: f.bytes, filename: f.name }
  }),
  updateFile: vi.fn(),
}))

import { IPC } from '../ipc-channels'
import { registerDriveHandlers } from './drive'

function ownerEvent(): { sender: unknown; senderFrame: unknown } {
  const frame = { parent: null }
  const webContents = { isDestroyed: () => false, mainFrame: frame, send: vi.fn() }
  setMainWindow({ isDestroyed: () => false, webContents } as never)
  return { sender: webContents, senderFrame: frame }
}

/** `drive:open` answers with the `guard()` envelope; unwrap or fail loudly. */
async function open(fileId: string): Promise<{ path: string; name: string }> {
  const res = (await mock.handlers.get(IPC.DRIVE_OPEN)!(ownerEvent(), fileId)) as
    | { ok: true; value: { path: string; name: string } }
    | { ok: false; error: { message: string } }
  if (!res.ok) throw new Error(res.error.message)
  return res.value
}

const driveDir = (): string => path.join(mock.root, 'Drive')
const read = (p: string): string => fs.readFileSync(p, 'utf8')

beforeAll(() => {
  registerDriveHandlers({} as never)
})

beforeEach(() => {
  mock.handlers.clear()
  mock.files.clear()
  mock.root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-drive-collide-'))
  mock.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-drive-udata-'))
  registerDriveHandlers({} as never)
})
afterEach(() => {
  fs.rmSync(mock.root, { recursive: true, force: true })
  fs.rmSync(mock.userData, { recursive: true, force: true })
})

describe('drive:open local copies', () => {
  it('gives two Drive files with the same name two local files, keeping both', async () => {
    mock.files.set('f1', { name: 'report.docx', bytes: new Uint8Array(Buffer.from('FIRST REPORT')) })
    mock.files.set('f2', { name: 'report.docx', bytes: new Uint8Array(Buffer.from('SECOND REPORT')) })

    const first = await open('f1')
    const second = await open('f2')

    expect(path.basename(first.path)).toBe('report.docx')
    expect(path.basename(second.path)).toBe('report (2).docx')
    expect(first.path).not.toBe(second.path)
    expect(read(first.path)).toBe('FIRST REPORT')
    expect(read(second.path)).toBe('SECOND REPORT')
    expect(fs.readdirSync(driveDir()).sort()).toEqual(['report (2).docx', 'report.docx'])
  })

  it('refreshes the same Drive file in place instead of piling up copies', async () => {
    mock.files.set('f1', { name: 'notes.md', bytes: new Uint8Array(Buffer.from('v1')) })
    const first = await open('f1')

    mock.files.set('f1', { name: 'notes.md', bytes: new Uint8Array(Buffer.from('v2')) })
    const again = await open('f1')

    expect(again.path).toBe(first.path)
    expect(read(again.path)).toBe('v2')
    expect(fs.readdirSync(driveDir())).toEqual(['notes.md'])
  })

  it('keeps the name stable when the Drive file is renamed', async () => {
    mock.files.set('f1', { name: 'draft.md', bytes: new Uint8Array(Buffer.from('text')) })
    const first = await open('f1')

    mock.files.set('f1', { name: 'final.md', bytes: new Uint8Array(Buffer.from('text v2')) })
    const again = await open('f1')

    // Same Drive file → same local copy. Renaming the local file on every Drive
    // rename would break the canvas tab that has it open.
    expect(again.path).toBe(first.path)
    expect(read(again.path)).toBe('text v2')
    expect(fs.readdirSync(driveDir())).toEqual(['draft.md'])
  })

  it('ignores an index entry that points outside the Drive folder', async () => {
    mock.files.set('f1', { name: 'report.docx', bytes: new Uint8Array(Buffer.from('x')) })
    await open('f1')

    // Somebody (or an older build) leaves a mapping to a path outside `Drive/`.
    const outside = path.join(mock.root, 'outside.docx')
    fs.writeFileSync(outside, 'DO NOT TOUCH')
    const indexFile = path.join(mock.root, '.workspace-os', 'drive-copies.json')
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
    index.files['f9'] = { path: outside, at: new Date().toISOString() }
    fs.writeFileSync(indexFile, JSON.stringify(index))

    mock.files.set('f9', { name: 'outside.docx', bytes: new Uint8Array(Buffer.from('NEW')) })
    const res = await open('f9')

    expect(path.dirname(res.path)).toBe(driveDir())
    expect(read(outside)).toBe('DO NOT TOUCH')
    expect(read(res.path)).toBe('NEW')
  })

  it('writes the mapping into the workspace store, not the Drive folder', async () => {
    mock.files.set('f1', { name: 'a.txt', bytes: new Uint8Array(Buffer.from('a')) })
    await open('f1')

    const indexFile = path.join(mock.root, '.workspace-os', 'drive-copies.json')
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
    expect(index.files.f1.path).toBe(path.join(driveDir(), 'a.txt'))
    expect(fs.readdirSync(driveDir())).toEqual(['a.txt'])
  })
})

describe('the copy index itself', () => {
  it('is bounded, dropping the oldest entries', async () => {
    const { DriveCopyIndex, DRIVE_COPIES_MAX } = await import('../drive/drive-copies')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-drive-index-'))
    try {
      const index = new DriveCopyIndex(path.join(dir, 'drive-copies.json'))
      for (let i = 0; i < DRIVE_COPIES_MAX + 25; i += 1) {
        index.set(`f${i}`, path.join(dir, `file-${i}.txt`), 1_000 + i)
      }
      const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'drive-copies.json'), 'utf8'))
      const keys = Object.keys(onDisk.files)
      expect(keys.length).toBe(DRIVE_COPIES_MAX)
      // The oldest went first: f0 … f24 are gone, the newest are there.
      expect(keys).not.toContain('f0')
      expect(keys).toContain(`f${DRIVE_COPIES_MAX + 24}`)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('survives a corrupted index file instead of failing the open', async () => {
    const { DriveCopyIndex } = await import('../drive/drive-copies')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-drive-index-'))
    try {
      const file = path.join(dir, 'drive-copies.json')
      fs.writeFileSync(file, '{ this is not json')
      const index = new DriveCopyIndex(file)
      expect(index.get('f1')).toBeNull()
      index.set('f1', path.join(dir, 'x.txt'))
      expect(index.get('f1')).toBe(path.join(dir, 'x.txt'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
