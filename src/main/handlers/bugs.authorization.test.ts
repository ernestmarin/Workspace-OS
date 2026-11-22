import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'

/**
 * IPC-BUG-01 — the in-app bug reporter.
 *
 * Five channels the IPC-CLASS-01 triage put in verdict A:
 *
 *   - `bug:file` **writes a report into the development repo** (`docs/BUGS.md`);
 *   - `bug:analyze` spends a **model call**;
 *   - `bug:setRepo` **re-points** the reporter at a directory (persisted in the
 *     app state dir), which decides where every later report lands;
 *   - `bug:context` and `bug:list` read repository state, the main-process error
 *     log and the live workspace context.
 *
 * The model is mocked; the bug log, the repo validation and the config file are
 * real, so a refusal has to leave both directories untouched.
 */

const state = vi.hoisted(() => ({
  userData: '',
  appPath: '',
  calls: [] as string[],
  analyzed: [] as string[],
}))

vi.mock('electron', () => ({
  app: {
    getPath: (n: string) => (n === 'userData' ? state.userData : state.userData),
    getVersion: () => '1.2.3-test',
    isPackaged: true,
    getAppPath: () => state.appPath,
  },
}))
vi.mock('../crash-reporter', () => ({
  logPath: () => {
    state.calls.push('logPath')
    return path.join(state.userData, 'main.log')
  },
}))
vi.mock('../context/workspaceContext', () => ({
  getContext: () => {
    state.calls.push('getContext')
    return { surface: 'coder', openFile: 'README.md' }
  },
}))
vi.mock('../bugs/bug-analyzer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../bugs/bug-analyzer')>()
  return {
    ...actual,
    analyzeBug: async (input: { text: string }) => {
      state.analyzed.push(input.text)
      state.calls.push('analyzeBug')
      return { analysis: null, raw: 'stub', duplicateOf: null }
    },
  }
})

const { registerBugHandlers } = await import('./bugs')

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, Handler>()

function makeWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: { parent: null }, send: vi.fn() } }
}
function source(win: ReturnType<typeof makeWindow>) {
  return { sender: win.webContents, senderFrame: win.webContents.mainFrame }
}

let owner: ReturnType<typeof makeWindow>
let repo = ''
let otherRepo = ''
let userData = ''

/** A folder that passes `isWorkspaceOsRepo`. */
async function makeRepo(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `wos-repo-${name}-`))
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'workspace-os' }), 'utf8')
  return dir
}

const configPath = (): string => path.join(userData, 'bug-reporter.json')

beforeAll(() => {
  const ipcMain = { handle: handlers.set.bind(handlers) }
  registerBugHandlers(ipcMain as never)
})

beforeEach(async () => {
  userData = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-bug-data-'))
  state.userData = userData
  state.appPath = path.join(userData, 'out', 'main')
  state.calls = []
  state.analyzed = []
  repo = await makeRepo('a')
  otherRepo = await makeRepo('b')
  await fs.mkdir(path.dirname(configPath()), { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify({ repoRoot: repo }, null, 2), 'utf8')
  owner = makeWindow()
  setMainWindow(owner as never)
})
afterEach(async () => {
  for (const d of [repo, otherRepo, userData]) await fs.rm(d, { recursive: true, force: true })
})

const unauthorized = [
  { kind: 'a missing frame', event: () => ({ sender: owner.webContents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: {} } }) },
  { kind: 'a stale top-level frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: null } }) },
  { kind: 'a foreign window', event: () => source(makeWindow()) },
]

const channels = [
  { channel: IPC.BUG_STATUS, args: () => [] },
  { channel: IPC.BUG_SETREPO, args: () => [otherRepo] },
  { channel: IPC.BUG_CONTEXT, args: () => ['coder', 'README.md'] },
  { channel: IPC.BUG_ANALYZE, args: () => ['the editor blanks when I save', 'coder', null, 'bug'] },
  { channel: IPC.BUG_FILE, args: () => ['the editor blanks when I save', null, null, 'bug'] },
  { channel: IPC.BUG_LIST, args: () => [] },
]

describe.each(channels)('$channel', ({ channel, args }) => {
  it.each(unauthorized)('refuses $kind without reading or writing the repo', async ({ event }) => {
    await expect(handlers.get(channel)!(event(), ...args())).rejects.toThrow(/IPC call rejected/)
    // No model call, no context read, no error log read.
    expect(state.calls).toEqual([])
    expect(state.analyzed).toEqual([])
    // Neither the repo nor the app state dir gained a file beyond the package.json
    // and the config the fixture wrote.
    expect((await fs.readdir(repo)).sort()).toEqual(['package.json'])
    expect(await fs.readdir(userData)).toEqual(['bug-reporter.json'])
    expect(JSON.parse(await fs.readFile(configPath(), 'utf8'))).toEqual({ repoRoot: repo })
  })
})

describe('the registered main window keeps the reporter', () => {
  it('reads status, context and the list; re-points the repo; analyzes and files', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    const event = source(replacement)
    const call = (channel: string, ...args: unknown[]): Promise<unknown> => handlers.get(channel)!(event, ...args)

    expect(await call(IPC.BUG_STATUS)).toMatchObject({ repoRoot: repo, count: 0 })
    expect(await call(IPC.BUG_CONTEXT, 'coder', 'README.md')).toMatchObject({ surface: 'coder' })
    expect(await call(IPC.BUG_LIST)).toEqual([])

    await call(IPC.BUG_ANALYZE, 'the editor blanks when I save', 'coder', null, 'bug')
    expect(state.analyzed).toEqual(['the editor blanks when I save'])

    const filed = (await call(IPC.BUG_FILE, 'the editor blanks when I save', null, null, 'bug')) as { ok: boolean; id: string }
    expect(filed.ok).toBe(true)
    expect(await fs.readFile(path.join(repo, 'docs', 'BUGS.md'), 'utf8')).toContain(filed.id)

    await call(IPC.BUG_SETREPO, otherRepo)
    expect(JSON.parse(await fs.readFile(configPath(), 'utf8'))).toEqual({ repoRoot: otherRepo })
  })

  it('still refuses a folder that is not this repository', async () => {
    const event = source(owner)
    const notRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-notrepo-'))
    try {
      await expect(handlers.get(IPC.BUG_SETREPO)!(event, notRepo)).rejects.toThrow(/not the Workspace-OS repository/)
      await expect(handlers.get(IPC.BUG_FILE)!(event, '   ', null, null, 'bug')).rejects.toThrow(/non-empty string/)
      expect(JSON.parse(await fs.readFile(configPath(), 'utf8'))).toEqual({ repoRoot: repo })
    } finally {
      await fs.rm(notRepo, { recursive: true, force: true })
    }
  })
})
