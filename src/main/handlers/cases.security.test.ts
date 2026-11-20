import { describe, it, expect, vi } from 'vitest'

/**
 * Lote N+1b — autorización real por handler (cases:*).
 *
 * Cada handler debe rechazar un frame forjado (senderFrame null o con parent)
 * antes de tocar el filesystem. El guard es la primera línea del handler, así
 * que la prueba no necesita workspace real: el rechazo ocurre antes de load().
 */

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, ...args: any[]) => any>(),
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, IpcMain: class {} }))
vi.mock('../ipc-registry', () => ({
  ipcHandle: (_ipc: unknown, channel: string, handler: any) => mock.handlers.set(channel, handler),
}))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => '/tmp' }))

import { IPC } from '../ipc-channels'
import { registerCaseHandlers } from './cases'

const forgedNull = { senderFrame: null }
const forgedParent = { senderFrame: { parent: { routingId: 0 } } }
const trusted = { senderFrame: { parent: null } }

// Los handlers cases son síncronos: el throw es síncrono, no un reject.
// Promise.resolve().then() normaliza ambos casos para .rejects.
const call = (h: (event: any, ...args: any[]) => any, event: any, ...args: any[]) =>
  Promise.resolve().then(() => h(event, ...args))

describe('cases:* — assertMainFrame rechaza frames forjados (N+1b)', () => {
  registerCaseHandlers({} as never)

  it('cases:create rechaza senderFrame null', async () => {
    const h = mock.handlers.get(IPC.CASES_CREATE)!
    await expect(call(h, forgedNull, { title: 'x' })).rejects.toThrow(/non-main frame|detached/i)
  })

  it('cases:create rechaza subframe (parent no nulo)', async () => {
    const h = mock.handlers.get(IPC.CASES_CREATE)!
    await expect(call(h, forgedParent, { title: 'x' })).rejects.toThrow(/non-main frame|detached/i)
  })

  it('cases:delete rechaza senderFrame null', async () => {
    const h = mock.handlers.get(IPC.CASES_DELETE)!
    await expect(call(h, forgedNull, 'x')).rejects.toThrow(/non-main frame|detached/i)
  })

  it('cases:list rechaza senderFrame null', async () => {
    const h = mock.handlers.get(IPC.CASES_LIST)!
    await expect(call(h, forgedNull)).rejects.toThrow(/non-main frame|detached/i)
  })

  it('el frame confiable no es rechazado por el guard (pasa al cuerpo)', async () => {
    // Con frame confiable, el handler llega a load() y resuelve (null cuando
    // no hay case), NO lanza el error del guard. Distingue ambas.
    const h = mock.handlers.get(IPC.CASES_GET)!
    await expect(call(h, trusted, 'no-existe')).resolves.toBeNull()
  })
})
