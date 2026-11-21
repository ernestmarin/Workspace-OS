import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerTrashHandlers } from './trash'
import { trash } from '../trash'
import { setMainWindow } from '../main-window'
import { IPC } from '../ipc-channels'

let root: string
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => root }))
vi.mock('../host-profile', () => ({ appStateDir: (dir: string) => path.join(dir, '.workspace-os') }))
const handlers = new Map<string, (event: unknown, id?: string) => Promise<unknown>>()
beforeAll(() => registerTrashHandlers({ handle: handlers.set.bind(handlers) } as never))
function makeWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: { parent: null } } }
}
function source(win: ReturnType<typeof makeWindow>) {
  return { sender: win.webContents, senderFrame: win.webContents.mainFrame }
}
let owner: ReturnType<typeof makeWindow>
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-trash-ipc-'))
  owner = makeWindow()
  setMainWindow(owner as never)
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })
async function seed() {
  const original = path.join(root, 'sample.txt')
  await fs.writeFile(original, 'recover me')
  return trash.moveToTrash(original, 'delete', false, true)
}
describe.each([IPC.TRASH_LIST, IPC.TRASH_RESTORE, IPC.TRASH_DELETE, IPC.TRASH_EMPTY])('%s', channel => {
  it.each(['other window', 'stale frame'])('refuses %s without changing recovery data', async kind => {
    const entry = await seed()
    const event = kind === 'other window' ? source(makeWindow()) : { ...source(owner), senderFrame: { parent: null } }
    await expect(handlers.get(channel)!(event, entry.id)).rejects.toThrow(/IPC call rejected/)
    expect(await trash.list()).toEqual([entry])
    expect(await fs.readFile(entry.storedPath, 'utf8')).toBe('recover me')
    await expect(fs.stat(entry.originalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
it('allows the replacement owner to list, recover and purge temporary entries', async () => {
  const replacement = makeWindow()
  setMainWindow(replacement as never)
  const event = source(replacement)
  const entry = await seed()
  expect(await handlers.get(IPC.TRASH_LIST)!(event)).toEqual([entry])
  await handlers.get(IPC.TRASH_RESTORE)!(event, entry.id)
  expect(await fs.readFile(entry.originalPath, 'utf8')).toBe('recover me')
  await handlers.get(IPC.TRASH_DELETE)!(event, (await seed()).id)
  expect(await trash.list()).toEqual([])
  await seed()
  await handlers.get(IPC.TRASH_EMPTY)!(event)
  expect(await trash.list()).toEqual([])
})
