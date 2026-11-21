import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'
import { IpcValidationError } from '../ipc-validator'

/**
 * IPC-OFFICE-01 — the five handlers that shell out to LibreOffice and write
 * files (four in `office.ts`, plus `canvas:export-pptx`) never looked at the
 * event.
 *
 * These are the highest-consequence channels left on the path-only list: they
 * spawn an external program on a workspace file, hand a converted PDF to the OS
 * default viewer (`shell.openPath`), write to a user-chosen destination outside
 * the workspace, and build a deck on disk. Input validation confined the *path*;
 * it said nothing about *who* asks.
 *
 * LibreOffice and the pptx builder are mocked (external programs / heavy
 * binary generation); the guard, the validation, the cache and the atomic write
 * are the real implementations.
 */

const state = vi.hoisted(() => ({ root: '', userData: '', tmp: '', savePath: '' as string | null, calls: [] as string[] }))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'temp' ? state.tmp : state.userData) },
  dialog: {
    showSaveDialog: vi.fn(async () => {
      state.calls.push('showSaveDialog')
      return state.savePath ? { canceled: false, filePath: state.savePath } : { canceled: true }
    }),
  },
  shell: {
    openPath: vi.fn(async () => {
      state.calls.push('openPath')
      return ''
    }),
  },
}))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => state.root || null }))
vi.mock('../office/libreoffice', () => ({
  resolveSoffice: () => '/usr/bin/soffice',
  isLibreOfficeAvailable: () => true,
  convertTo: async (src: string) => {
    state.calls.push(`convertTo:${path.basename(src)}`)
    const out = path.join(state.tmp, `${path.basename(src, path.extname(src))}.pdf`)
    await fs.writeFile(out, '%PDF-1.4 fake')
    return out
  },
  discardConverted: async (produced: string) => {
    state.calls.push(`discard:${path.basename(produced)}`)
    await fs.rm(produced, { force: true })
  },
}))
vi.mock('../office/pptx-from-images', () => ({
  buildPptxFromImages: async (images: unknown[]) => {
    state.calls.push(`buildPptx:${images.length}`)
    return Buffer.from('PK-fake-pptx')
  },
}))

const { registerOfficeHandlers } = await import('./office')
const { registerCanvasHandlers } = await import('./canvas')

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
let registrationWindow: ReturnType<typeof makeWindow>

beforeAll(() => {
  registrationWindow = makeWindow()
  const ipcMain = { handle: handlers.set.bind(handlers) }
  registerOfficeHandlers(ipcMain as never, registrationWindow as never)
  registerCanvasHandlers(ipcMain as never)
})

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-office-ipc-'))
  state.root = root
  state.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-office-data-'))
  state.tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-office-tmp-'))
  state.savePath = path.join(state.tmp, 'exported.pdf')
  state.calls = []
  await fs.writeFile(path.join(root, 'report.docx'), 'fake docx')
  owner = makeWindow()
  setMainWindow(owner as never)
})
afterEach(async () => {
  for (const dir of [root, state.userData, state.tmp]) await fs.rm(dir, { recursive: true, force: true })
})

const unauthorized = [
  { kind: 'a missing frame', event: () => ({ sender: owner.webContents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: {} } }) },
  { kind: 'a stale top-level frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: null } }) },
  { kind: 'a foreign window', event: () => source(makeWindow()) },
]

const pptxPayload = () => ({
  targetPath: path.join(root, 'deck.pptx'),
  images: [{ png: new Uint8Array([1, 2, 3]), title: 'Slide 1' }],
})

const channels: Array<{ channel: string; args: () => unknown[]; file?: () => string }> = [
  { channel: IPC.OFFICE_AVAILABLE, args: () => [] },
  { channel: IPC.OFFICE_PRINT, args: () => [path.join(root, 'report.docx')] },
  { channel: IPC.OFFICE_TO_PDF, args: () => [path.join(root, 'report.docx')] },
  { channel: IPC.OFFICE_EXPORT_PDF, args: () => [path.join(root, 'report.docx')] },
  { channel: IPC.CANVAS_EXPORT_PPTX, args: () => [pptxPayload()], file: () => path.join(root, 'deck.pptx') },
]

