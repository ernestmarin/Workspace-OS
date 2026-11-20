import { describe, it, expect, vi } from 'vitest'

/**
 * Lote N+1b — autorización real por handler (mail:*).
 *
 * El guard es la primera línea del handler: un frame forjado se rechaza antes
 * de tocar cuentas, red o disco. Fixtures: senderFrame null y subframe.
 */

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, ...args: any[]) => any>(),
}))

vi.mock('electron', () => {
  const electron = {
    app: { getPath: () => '/tmp' },
    IpcMain: class {},
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  }
  return { ...electron, default: electron }
})
vi.mock('../ipc-registry', () => ({
  ipcHandle: (_ipc: unknown, channel: string, handler: any) => mock.handlers.set(channel, handler),
}))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => '/tmp' }))

import { IPC } from '../ipc-channels'
import { registerMailHandlers } from './mail'

const forgedNull = { senderFrame: null }
const forgedParent = { senderFrame: { parent: { routingId: 0 } } }

const call = (h: (event: any, ...args: any[]) => any, event: any, ...args: any[]) =>
  Promise.resolve().then(() => h(event, ...args))

describe('mail:* — assertMainFrame rechaza frames forjados (N+1b)', () => {
  registerMailHandlers({} as never)

  it('mail:send rechaza senderFrame null', async () => {
    const h = mock.handlers.get(IPC.MAIL_SEND)!
    await expect(call(h, forgedNull, 'a', {}, {})).rejects.toThrow(/non-main frame|detached/i)
  })

  it('mail:send rechaza subframe (parent no nulo)', async () => {
    const h = mock.handlers.get(IPC.MAIL_SEND)!
    await expect(call(h, forgedParent, 'a', {}, {})).rejects.toThrow(/non-main frame|detached/i)
  })

  it('mail:accounts-add rechaza senderFrame null', async () => {
    const h = mock.handlers.get(IPC.MAIL_ACCOUNTS_ADD)!
    await expect(call(h, forgedNull, {}, 'secret')).rejects.toThrow(/non-main frame|detached/i)
  })

  it('mail:move rechaza senderFrame null', async () => {
    const h = mock.handlers.get(IPC.MAIL_MOVE)!
    await expect(call(h, forgedNull, 'a', 'INBOX', '1', 'm', 'Archive', 'l')).rejects.toThrow(
      /non-main frame|detached/i,
    )
  })
})
