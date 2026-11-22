import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { IPC } from '../ipc-channels'
import { setMainWindow } from '../main-window'

/**
 * IPC-BROWSER-02 — the nineteen remaining `browser:*` channels.
 *
 * These let the in-app agent drive the user's visible guest browser: navigate,
 * screenshot into the workspace, click, type into inputs, scroll, wait, read the
 * page (`current`/`extract`/`map`/`deep-read` — page content and page links),
 * dismiss cookie banners, and list downloads. `browser:clear-cache` was guarded
 * with its module in IPC-HIST-01.
 *
 * The guest is a recording fake captured through the real registry seam, so a
 * refusal must leave the recorder empty: no script executed, no capture, no
 * navigation, not even an `isDestroyed()` probe.
 */

const state = vi.hoisted(() => ({
  userData: '',
  root: '',
  calls: [] as string[],
  registered: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
}))

vi.mock('electron', () => ({
  app: { getPath: (n: string) => (n === 'userData' ? state.userData : state.root) },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      state.registered.set(channel, fn)
    },
  },
  session: { fromPartition: () => ({ on: () => {} }) },
  webContents: { fromId: () => null },
}))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => state.root || null }))
vi.mock('../security', () => ({ BROWSER_PARTITION: 'persist:wos-browser' }))

const { registerBrowserHandlers } = await import('../browser/browserControl')
const { registerDownloads } = await import('../browser/downloads')
const { captureBrowserGuest, resetBrowserGuest } = await import('../browser/guestRegistry')

const handlers = state.registered

/** A guest that records every member access and call. */
function makeGuest(id = 7) {
  const target: Record<string | symbol, unknown> = {
    id,
    isDestroyed: () => false,
    once: () => target,
    on: () => target,
    getURL: () => 'https://example.com/page',
    getTitle: () => 'Example',
    loadURL: async (url: string) => {
      state.calls.push(`loadURL:${url}`)
    },
    executeJavaScript: async (script: string) => {
      state.calls.push(`executeJavaScript:${String(script).slice(0, 20)}`)
      return { found: true, typed: true, tag: 'input', data: [] }
    },
    capturePage: async () => {
      state.calls.push('capturePage')
      return { toPNG: () => Buffer.from('png'), toJPEG: () => Buffer.from('jpeg') }
    },
    navigationHistory: {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: () => state.calls.push('goBack'),
      goForward: () => state.calls.push('goForward'),
    },
    setZoomFactor: () => {},
    zoomFactor: 1,
  }
  return new Proxy(target, {
    get(obj, prop) {
      const v = obj[prop]
      if (typeof v !== 'function') return v
      return (...args: unknown[]) => {
        state.calls.push(`${String(prop)}()`)
        return (v as (...a: unknown[]) => unknown)(...args)
      }
    },
  })
}

function makeWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: { parent: null }, send: vi.fn() } }
}
function source(win: ReturnType<typeof makeWindow>) {
  return { sender: win.webContents, senderFrame: win.webContents.mainFrame }
}

let owner: ReturnType<typeof makeWindow>

beforeAll(() => {
  registerBrowserHandlers({ handle: (channel: string, fn: never) => state.registered.set(channel, fn) } as never)
  registerDownloads(() => null)
})

beforeEach(async () => {
  state.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-br-data-'))
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-br-root-'))
  state.calls = []
  owner = makeWindow()
  setMainWindow(owner as never)
})
afterEach(async () => {
  resetBrowserGuest()
  for (const d of [state.userData, state.root]) await fs.rm(d, { recursive: true, force: true })
})

