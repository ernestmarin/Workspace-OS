import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

const state = vi.hoisted(() => ({
  appPath: '/opt/Workspace OS/resources/app.asar',
  isPackaged: false,
  openExternal: vi.fn(async (_url: string) => {}),
  captureBrowserGuest: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: () => state.appPath,
    get isPackaged() {
      return state.isPackaged
    },
    getPreferredSystemLanguages: () => ['en-US'],
  },
  BrowserWindow: {
    fromWebContents: () => null,
  },
  session: {
    defaultSession: {},
    fromPartition: () => ({}),
  },
  shell: {
    openExternal: (url: string) => state.openExternal(url),
  },
}))

vi.mock('./browser/browserControl', () => ({
  captureBrowserGuest: (g: unknown) => state.captureBrowserGuest(g),
}))

import { assertMainFrame, hardenWebContents } from './security'

describe('security.ts boundary hardening (SEC-02 & SEC-03)', () => {
  beforeEach(() => {
    state.isPackaged = false
    state.openExternal.mockClear()
    state.captureBrowserGuest.mockClear()
  })

  it('assertMainFrame fails closed when senderFrame is explicitly null on a detached Electron event', () => {
    expect(() => assertMainFrame({ senderFrame: null } as never)).toThrow(/non-main frame|detached/i)
  })

  it('assertMainFrame rejects subframe senders and allows main-frame senders', () => {
    expect(() => assertMainFrame({ senderFrame: { parent: {} } } as never)).toThrow(/non-main frame/i)
    expect(() => assertMainFrame({ senderFrame: { parent: null } } as never)).not.toThrow()
    expect(() => assertMainFrame({} as never)).not.toThrow()
  })

  it('will-navigate blocks dev-origin prefix spoofing (http://localhost:51730) and out-of-bundle file:// URLs', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const fakeContents = {
      on: (ev: string, fn: (...args: unknown[]) => void) => {
        listeners.set(ev, fn)
      },
      setWindowOpenHandler: () => {},
    }

    hardenWebContents(fakeContents as never)
    const navHandler = listeners.get('will-navigate')!

    // Dev mode: exact origin match required
    state.isPackaged = false
    let prevented = false
    navHandler({ preventDefault: () => { prevented = true } }, 'http://localhost:51730/evil')
    expect(prevented).toBe(true)

    prevented = false
    navHandler({ preventDefault: () => { prevented = true } }, 'http://localhost:5173/index.html')
    expect(prevented).toBe(false)

    // Packaged mode: only files inside the app bundle root are allowed; localhost dev URL is blocked
    state.isPackaged = true
    prevented = false
    navHandler({ preventDefault: () => { prevented = true } }, 'http://localhost:5173/index.html')
    expect(prevented).toBe(true)

    prevented = false
    navHandler({ preventDefault: () => { prevented = true } }, 'file:///etc/passwd')
    expect(prevented).toBe(true)

    const bundleIndex = `file://${path.posix.join(state.appPath, 'out/renderer/index.html')}`
    prevented = false
    navHandler({ preventDefault: () => { prevented = true } }, bundleIndex)
    expect(prevented).toBe(false)
  })

  it('did-attach-webview blocks file:// and javascript: navigations on guest webContents', () => {
    const hostListeners = new Map<string, (...args: unknown[]) => void>()
    const fakeContents = {
      on: (ev: string, fn: (...args: unknown[]) => void) => {
        hostListeners.set(ev, fn)
      },
      setWindowOpenHandler: () => {},
    }
    hardenWebContents(fakeContents as never)

    const guestListeners = new Map<string, (...args: unknown[]) => void>()
    const guest = {
      setUserAgent: () => {},
      setWindowOpenHandler: () => {},
      getURL: () => 'https://example.com/',
      on: (ev: string, fn: (...args: unknown[]) => void) => {
        guestListeners.set(ev, fn)
      },
    }
    hostListeners.get('did-attach-webview')!({}, guest)
    const guestNav = guestListeners.get('will-navigate')
    expect(guestNav).toBeTypeOf('function')

    let prevented = false
    guestNav!({ preventDefault: () => { prevented = true } }, 'file:///etc/passwd')
    expect(prevented).toBe(true)

    prevented = false
    guestNav!({ preventDefault: () => { prevented = true } }, 'javascript:alert(1)')
    expect(prevented).toBe(true)

    prevented = false
    guestNav!({ preventDefault: () => { prevented = true } }, 'https://example.com/page')
    expect(prevented).toBe(false)
  })
})
