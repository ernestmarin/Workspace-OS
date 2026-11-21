import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'
import { registerSystemHandlers } from './system'

const clipboard = vi.hoisted(() => ({ readText: vi.fn(() => 'sample'), writeText: vi.fn() }))
vi.mock('electron', () => ({ clipboard }))
vi.mock('../office/lokEngine', () => ({ lokAvailable: vi.fn() }))
vi.mock('../docgen', () => ({ docgenVenvPython: vi.fn() }))

function makeWindow() {
  return { isDestroyed: vi.fn(() => false), webContents: { isDestroyed: vi.fn(() => false), mainFrame: { parent: null } } }
}
function source(win: ReturnType<typeof makeWindow>) {
  return { sender: win.webContents, senderFrame: win.webContents.mainFrame }
}
const handlers = new Map<string, (event: unknown, text?: unknown) => Promise<unknown>>()
beforeAll(() => registerSystemHandlers({ handle: handlers.set.bind(handlers) } as never))
let owner: ReturnType<typeof makeWindow>
beforeEach(() => {
  vi.clearAllMocks()
  owner = makeWindow()
  setMainWindow(owner as never)
})

describe.each([IPC.CLIPBOARD_READ, IPC.CLIPBOARD_WRITE])('%s', channel => {
  it.each(['missing event', 'null frame', 'child', 'stale frame', 'other window', 'closed', 'destroyed contents', 'replaced'])('refuses %s before clipboard access', async scenario => {
    let event: unknown = source(owner)
    switch (scenario) {
      case 'missing event': event = undefined; break
      case 'null frame': event = { ...source(owner), senderFrame: null }; break
      case 'child': event = { ...source(owner), senderFrame: { parent: owner.webContents.mainFrame } }; break
      case 'stale frame': event = { ...source(owner), senderFrame: { parent: null } }; break
      case 'other window': event = source(makeWindow()); break
      case 'closed': owner.isDestroyed.mockReturnValue(true); break
      case 'destroyed contents': owner.webContents.isDestroyed.mockReturnValue(true); break
      case 'replaced': setMainWindow(makeWindow() as never); break
    }
    await expect(handlers.get(channel)!(event, 'sample')).rejects.toThrow(/IPC call rejected/)
    expect(clipboard.readText).not.toHaveBeenCalled()
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })
})
it('preserves paste, copy, empty text and refusal of non-text for the replacement owner', async () => {
  const replacement = makeWindow()
  setMainWindow(replacement as never)
  const event = source(replacement)
  expect(await handlers.get(IPC.CLIPBOARD_READ)!(event)).toBe('sample')
  expect(clipboard.readText).toHaveBeenCalledTimes(1)
  const write = handlers.get(IPC.CLIPBOARD_WRITE)!
  expect(await write(event, 'café')).toBe(true)
  expect(await write(event, '')).toBe(true)
  expect(await write(event, 42)).toBe(false)
  expect(clipboard.writeText.mock.calls).toEqual([['café'], ['']])
})
it('checks authority before rejecting a non-text payload', async () => {
  await expect(handlers.get(IPC.CLIPBOARD_WRITE)!(source(makeWindow()), 42)).rejects.toThrow(/IPC call rejected/)
  expect(clipboard.writeText).not.toHaveBeenCalled()
})
