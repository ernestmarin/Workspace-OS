import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'

/**
 * IPC-DRIVE-02 — the five remaining `drive:*` channels (plus `drive:connection`,
 * which the IPC-CLASS-01 triage had put in B and this batch corrected: it
 * returns the connected **account email**, not a boolean).
 *
 * Every one of them talks to Google on the person's behalf: `connect` runs the
 * OAuth flow in the system browser and stores a refresh token, `disconnect`
 * drops it, `list`/`search` read the user's Drive, `open` **writes a remote file
 * into the workspace**. None looked at the event.
 *
 * Google's clients and the system browser are mocked; the guard, `guard()`'s
 * result envelope, the workspace write and the basename confinement are real.
 */

const state = vi.hoisted(() => ({
  root: '',
  userData: '',
  calls: [] as string[],
  saved: [] as unknown[],
}))

vi.mock('electron', () => ({ app: { getPath: (n: string) => (n === 'userData' ? state.userData : state.root) } }))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => state.root || null }))
vi.mock('../mail/safe-secret-store', () => ({ safeSecretStore: {} }))
vi.mock('../mail/oauth/client-config', () => ({ resolveGoogleClientId: () => 'client-id' }))
vi.mock('../mail/oauth/oauth-flow', () => ({
  runGoogleOAuthFlow: async () => {
    state.calls.push('oauth')
    return { ok: true, value: { tokens: { accessToken: 'a', refreshToken: 'r' } } }
  },
}))
vi.mock('../mail/oauth/google-oauth', () => ({
  EMAIL_SCOPE: 'email',
  refreshAccessToken: async () => {
    state.calls.push('token')
    return { ok: true, value: { accessToken: 'tok' } }
  },
}))
vi.mock('../drive/drive-account', () => ({
  DriveAccountStore: class {
    async get() {
      return { email: 'person@example.com', access: 'full', connectedAt: '2026-01-01' }
    }
    async save(connection: unknown, refreshToken: string) {
      state.calls.push('save')
      state.saved.push({ connection, refreshToken })
    }
    async disconnect() {
      state.calls.push('disconnect')
    }
    async refreshToken() {
      return 'refresh-token'
    }
  },
  canWrite: () => true,
}))
vi.mock('../drive/drive-client', () => ({
  DRIVE_SCOPES: { full: 'drive', appFiles: 'appdata', readOnly: 'drive.readonly' },
  listFolder: async () => {
    state.calls.push('listFolder')
    return { files: [], nextPageToken: null }
  },
  searchFiles: async () => {
    state.calls.push('searchFiles')
    return { files: [] }
  },
  getFile: async () => {
    state.calls.push('getFile')
    return { id: 'f1', name: 'plan.docx', isFolder: false, isGoogleDoc: false }
  },
  downloadFile: async () => {
    state.calls.push('downloadFile')
    return { bytes: new Uint8Array([1, 2, 3]), filename: 'plan.docx' }
  },
  updateFile: async () => ({ name: 'plan.docx', modifiedAt: '2026-02-02' }),
  localNameFor: () => 'plan.docx',
  DriveError: class extends Error {},
}))

const { registerDriveHandlers } = await import('./drive')

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, Handler>()

function makeWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: { parent: null }, send: vi.fn() } }
}
function source(win: ReturnType<typeof makeWindow>) {
  return { sender: win.webContents, senderFrame: win.webContents.mainFrame }
}

let owner: ReturnType<typeof makeWindow>
let root = ''

beforeAll(() => registerDriveHandlers({ handle: handlers.set.bind(handlers) } as never))

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-drive-ipc-'))
  state.root = root
  state.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-drive-data-'))
  state.calls = []
  state.saved = []
  owner = makeWindow()
  setMainWindow(owner as never)
})
afterEach(async () => {
  for (const d of [root, state.userData]) await fs.rm(d, { recursive: true, force: true })
})

const unauthorized = [
  { kind: 'a missing frame', event: () => ({ sender: owner.webContents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: {} } }) },
  { kind: 'a stale top-level frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: null } }) },
  { kind: 'a foreign window', event: () => source(makeWindow()) },
]

const channels = [
  { channel: IPC.DRIVE_CONNECTION, args: () => [] },
  { channel: IPC.DRIVE_CONNECT, args: () => ['full'] },
  { channel: IPC.DRIVE_DISCONNECT, args: () => [] },
  { channel: IPC.DRIVE_LIST, args: () => ['root', null] },
  { channel: IPC.DRIVE_SEARCH, args: () => ['plan'] },
  { channel: IPC.DRIVE_OPEN, args: () => ['f1'] },
]

describe.each(channels)('$channel', ({ channel, args }) => {
  it.each(unauthorized)('refuses $kind without touching Google or the disk', async ({ event }) => {
    await expect(handlers.get(channel)!(event(), ...args())).rejects.toThrow(/IPC call rejected/)
    expect(state.calls).toEqual([])
    expect(state.saved).toEqual([])
    // Nothing was fetched into the workspace.
    expect(await fs.readdir(root)).toEqual([])
  })
})

describe('the registered main window keeps the surface', () => {
  it('answers every channel for the current owner', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    const event = source(replacement)
    const call = (channel: string, ...args: unknown[]): Promise<unknown> => handlers.get(channel)!(event, ...args)

    expect(await call(IPC.DRIVE_CONNECTION)).toMatchObject({
      connection: { email: 'person@example.com' },
      canWrite: true,
      clientIdConfigured: true,
    })

    expect(await call(IPC.DRIVE_CONNECT, 'full')).toMatchObject({ ok: true, value: { connection: { access: 'full' } } })
    expect(state.saved).toHaveLength(1)

    expect(await call(IPC.DRIVE_LIST, 'root', null)).toMatchObject({ ok: true, value: { files: [] } })
    expect(await call(IPC.DRIVE_SEARCH, 'plan')).toMatchObject({ ok: true, value: { files: [] } })

    const opened = await call(IPC.DRIVE_OPEN, 'f1') as { ok: boolean; value: { name: string; path: string } }
    expect(opened).toMatchObject({ ok: true, value: { name: 'plan.docx' } })
    expect(await fs.readFile(opened.value.path)).toEqual(Buffer.from([1, 2, 3]))
    // Fetched into the workspace, under the Drive folder — not into the root.
    expect(opened.value.path.startsWith(root + path.sep)).toBe(true)

    expect(await call(IPC.DRIVE_DISCONNECT)).toEqual({ ok: true })
    expect(state.calls).toContain('disconnect')
  })

  it('keeps the surviving validation and the result envelope', async () => {
    const event = source(owner)
    // No workspace open → `drive:open` reports a failed envelope, never a write.
    state.root = ''
    await expect(handlers.get(IPC.DRIVE_OPEN)!(event, 'f1')).resolves.toMatchObject({ ok: false })
    expect(state.calls).toEqual([])
    // The connect access level is coerced, never trusted.
    state.root = root
    await expect(handlers.get(IPC.DRIVE_CONNECT)!(event, 'everything')).resolves.toMatchObject({ ok: true })
    expect((state.saved[0] as { connection: { access: string } }).connection.access).toBe('readOnly')
  })
})
