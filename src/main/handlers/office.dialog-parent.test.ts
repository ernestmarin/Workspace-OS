import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'

/**
 * OFFICE-02 — `office:export-pdf` parented its save dialog to the window that
 * registered the handlers, captured at startup. After a window replacement the
 * dialog would be parented to a destroyed window and Electron would throw
 * instead of showing the picker. Same lifecycle bug as WATCH-02, same fix shape.
 *
 * LibreOffice is mocked (it is not installed here and not what this asks); the
 * guard, path validation and the dialog argument are the real ones.
 */

const state = vi.hoisted(() => ({ root: '', userData: '', tmp: '', calls: [] as unknown[][] }))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'temp' ? state.tmp : state.userData) },
  dialog: {
    showSaveDialog: vi.fn(async (...args: unknown[]) => {
      state.calls.push(args)
      return { canceled: true }
    }),
  },
  shell: { openPath: vi.fn(async () => '') },
}))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => state.root || null }))
vi.mock('../office/libreoffice', () => ({
  resolveSoffice: () => '/usr/bin/soffice',
  isLibreOfficeAvailable: () => true,
  convertTo: async (src: string) => {
    const out = path.join(state.tmp, `${path.basename(src, path.extname(src))}.pdf`)
    await fs.writeFile(out, '%PDF-1.4 fake')
    return out
  },
  discardConverted: async (produced: string) => {
    await fs.rm(produced, { force: true })
  },
}))
vi.mock('../office/pptx-from-images', () => ({ buildPptxFromImages: vi.fn() }))
vi.mock('../host-profile', () => ({ appStateDir: (dir: string) => path.join(dir, '.workspace-os') }))

const { registerOfficeHandlers } = await import('./office')

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, Handler>()

const makeWindow = (): Record<string, unknown> => ({
  isDestroyed: () => false,
  webContents: { isDestroyed: () => false, mainFrame: { parent: null }, send: vi.fn() },
})
const source = (win: ReturnType<typeof makeWindow>) => ({
  sender: (win.webContents as { mainFrame: unknown }),
  senderFrame: (win.webContents as { mainFrame: unknown }).mainFrame,
})

let registrationWindow: ReturnType<typeof makeWindow>
let liveWindow: ReturnType<typeof makeWindow>

beforeAll(() => {
  registrationWindow = makeWindow()
  registerOfficeHandlers(
    { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) } as never,
    registrationWindow as never,
  )
})

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-office-dialog-'))
  state.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-office-udata-'))
  state.tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-office-tmp-'))
  state.calls.length = 0
  liveWindow = makeWindow()
  setMainWindow(liveWindow as never)
})
afterEach(async () => {
  for (const dir of [state.root, state.userData, state.tmp]) await fs.rm(dir, { recursive: true, force: true })
})

describe('office:export-pdf parents its save dialog to the live window', () => {
  it('uses the current window, not the one that registered the handlers', async () => {
    const doc = path.join(state.root, 'memo.docx')
    await fs.writeFile(doc, 'fake docx bytes')

    const result = await handlers.get(IPC.OFFICE_EXPORT_PDF)!(source(liveWindow), doc)

    expect(result).toBeNull() // the mocked dialog was cancelled
    expect(state.calls).toHaveLength(1)
    expect(state.calls[0][0]).toBe(liveWindow)
    expect(state.calls[0][0]).not.toBe(registrationWindow)
  })

  it('leaves the converted PDF out of the temp folder afterwards', async () => {
    const doc = path.join(state.root, 'memo.docx')
    await fs.writeFile(doc, 'fake docx bytes')
    await handlers.get(IPC.OFFICE_EXPORT_PDF)!(source(liveWindow), doc)
    expect(await fs.readdir(state.tmp)).toEqual([])
  })
})
