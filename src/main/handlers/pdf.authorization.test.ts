import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'
import { IpcValidationError } from '../ipc-validator'

/**
 * IPC-PDF-01 — the PDF editing surface never looked at the event.
 *
 * Nine channels that read a user's documents, **rewrite them in place** (page
 * reorder, rotate, form fill, signature stamp), keep a sidecar of markup, and
 * hand a temporary copy to `shell.openPath`. Every path is validated against the
 * workspace root — behind `resolveInWorkspace()`, which is why the inventory's
 * snippet heuristic classified all nine as needing no caller check.
 *
 * pdf-lib and the trash layer are mocked (external boundary); the guard, the
 * path validation in `resolveInWorkspace`, the sidecar layout and the export
 * naming are the real implementations.
 */

const state = vi.hoisted(() => ({
  root: '',
  tmp: '',
  calls: [] as string[],
  trashed: [] as string[],
}))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'temp' ? state.tmp : state.root) },
  shell: {
    openPath: vi.fn(async (target: string) => {
      state.calls.push(`openPath:${path.basename(target)}`)
      return ''
    }),
  },
}))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => state.root || null }))
vi.mock('../host-profile', () => ({
  appStateDir: (root: string) => path.join(root, '.workspace-os'),
  contentRel: (_root: string, name: string) => name,
}))
vi.mock('../trash', () => ({
  trash: {
    moveToTrash: async (p: string) => {
      state.trashed.push(p)
      state.calls.push(`trash:${path.basename(p)}`)
    },
  },
}))
vi.mock('../pdf/annotation-writer', () => ({
  writeAnnotations: async (bytes: Uint8Array) => {
    state.calls.push('writeAnnotations')
    return new Uint8Array([...bytes, 0x25])
  },
  reorderPages: async () => {
    state.calls.push('reorderPages')
    return new Uint8Array([0x25])
  },
  rotatePage: async () => {
    state.calls.push('rotatePage')
    return new Uint8Array([0x25])
  },
  readFormFields: async () => {
    state.calls.push('readFormFields')
    return [{ name: 'signature' }]
  },
  fillFormFields: async () => {
    state.calls.push('fillFormFields')
    return new Uint8Array([0x25])
  },
  stampImage: async () => {
    state.calls.push('stampImage')
    return new Uint8Array([0x25])
  },
}))

const { registerPdfHandlers } = await import('./pdf')

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
let pdf = ''

beforeAll(() => registerPdfHandlers({ handle: handlers.set.bind(handlers) } as never))

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-pdf-ipc-'))
  state.root = root
  state.tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-pdf-tmp-'))
  state.calls = []
  state.trashed = []
  pdf = path.join(root, 'contract.pdf')
  await fs.writeFile(pdf, '%PDF-1.4 original')
  owner = makeWindow()
  setMainWindow(owner as never)
})
afterEach(async () => {
  for (const dir of [root, state.tmp]) await fs.rm(dir, { recursive: true, force: true })
})

const unauthorized = [
  { kind: 'a missing frame', event: () => ({ sender: owner.webContents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: {} } }) },
  { kind: 'a stale top-level frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: null } }) },
  { kind: 'a foreign window', event: () => source(makeWindow()) },
]

const marks = [{ page: 0, kind: 'highlight', x: 1, y: 2, w: 3, h: 4 }]
const annotate = { version: 1, annotations: marks }

const channels = [
  { channel: IPC.PDF_PRINT, args: () => [pdf, []] },
  { channel: IPC.PDF_ANNOTATIONS_READ, args: () => [pdf] },
  { channel: IPC.PDF_ANNOTATIONS_WRITE, args: () => [pdf, annotate] },
  { channel: IPC.PDF_EXPORT, args: () => [pdf, marks, false] },
  { channel: IPC.PDF_PAGES_REORDER, args: () => [pdf, [0]] },
  { channel: IPC.PDF_PAGES_ROTATE, args: () => [pdf, 0, 90] },
  { channel: IPC.PDF_FORM_READ, args: () => [pdf] },
  { channel: IPC.PDF_FORM_FILL, args: () => [pdf, { field: 'value' }] },
  { channel: IPC.PDF_SIGN, args: () => [pdf, 'data:image/png;base64,AAAA', 0, { x: 1, y: 1, w: 1, h: 1 }] },
]