const unauthorized = [
  { kind: 'a missing frame', event: () => ({ sender: owner.webContents, senderFrame: null }) },
  { kind: 'a child frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: {} } }) },
  { kind: 'a stale top-level frame', event: () => ({ sender: owner.webContents, senderFrame: { parent: null } }) },
  { kind: 'a foreign window', event: () => source(makeWindow()) },
]

const channels = [
  { channel: IPC.BROWSER_NAVIGATE, args: () => [{ url: 'https://example.com/accounts' }] },
  { channel: IPC.BROWSER_SCREENSHOT, args: () => [{ destPath: 'login.png' }] },
  { channel: IPC.BROWSER_THUMBNAIL, args: () => [{ width: 320 }] },
  { channel: IPC.BROWSER_EXTRACT, args: () => [{ mode: 'tables' }] },
  { channel: IPC.BROWSER_MAP, args: () => [{}] },
  { channel: IPC.BROWSER_CURRENT, args: () => [{}] },
  { channel: IPC.BROWSER_DISMISS_COOKIES, args: () => [{}] },
  { channel: IPC.BROWSER_CLEAR_CONSENT, args: () => [{}] },
  { channel: IPC.BROWSER_DEEP_READ, args: () => [{ url: 'https://example.com', maxPages: 2 }] },
  { channel: IPC.BROWSER_CLICK, args: () => [{ text: 'Buy' }] },
  { channel: IPC.BROWSER_SCROLL, args: () => [{ by: 300 }] },
  { channel: IPC.BROWSER_WAIT_FOR, args: () => [{ selector: '#done' }] },
  { channel: IPC.BROWSER_BACK, args: () => [{}] },
  { channel: IPC.BROWSER_FORWARD, args: () => [{}] },
  { channel: IPC.BROWSER_TYPE, args: () => [{ selector: '#q', text: 'hello' }] },
  { channel: IPC.BROWSER_SET_ACTIVE_GUEST, args: () => [{ id: 7 }] },
  { channel: IPC.BROWSER_REGISTER_TAB, args: () => [{ tabId: 'tab-1', webContentsId: 7 }] },
  { channel: IPC.BROWSER_UNREGISTER_TAB, args: () => [{ tabId: 'tab-1' }] },
  { channel: IPC.BROWSER_DOWNLOADS, args: () => [] },
]

describe.each(channels)('$channel', ({ channel, args }) => {
  it.each(unauthorized)('refuses $kind without touching the guest browser', async ({ event }) => {
    const guest = makeGuest()
    captureBrowserGuest(guest as never)
    state.calls = [] // capture itself registers a `destroyed` listener; that is the fixture, not the handler
    await expect(handlers.get(channel)!(event(), ...args())).rejects.toThrow(/IPC call rejected/)
    // Not even `isDestroyed()`: the registry was never consulted.
    expect(state.calls).toEqual([])
    expect(await fs.readdir(state.root)).toEqual([])
    expect(await fs.readdir(state.userData)).toEqual([])
  })
})

describe('the registered main window keeps the browser surface', () => {
  it('reaches the guest for the read and interact channels', async () => {
    const guest = makeGuest()
    captureBrowserGuest(guest as never)
    const replacement = makeWindow()
    setMainWindow(replacement as never)
    const event = source(replacement)
    const call = (channel: string, ...args: unknown[]): Promise<unknown> => handlers.get(channel)!(event, ...args)

    expect(await call(IPC.BROWSER_SET_ACTIVE_GUEST, { id: 7 })).toEqual({ ok: true, active: 7 })
    expect(await call(IPC.BROWSER_REGISTER_TAB, { tabId: 'tab-1', webContentsId: 7 })).toEqual({ ok: true, tab: 'tab-1' })
    expect(await call(IPC.BROWSER_CURRENT, { tab: 'tab-1' })).toMatchObject({ ok: true, url: 'https://example.com/page' })
    expect(await call(IPC.BROWSER_MAP, { tab: 'tab-1' })).toMatchObject({ ok: true })
    expect(await call(IPC.BROWSER_TYPE, { selector: '#q', text: 'hello' })).toMatchObject({ ok: true, typed: true })
    expect(await call(IPC.BROWSER_WAIT_FOR, { selector: '#done' })).toMatchObject({ ok: true, found: true })
    expect(await call(IPC.BROWSER_CLICK, { text: 'Buy' })).toMatchObject({ ok: true })
    expect(await call(IPC.BROWSER_SCROLL, { by: 300 })).toMatchObject({ ok: true })
    expect(await call(IPC.BROWSER_DISMISS_COOKIES, {})).toMatchObject({ ok: true })
    expect(await call(IPC.BROWSER_CLEAR_CONSENT, {})).toMatchObject({ ok: true })
    expect(await call(IPC.BROWSER_BACK, {})).toMatchObject({ ok: true })
    expect(await call(IPC.BROWSER_FORWARD, {})).toMatchObject({ ok: true })
    expect(await call(IPC.BROWSER_EXTRACT, { mode: 'tables' })).toMatchObject({ ok: true })
    expect(await call(IPC.BROWSER_UNREGISTER_TAB, { tabId: 'tab-1' })).toEqual({ ok: true })
    expect(await call(IPC.BROWSER_DOWNLOADS)).toEqual([])

    expect(state.calls.some((c) => c.startsWith('executeJavaScript:'))).toBe(true)
    expect(state.calls).toContain('getURL()')
  })

  it('still refuses to drive a tab nobody registered', async () => {
    const event = source(owner)
    await expect(handlers.get(IPC.BROWSER_CURRENT)!(event, { tab: 'missing' })).rejects.toThrow(/no live browser tab/)
    await expect(handlers.get(IPC.BROWSER_CURRENT)!(event, {})).rejects.toThrow(/Browser surface is not open/)
    // With a guest present, the surviving validation still runs — and still
    // refuses before any script is executed.
    captureBrowserGuest(makeGuest() as never)
    state.calls = []
    await expect(handlers.get(IPC.BROWSER_WAIT_FOR)!(event, {})).rejects.toThrow(/needs a selector or text/)
    await expect(handlers.get(IPC.BROWSER_TYPE)!(event, { text: 'hi' })).rejects.toThrow(/needs a selector/)
    await expect(handlers.get(IPC.BROWSER_NAVIGATE)!(event, { url: 'file:///etc/passwd' })).rejects.toThrow()
    expect(state.calls.filter((c) => c.startsWith('executeJavaScript'))).toEqual([])
  })
})
