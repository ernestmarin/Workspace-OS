import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  engine: vi.fn(() => false),
  fallbackWindows: [] as unknown[],
}))
vi.mock('electron', () => {
  const electron = { app: { getPath: () => '/tmp' }, BrowserWindow: { getAllWindows: () => mock.fallbackWindows } }
  return { ...electron, default: electron }
})
vi.mock('../ipc-registry', () => ({
  ipcHandle: (_ipc: unknown, channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => mock.handlers.set(channel, handler),
}))
vi.mock('../office/lokEngine', () => Object.fromEntries([
  'lokAvailable', 'lokOpen', 'lokNew', 'lokTile', 'lokTiles', 'lokPartTile', 'lokClose',
  'lokKey', 'lokMouse', 'lokUno', 'lokSetBorder', 'lokCommandValues', 'lokSetSize',
  'lokRunMacro', 'lokSave', 'lokExport', 'lokExportToPath', 'lokSlidesSvg',
  'lokCurrentPath', 'lokSetPart', 'lokParts', 'withMacroLock', 'lokWindowPaint',
  'lokWindowMouse', 'lokWindowKey', 'lokDialogEvent', 'lokWindowClose', 'onLokCallback',
  'lokGetSelection', 'lokPasteBuffer', 'lokEffectsPath',
].map((name) => [name, mock.engine])))

import { registerLokHandlers } from './lok'
import { mainWindow, setMainWindow } from '../main-window'

const frame = { parent: null }
const owner = { mainFrame: frame, isDestroyed: () => false }
const win = { webContents: owner, isDestroyed: () => false }
registerLokHandlers({} as never, win as never)
const channels = [...mock.handlers.keys()]
const invoke = (channel: string, event: unknown) => Promise.resolve().then(() => mock.handlers.get(channel)!(event))

beforeEach(() => {
  setMainWindow(win as never)
  mock.engine.mockClear()
  mock.fallbackWindows = []
})

describe('LOK authorization before engine, payload or filesystem work', () => {
  it('covers exactly the 45 registered handlers including the canvas bridge', () => {
    expect(channels).toHaveLength(45)
    expect(channels).toContain('canvas:frame-to-slide')
  })
  const badEvents = [
    ['missing event', undefined],
    ['detached frame', { sender: owner, senderFrame: null }],
    ['child frame', { sender: owner, senderFrame: { parent: frame } }],
    ['foreign WebContents', { sender: { ...owner }, senderFrame: frame }],
    ['missing frame field', { sender: owner }],
    ['different top frame', { sender: owner, senderFrame: { parent: null } }],
  ] as const
  for (const channel of channels) {
    for (const [label, event] of badEvents) {
      it(`${channel}: rejects ${label}`, async () => {
        await expect(invoke(channel, event)).rejects.toThrow(/IPC call rejected/)
        expect(mock.engine).not.toHaveBeenCalled()
      })
    }
    it(`${channel}: rejects when owner window has been destroyed`, async () => {
      setMainWindow({ ...win, isDestroyed: () => true } as never)
      await expect(invoke(channel, { sender: owner, senderFrame: frame })).rejects.toThrow(/IPC call rejected/)
      expect(mock.engine).not.toHaveBeenCalled()
    })
  }
  it('allows current owner main-frame availability query', async () => {
    await expect(invoke('lok:available', { sender: owner, senderFrame: frame })).resolves.toBe(false)
    expect(mock.engine).toHaveBeenCalledTimes(1)
  })
  it('rejects destroyed owner WebContents', async () => {
    const dead = { ...owner, isDestroyed: () => true }
    setMainWindow({ ...win, webContents: dead } as never)
    await expect(invoke('lok:available', { sender: dead, senderFrame: frame })).rejects.toThrow(/IPC call rejected/)
    expect(mock.engine).not.toHaveBeenCalled()
  })
  it('uses recreated owner without re-registering handlers; rejects old owner', async () => {
    const nextFrame = { parent: null }
    const nextOwner = { ...owner, mainFrame: nextFrame }
    setMainWindow({ ...win, webContents: nextOwner } as never)
    await expect(invoke('lok:available', { sender: owner, senderFrame: frame })).rejects.toThrow(/IPC call rejected/)
    expect(mock.engine).not.toHaveBeenCalled()
    await expect(invoke('lok:available', { sender: nextOwner, senderFrame: nextFrame })).resolves.toBe(false)
    expect(mock.engine).toHaveBeenCalledTimes(1)
  })
})


describe('LOK owner cannot be granted by delivery fallback', () => {
  it('rejects fallback window after mainWindow() resolves a surviving non-owner', async () => {
    setMainWindow({ ...win, isDestroyed: () => true } as never)
    const foreignFrame = { parent: null }
    const foreign = { ...owner, mainFrame: foreignFrame }
    const foreignWin = { ...win, webContents: foreign }
    mock.fallbackWindows = [foreignWin]
    expect(mainWindow()).toBe(foreignWin)
    await expect(invoke('lok:available', { sender: foreign, senderFrame: foreignFrame })).rejects.toThrow(/IPC call rejected/)
    expect(mock.engine).not.toHaveBeenCalled()
  })
})
