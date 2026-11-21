import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setMainWindow } from '../main-window'

/**
 * RT-07 — Drive "save back" accepted a symlink escape.
 *
 * `drive:save` reads a local file and uploads it to the connected Drive. The
 * confinement check was lexical:
 *
 *     const abs = path.resolve(root, localPath)
 *     if (abs !== root && !abs.startsWith(root + path.sep)) throw ...
 *
 * which is exactly the check SEC-01 replaced everywhere else, because it cannot
 * see a symlink. `<workspace>/out -> /home/user/private` passes it, and the
 * contents of that directory are then uploaded to a third party. The workspace
 * import path inside the Drive client is a plain `path.join(root, …)` that never
 * consults the validator, so there is nothing downstream that would catch it.
 *
 * These use the real filesystem: a real directory, a real symlink, a real
 * outside file. A mock would pass against the broken code.
 */

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, ...args: any[]) => any>(),
  root: '',
  connected: true as boolean | null,
  written: [] as { dir: string; name: string }[],
  uploaded: [] as Uint8Array[],
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, IpcMain: class {} }))
vi.mock('../ipc-registry', () => ({
  ipcHandle: (_ipc: unknown, channel: string, handler: any) => mock.handlers.set(channel, handler),
}))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => mock.root }))
vi.mock('../mail/safe-secret-store', () => ({ safeSecretStore: () => ({ get: async () => 'token' }) }))
vi.mock('../mail/oauth/client-config', () => ({ resolveGoogleClientId: () => 'cid' }))
vi.mock('../mail/oauth/oauth-flow', () => ({ runGoogleOAuthFlow: vi.fn() }))
vi.mock('../mail/oauth/google-oauth', () => ({
  // A live connection: without a token every case would stop at "not connected"
  // and never reach the path check this test exists for.
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
  getFile: vi.fn(async () => ({ id: 'f1', name: 'report.pdf', isFolder: false, isGoogleDoc: false })),
  downloadFile: vi.fn(async () => {
    mock.written.push({ dir: '', name: 'report.pdf' })
    return { bytes: new Uint8Array([1]), filename: 'report.pdf' }
  }),
  updateFile: vi.fn(async (_t: string, _m: unknown, bytes: Uint8Array) => {
    mock.uploaded.push(bytes)
    return { name: 'report.pdf', modifiedAt: '2026-11-20T00:00:00Z' }
  }),
}))

import { IPC } from '../ipc-channels'
import { registerDriveHandlers } from './drive'

/**
 * The registered main window and an event from its current main frame.
 *
 * Since IPC-WRITERS-01 `drive:save` refuses anything else — and it refuses by
 * *throwing* (the guard sits outside the result envelope), so a fabricated event
 * would turn every `{ ok: false }` assertion below into a rejection and the
 * constants of this test into a different test. `invokeAs` keeps the refusal
 * reachable for the one test that pins it.
 */
function ownerEvent(): { sender: unknown; senderFrame: unknown } {
  const frame = { parent: null }
  const webContents = { isDestroyed: () => false, mainFrame: frame, send: vi.fn() }
  setMainWindow({ isDestroyed: () => false, webContents } as never)
  return { sender: webContents, senderFrame: frame }
}

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
  mock.handlers.get(channel)!(ownerEvent(), ...args)

// `async` on purpose: the guard throws synchronously (it runs before the result
// envelope), and `ipcMain.handle` turns that into a rejection for the renderer —
// so the test must observe a rejection, not a synchronous throw.
const invokeAs = async (event: unknown, channel: string, ...args: unknown[]): Promise<unknown> =>
  mock.handlers.get(channel)!(event, ...args)

let root = ''
let outside = ''

beforeEach(() => {
  mock.handlers.clear()
  mock.uploaded.length = 0
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-drive-root-'))
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-drive-outside-'))
  fs.writeFileSync(path.join(outside, 'secret.pdf'), 'PRIVATE MEDICAL RECORD')
  mock.root = root
  registerDriveHandlers({} as any)
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

describe('RT-07 drive:save path confinement', () => {
  it('refuses a path that escapes the workspace through a symlink', async () => {
    fs.symlinkSync(outside, path.join(root, 'out'), 'dir')
    // drive.ts returns a typed failure rather than throwing (its `guard` shape).
    expect(await invoke(IPC.DRIVE_SAVE, 'f1', 'out/secret.pdf')).toMatchObject({ ok: false })
    // The important half: nothing from outside the workspace was uploaded.
    expect(mock.uploaded).toEqual([])
  })

  it('refuses a plain ../ traversal', async () => {
    expect(await invoke(IPC.DRIVE_SAVE, 'f1', '../secret.pdf')).toMatchObject({ ok: false })
    expect(mock.uploaded).toEqual([])
  })

  it('refuses a dangling symlink at the file itself', async () => {
    fs.symlinkSync(path.join(outside, 'secret.pdf'), path.join(root, 'link.pdf'))
    expect(await invoke(IPC.DRIVE_SAVE, 'f1', 'link.pdf')).toMatchObject({ ok: false })
    expect(mock.uploaded).toEqual([])
  })

  it('refuses an event that is not the registered main window', async () => {
    // Pins the refusal separately from the path rules above: no upload, and the
    // throw is not turned into an { ok: false } envelope.
    await expect(invokeAs({ senderFrame: { parent: null } }, IPC.DRIVE_SAVE, 'f1', 'notes.pdf')).rejects.toThrow(
      /IPC call rejected/,
    )
    expect(mock.uploaded).toHaveLength(0)
  })

  it('still saves a genuine file inside the workspace', async () => {
    fs.writeFileSync(path.join(root, 'notes.pdf'), 'my own notes')
    const result = await invoke(IPC.DRIVE_SAVE, 'f1', 'notes.pdf')
    expect(result).toMatchObject({ ok: true, value: { name: 'report.pdf' } })
    expect(mock.uploaded).toHaveLength(1)
    expect(mock.uploaded[0]).toBeInstanceOf(Uint8Array)
  })
})
