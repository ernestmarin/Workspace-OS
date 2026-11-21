import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'
import { IpcValidationError } from '../ipc-validator'

/**
 * IPC-WRITERS-01 — the last three sensitive channels without an origin check.
 *
 * `components:save` writes the reusable-component store; `wiki:add` feeds the
 * self-maintaining wiki (which calls a language model and rewrites pages in the
 * workspace); `drive:save` **uploads a local file to the user's Google Drive** —
 * the only channel here whose effect leaves the machine.
 *
 * Every collaborator that leaves the process (Drive, the model, the wiki store)
 * is mocked; the guard, the path validation and the component store are real.
 */

const state = vi.hoisted(() => ({
  root: '',
  userData: '',
  calls: [] as string[],
  sources: {} as Record<string, { mtimeMs: number }>,
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => state.root || null }))
vi.mock('../host-profile', () => ({ contentRel: (_root: string, name: string) => name }))
vi.mock('../search/extract', () => ({ extractText: async () => 'text' }))
vi.mock('../agent/providerText', () => ({ runProviderOneShot: async () => { state.calls.push('model'); return 'page' } }))
vi.mock('./search', () => ({ indexNow: async () => { state.calls.push('indexNow') } }))
vi.mock('../wiki/wiki-page', () => ({ WIKI_DIR: 'Wiki' }))
vi.mock('../wiki/wiki-store', async (orig) => ({
  ...(await orig() as object),
  sources: () => {
    state.calls.push('wiki.sources')
    return state.sources
  },
  wikiDir: () => path.join(state.root, 'Wiki'),
}))
vi.mock('../mail/safe-secret-store', () => ({ safeSecretStore: {} }))
vi.mock('../mail/oauth/client-config', () => ({ resolveGoogleClientId: () => 'client-id' }))
vi.mock('../mail/oauth/oauth-flow', () => ({ runGoogleOAuthFlow: async () => null }))
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
      return { scopes: ['https://www.googleapis.com/auth/drive'] }
    }
    async refreshToken() {
      return 'refresh-token'
    }
  },
  canWrite: () => true,
}))
vi.mock('../drive/drive-client', async (orig) => ({
  ...(await orig() as object),
  DRIVE_SCOPES: [],
  getFile: async () => {
    state.calls.push('getFile')
    return { id: 'f1', name: 'plan.docx', mimeType: 'application/msword', modifiedAt: '2026-01-01' }
  },
  updateFile: async () => {
    state.calls.push('updateFile')
    return { name: 'plan.docx', modifiedAt: '2026-02-02' }
  },
}))

const { registerComponentsHandlers } = await import('./components')
const { registerWikiHandlers } = await import('./wiki')
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

beforeAll(() => {
  const ipcMain = { handle: handlers.set.bind(handlers) }
  registerComponentsHandlers(ipcMain as never)
  registerWikiHandlers(ipcMain as never)
  registerDriveHandlers(ipcMain as never)
})

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-writers-ipc-'))
  state.root = root
  state.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-writers-data-'))
  state.calls = []
  state.sources = {}
  await fs.writeFile(path.join(root, 'plan.docx'), 'fake docx')
  await fs.writeFile(path.join(root, 'note.md'), '# note')
  owner = makeWindow()
  setMainWindow(owner as never)
})
afterEach(async () => {
  for (const dir of [root, state.userData]) await fs.rm(dir, { recursive: true, force: true })
})

const unauthorized = [
  { kind: 'a missing frame', event: () => ({ sender: owner.webContents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: {} } }) },
  { kind: 'a stale top-level frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: null } }) },
  { kind: 'a foreign window', event: () => source(makeWindow()) },
]

const componentPayload = () => ({ id: 'c1', name: 'Hero', type: 'card', w: 800, h: 600 })

const channels = [
  { channel: IPC.COMPONENTS_SAVE, args: () => [componentPayload()] },
  { channel: IPC.WIKI_ADD, args: () => [[path.join(root, 'note.md')], {}] },
  { channel: IPC.DRIVE_SAVE, args: () => ['f1', path.join(root, 'plan.docx')] },
]

describe.each(channels)('$channel', ({ channel, args }) => {
  it.each(unauthorized)('refuses $kind without reaching any collaborator', async ({ event }) => {
    await expect(handlers.get(channel)!(event(), ...args())).rejects.toThrow(/IPC call rejected/)
    expect(state.calls).toEqual([])
    // Nothing was written to the app's own store on the caller's behalf.
    expect(await fs.readdir(state.userData)).toEqual([])
  })
})

describe('the registered main window keeps the surface', () => {
  it('saves a component for the current owner', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    const saved = await handlers.get(IPC.COMPONENTS_SAVE)!(source(replacement), componentPayload())
    expect(saved).toMatchObject({ id: 'c1', name: 'Hero' })
    const raw = await fs.readFile(path.join(state.userData, 'components.json'), 'utf8')
    expect(JSON.parse(raw)).toHaveLength(1)
  })

  it('adds to the wiki for the current owner, skipping an unchanged source', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    state.sources = { 'note.md': { mtimeMs: Date.now() + 1_000_000 } }
    const answer = await handlers.get(IPC.WIKI_ADD)!(source(replacement), [path.join(root, 'note.md')], {})
    expect(answer).toEqual({ queued: 0, unchanged: 1, left: 0 })
    expect(state.calls).toEqual(['wiki.sources'])
  })

  it('uploads to Drive for the current owner', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    // drive:* answers with a result envelope (`guard()` turns throws into values).
    const saved = await handlers.get(IPC.DRIVE_SAVE)!(source(replacement), 'f1', path.join(root, 'plan.docx'))
    expect(saved).toEqual({ ok: true, value: { name: 'plan.docx', modifiedAt: '2026-02-02' } })
    expect(state.calls).toEqual(['token', 'getFile', 'updateFile'])
  })

  it('keeps the surviving input validation', async () => {
    const event = source(owner)
    // A file outside the workspace is still refused before any upload — the
    // drive surface reports it as a failed envelope, not a throw.
    await expect(handlers.get(IPC.DRIVE_SAVE)!(event, 'f1', '/etc/passwd')).resolves.toMatchObject({ ok: false })
    expect(state.calls).toEqual([])
    await expect(handlers.get(IPC.WIKI_ADD)!(event, [path.join(root, '..', 'outside.md')], {})).rejects.toBeInstanceOf(
      IpcValidationError,
    )
    await expect(handlers.get(IPC.WIKI_ADD)!(event, [], {})).rejects.toThrow(/Which files/)
    // `wiki:add` reads its known-sources list before validating each path (a
    // pre-existing read, not an effect); nothing was ingested or indexed.
    expect(state.calls.filter((c) => c === 'model' || c === 'indexNow')).toEqual([])
  })
})
