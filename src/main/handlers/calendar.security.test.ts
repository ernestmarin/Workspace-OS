import { describe, it, expect, vi } from 'vitest'

/**
 * Lote N+1b — autorización real por handler (calendar:*).
 *
 * El guard es la primera línea del handler: un frame forjado se rechaza antes
 * de tocar el store o la red. Fixtures: senderFrame null y subframe.
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
import { registerCalendarHandlers } from './calendar'

const forgedNull = { senderFrame: null }
const forgedParent = { senderFrame: { parent: { routingId: 0 } } }

const call = (h: (event: any, ...args: any[]) => any, event: any, ...args: any[]) =>
  Promise.resolve().then(() => h(event, ...args))

describe('calendar:* — assertMainFrame rechaza frames forjados (N+1b)', () => {
  registerCalendarHandlers({} as never)

  it('calendar:add rechaza senderFrame null', async () => {
    const h = mock.handlers.get(IPC.CALENDAR_ADD)!
    await expect(call(h, forgedNull, {})).rejects.toThrow(/non-main frame|detached/i)
  })

  it('calendar:add rechaza subframe (parent no nulo)', async () => {
    const h = mock.handlers.get(IPC.CALENDAR_ADD)!
    await expect(call(h, forgedParent, {})).rejects.toThrow(/non-main frame|detached/i)
  })

  it('calendar:remove-event rechaza senderFrame null', async () => {
    const h = mock.handlers.get(IPC.CALENDAR_REMOVE_EVENT)!
    await expect(call(h, forgedNull, 'x')).rejects.toThrow(/non-main frame|detached/i)
  })

  it('calendar:sources rechaza senderFrame null', async () => {
    const h = mock.handlers.get(IPC.CALENDAR_SOURCES)!
    await expect(call(h, forgedNull)).rejects.toThrow(/non-main frame|detached/i)
  })
})
