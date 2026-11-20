import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const hoisted = vi.hoisted(() => ({
  mockRoot: '',
  protocolHandler: null as ((req: Request) => Response | Promise<Response>) | null,
  handlers: new Map<string, (event: any, ...args: any[]) => any>(),
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
  dialog: {},
  nativeTheme: { shouldUseDarkColors: false },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn((scheme: string, fn: (req: Request) => Response | Promise<Response>) => {
      if (scheme === 'wos-app') hoisted.protocolHandler = fn
    }),
  },
}))

vi.mock('../workspace-root', () => ({
  getWorkspaceRoot: () => hoisted.mockRoot,
}))

vi.mock('../ipc-registry', () => ({
  ipcHandle: (_ipc: unknown, channel: string, handler: any) => hoisted.handlers.set(channel, handler),
}))

import { IPC } from '../ipc-channels'
import { registerAppsHandlers } from './apps'

describe('wos-app://file/ symlink confinement (SEC-02)', () => {
  let outside: string

  beforeAll(() => {
    registerAppsHandlers({ handle: vi.fn() } as never)
  })

  beforeEach(() => {
    hoisted.mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-sec02-root-'))
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-sec02-out-'))
    fs.writeFileSync(path.join(outside, 'secret.html'), '<h1>OUTSIDE SECRET</h1>')
  })

  afterEach(() => {
    fs.rmSync(hoisted.mockRoot, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  })

  it('refuses to serve a workspace .html symlink pointing outside the workspace', async () => {
    fs.symlinkSync(path.join(outside, 'secret.html'), path.join(hoisted.mockRoot, 'escape.html'))
    const res = await hoisted.protocolHandler!(new Request('wos-app://file/?path=escape.html'))
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('OUTSIDE SECRET')
  })

  it('serves a genuine workspace .html file inside the workspace', async () => {
    fs.writeFileSync(path.join(hoisted.mockRoot, 'inside.html'), '<h1>INSIDE OK</h1>')
    const res = await hoisted.protocolHandler!(new Request('wos-app://file/?path=inside.html'))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('INSIDE OK')
  })
})

/**
 * Lote N+1b — autorización real por handler (apps:*).
 *
 * El guard es la primera línea del handler: un frame forjado se rechaza antes
 * de tocar el workspace. Fixtures: senderFrame null y subframe.
 */
describe('apps:* — assertMainFrame rechaza frames forjados (N+1b)', () => {
  const forgedNull = { senderFrame: null }
  const forgedParent = { senderFrame: { parent: { routingId: 0 } } }
  const call = (h: (event: any, ...args: any[]) => any, event: any, ...args: any[]) =>
    Promise.resolve().then(() => h(event, ...args))

  it('apps:install rechaza senderFrame null', async () => {
    const h = hoisted.handlers.get(IPC.APPS_INSTALL)!
    await expect(call(h, forgedNull, 'x')).rejects.toThrow(/non-main frame|detached/i)
  })

  it('apps:install rechaza subframe (parent no nulo)', async () => {
    const h = hoisted.handlers.get(IPC.APPS_INSTALL)!
    await expect(call(h, forgedParent, 'x')).rejects.toThrow(/non-main frame|detached/i)
  })

  it('apps:call rechaza senderFrame null', async () => {
    const h = hoisted.handlers.get(IPC.APPS_CALL)!
    await expect(call(h, forgedNull, 'x', 'ai.complete', {})).rejects.toThrow(/non-main frame|detached/i)
  })

  it('apps:manifest rechaza senderFrame null', async () => {
    const h = hoisted.handlers.get(IPC.APPS_MANIFEST)!
    await expect(call(h, forgedNull, 'x')).rejects.toThrow(/non-main frame|detached/i)
  })
})
