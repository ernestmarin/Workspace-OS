import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'
import { IpcValidationError } from '../ipc-validator'

/**
 * IPC-SESSION-02 — the conversation surface.
 *
 * `sessions:load` returns the **entire chat transcript** of the workspace and
 * `sessions:save` writes it (≤ 40 MB) atomically; `chat:upload` writes dropped
 * file bytes into `.workspace-os/uploads/<day>/`. None of the three looked at the
 * event. `sessions:save` did have a real control — it only accepts a root the app
 * opened in this run — but that bounds *which workspace*, not *who is asking*.
 *
 * The real handlers run against a temp workspace; only `appStateDir` is stubbed
 * to the layout the module documents.
 */

const state = vi.hoisted(() => ({ root: '' }))

vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => state.root || null }))
vi.mock('../host-profile', () => ({
  appStateDir: (root: string) => path.join(root, '.workspace-os'),
  contentRel: (_root: string, name: string) => name,
}))

const { registerChatHandlers } = await import('./chat')

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

beforeAll(() => registerChatHandlers({ handle: handlers.set.bind(handlers) } as never))

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-chat-ipc-'))
  state.root = root
  owner = makeWindow()
  setMainWindow(owner as never)
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const unauthorized = [
  { kind: 'a missing frame', event: () => ({ sender: owner.webContents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: {} } }) },
  { kind: 'a stale top-level frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: null } }) },
  { kind: 'a foreign window', event: () => source(makeWindow()) },
]

const channels = [
  { channel: IPC.SESSIONS_LOAD, args: () => [] },
  { channel: IPC.SESSIONS_SAVE, args: () => [root, '{"messages":[]}'] },
  { channel: IPC.CHAT_UPLOAD, args: () => ['note.txt', new Uint8Array([1, 2, 3])] },
]

describe.each(channels)('$channel', ({ channel, args }) => {
  it.each(unauthorized)('refuses $kind without reading or writing anything', async ({ event }) => {
    await expect(handlers.get(channel)!(event(), ...args())).rejects.toThrow(/IPC call rejected/)
    // No app state was created on the caller's behalf.
    await expect(fs.readdir(path.join(root, '.workspace-os'))).rejects.toThrow()
    expect(await fs.readdir(root)).toEqual([])
  })
})

describe('the registered main window keeps the surface', () => {
  it('round-trips a transcript and an upload for the current owner', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    const event = source(replacement)
    const call = (channel: string, ...args: unknown[]): Promise<unknown> => handlers.get(channel)!(event, ...args)

    // Nothing saved yet.
    expect(await call(IPC.SESSIONS_LOAD)).toEqual({ root, json: null })
    // The save is only accepted for a workspace this run opened — the pre-existing control.
    expect(await call(IPC.SESSIONS_SAVE, root, '{"messages":[{"role":"user","text":"hi"}]}')).toEqual({ ok: true })
    const loaded = await call(IPC.SESSIONS_LOAD) as { json: string }
    expect(JSON.parse(loaded.json).messages).toHaveLength(1)

    const upload = await call(IPC.CHAT_UPLOAD, '../../etc/passwd', new Uint8Array([9, 9])) as { path: string; name: string }
    // The name is reduced to a bare file name and the bytes land inside the workspace.
    expect(upload.name).toBe('passwd')
    expect(upload.path.startsWith(path.join(root, '.workspace-os', 'uploads'))).toBe(true)
    expect(await fs.readFile(upload.path)).toEqual(Buffer.from([9, 9]))
  })

  it('keeps the surviving validation', async () => {
    const event = source(owner)
    // A root this run never opened is still refused, even for the owner.
    expect(await handlers.get(IPC.SESSIONS_SAVE)!(event, path.join(root, 'other'), '{}')).toEqual({ ok: false })
    await expect(handlers.get(IPC.CHAT_UPLOAD)!(event, '', new Uint8Array())).rejects.toBeInstanceOf(IpcValidationError)
    await expect(handlers.get(IPC.CHAT_UPLOAD)!(event, 'a.txt', 'not bytes')).rejects.toBeInstanceOf(IpcValidationError)
  })
})