describe.each(channels)('$channel', ({ channel, args }) => {
  it.each(unauthorized)('refuses $kind without touching the document', async ({ event }) => {
    const before = await fs.readFile(pdf, 'utf8')
    await expect(handlers.get(channel)!(event(), ...args())).rejects.toThrow(/IPC call rejected/)
    expect(state.calls).toEqual([])
    expect(state.trashed).toEqual([])
    expect(await fs.readFile(pdf, 'utf8')).toBe(before)
    // No sidecar, no annotated copy, nothing new in the workspace.
    expect(await fs.readdir(root)).toEqual(['contract.pdf'])
  })
})

describe('the registered main window keeps the surface', () => {
  it('answers every channel for the current owner', async () => {
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    const event = source(replacement)
    const call = (channel: string, ...args: unknown[]): Promise<unknown> => handlers.get(channel)!(event, ...args)

    // Sidecar round trip (empty until written).
    expect(await call(IPC.PDF_ANNOTATIONS_READ, pdf)).toEqual({ version: 1, file: 'contract.pdf', annotations: [] })
    expect(await call(IPC.PDF_ANNOTATIONS_WRITE, pdf, annotate)).toEqual({ ok: true })
    const sidecar = path.join(root, '.workspace-os', 'annotations', 'contract.pdf.json')
    expect(JSON.parse(await fs.readFile(sidecar, 'utf8'))).toEqual(annotate)

    // Export writes a NEW file and leaves the original alone.
    const exported = await call(IPC.PDF_EXPORT, pdf, marks, false) as { ok: boolean; path: string }
    expect(exported.path).toBe(path.join(root, 'contract (annotated).pdf'))
    expect(await fs.readFile(pdf, 'utf8')).toBe('%PDF-1.4 original')

    // In-place export trashes the previous version first (undo path).
    expect(await call(IPC.PDF_EXPORT, pdf, marks, true)).toMatchObject({ ok: true, path: pdf })
    expect(state.trashed).toEqual([pdf])

    // Destructive page ops go through the same trash-then-write path.
    expect(await call(IPC.PDF_PAGES_REORDER, pdf, [0])).toEqual({ ok: true })
    expect(await call(IPC.PDF_PAGES_ROTATE, pdf, 0, 90)).toEqual({ ok: true })
    expect(state.trashed).toEqual([pdf, pdf, pdf])

    // Forms and signature.
    expect(await call(IPC.PDF_FORM_READ, pdf)).toEqual([{ name: 'signature' }])
    expect(await call(IPC.PDF_FORM_FILL, pdf, { field: 'value' })).toEqual({ ok: true })
    expect(await call(IPC.PDF_SIGN, pdf, 'AAAA', 0, { x: 1, y: 1, w: 1, h: 1 })).toEqual({ ok: true })

    // Print hands the complete PDF to the system viewer.
    await call(IPC.PDF_PRINT, pdf, [])
    expect(state.calls).toContain('openPath:contract.pdf')
  })

  it('keeps the surviving path and payload validation', async () => {
    const event = source(owner)
    await expect(handlers.get(IPC.PDF_PRINT)!(event, '/etc/passwd', [])).rejects.toBeInstanceOf(IpcValidationError)
    await expect(handlers.get(IPC.PDF_EXPORT)!(event, '../outside.pdf', [], false)).rejects.toBeInstanceOf(IpcValidationError)
    await expect(handlers.get(IPC.PDF_ANNOTATIONS_READ)!(event, 42)).rejects.toBeInstanceOf(IpcValidationError)
    // A non-PDF target is refused for print; the page-order shape too.
    const txt = path.join(root, 'notes.txt')
    await fs.writeFile(txt, 'x')
    await expect(handlers.get(IPC.PDF_PRINT)!(event, txt, [])).rejects.toThrow(/PDF/)
    await expect(handlers.get(IPC.PDF_PAGES_REORDER)!(event, pdf, 'nope')).rejects.toThrow(/page order/)
    await expect(handlers.get(IPC.PDF_SIGN)!(event, pdf, 12, 0, { x: 1, y: 1, w: 1, h: 1 })).rejects.toThrow(/signature/)
    expect(state.trashed).toEqual([])
  })
})