describe.each(channels)('$channel', ({ channel, args, file }) => {
  it.each(unauthorized)('refuses $kind without converting, saving or opening anything', async ({ event }) => {
    await expect(handlers.get(channel)!(event(), ...args())).rejects.toThrow(/IPC call rejected/)
    expect(state.calls).toEqual([])
    // No render cache was created, no export landed, no deck was written.
    expect(await fs.readdir(state.userData)).toEqual([])
    if (file) await expect(fs.access(file())).rejects.toThrow()
  })
})

describe('the registered main window keeps the surface', () => {
  it('answers every channel for the current owner', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    const event = source(replacement)
    const call = (channel: string, ...args: unknown[]): Promise<unknown> => handlers.get(channel)!(event, ...args)

    expect(await call(IPC.OFFICE_AVAILABLE)).toBe(true)

    const pdf = await call(IPC.OFFICE_TO_PDF, path.join(root, 'report.docx')) as Uint8Array
    expect(Buffer.from(pdf).toString()).toBe('%PDF-1.4 fake')
    expect(state.calls.filter((c) => c.startsWith('convertTo:'))).toEqual(['convertTo:report.docx'])

    // Second call is served from the cache — no second conversion.
    await call(IPC.OFFICE_TO_PDF, path.join(root, 'report.docx'))
    expect(state.calls.filter((c) => c.startsWith('convertTo:'))).toHaveLength(1)

    await call(IPC.OFFICE_PRINT, path.join(root, 'report.docx'))
    expect(state.calls).toContain('openPath')

    expect(await call(IPC.OFFICE_EXPORT_PDF, path.join(root, 'report.docx'))).toBe(state.savePath)
    expect(state.calls).toContain('showSaveDialog')
    await expect(fs.access(state.savePath!)).resolves.toBeUndefined()

    const deck = await call(IPC.CANVAS_EXPORT_PPTX, pptxPayload()) as { ok: boolean; slides: number }
    expect(deck).toMatchObject({ ok: true, slides: 1 })
    await expect(fs.readFile(path.join(root, 'deck.pptx'), 'utf8')).resolves.toBe('PK-fake-pptx')
    // The atomic temp file is gone.
    expect((await fs.readdir(root)).filter((f) => f.includes('.wos-'))).toEqual([])
  })

  it('still refuses a cancelled save without writing anything', async () => {
    state.savePath = null
    await expect(
      handlers.get(IPC.OFFICE_EXPORT_PDF)!(source(owner), path.join(root, 'report.docx')),
    ).resolves.toBeNull()
  })

  it('keeps the surviving path and payload validation', async () => {
    const event = source(owner)
    await expect(handlers.get(IPC.OFFICE_TO_PDF)!(event, '/etc/passwd')).rejects.toBeInstanceOf(IpcValidationError)
    await expect(handlers.get(IPC.OFFICE_PRINT)!(event, '../outside.docx')).rejects.toBeInstanceOf(IpcValidationError)
    await expect(handlers.get(IPC.OFFICE_EXPORT_PDF)!(event, '/etc/hosts')).rejects.toBeInstanceOf(IpcValidationError)
    // Canvas: extension, payload shape and the workspace boundary survive.
    await expect(
      handlers.get(IPC.CANVAS_EXPORT_PPTX)!(event, { targetPath: path.join(root, 'deck.pptx') }),
    ).rejects.toBeInstanceOf(IpcValidationError)
    await expect(
      handlers.get(IPC.CANVAS_EXPORT_PPTX)!(event, { targetPath: path.join(root, 'deck.png'), images: [] }),
    ).rejects.toThrow(/pptx/)
    await expect(
      handlers.get(IPC.CANVAS_EXPORT_PPTX)!(event, { targetPath: '/etc/deck.pptx', images: [] }),
    ).rejects.toBeInstanceOf(IpcValidationError)
    await expect(
      handlers.get(IPC.CANVAS_EXPORT_PPTX)!(event, { targetPath: path.join(root, 'deck.pptx'), images: [{ png: 'not bytes' }] }),
    ).rejects.toThrow(/PNG bytes/)
  })
})
