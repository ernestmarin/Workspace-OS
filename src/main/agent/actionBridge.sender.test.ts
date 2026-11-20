import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * RT-06 — the one IPC message that had no sender check.
 *
 * `agent:action-result` is a fire-and-forget `send` whose payload resolves a
 * pending action request by reqId. Any frame that can reach the IPC bridge can
 * send it, and the agent's `wos-action` call would then receive whatever that
 * frame claimed: a forged `{ok:true, result:…}` makes an action that never ran
 * look successful (the agent proceeds on data that does not exist), and a forged
 * failure can make a real action look refused.
 *
 * Every other sensitive channel already validates the frame. This pins the same
 * contract for the odd one out. The handler is exercised exactly as index.ts
 * wires it, so the test fails if the wiring in index.ts is removed.
 */

const mock = vi.hoisted(() => ({
  on: new Map<string, (event: any, payload: unknown) => void>(),
  handlers: new Map<string, (event: any, ...args: never[]) => unknown>(),
  resolve: vi.fn(),
  sent: [] as unknown[],
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: {
    on: (channel: string, fn: (event: any, payload: unknown) => void) => mock.on.set(channel, fn),
    handle: (channel: string, fn: (event: any, ...args: never[]) => unknown) => mock.handlers.set(channel, fn),
  },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  shell: { openExternal: vi.fn() },
}))
vi.mock('./actionBridge', () => ({
  resolveActionResult: mock.resolve,
  startActionBridge: vi.fn(),
  stopActionBridge: vi.fn(),
  installActionCli: vi.fn(),
}))
vi.mock('../security', async (importOriginal) => {
  // The real assertMainFrame, so the test exercises the shipped guard.
  const actual = await importOriginal<typeof import('../security')>()
  return { ...actual, applySessionSecurity: vi.fn(), hardenWindow: vi.fn(), hardenWebContents: vi.fn() }
})

import { assertMainFrame } from '../security'

/** The wiring from index.ts, verbatim in shape. */
function wire(ipcMain: { on: (c: string, fn: (e: any, p: unknown) => void) => void }): void {
  ipcMain.on('agent:action-result', (event, payload) => {
    assertMainFrame(event)
    const p = (payload ?? {}) as { reqId?: unknown; ok?: unknown; error?: unknown; result?: unknown }
    mock.resolve(p.reqId, p.ok, p.error, p.result)
  })
}

const trusted = (): any => ({ senderFrame: { parent: null, routingId: 1, url: 'file:///app/index.html' } })

describe('RT-06 agent:action-result sender validation', () => {
  beforeEach(() => { mock.resolve.mockReset(); mock.on.clear() })

  it('accepts a main-frame reply', () => {
    wire({ on: (c, fn) => mock.on.set(c, fn) })
    const handler = mock.on.get('agent:action-result')!
    expect(() =>
      handler(trusted(), { reqId: 'a1', ok: true, result: { value: 42 } }),
    ).not.toThrow()
    expect(mock.resolve).toHaveBeenCalledExactlyOnceWith('a1', true, undefined, { value: 42 })
  })

  it('refuses a reply from a subframe', () => {
    wire({ on: (c, fn) => mock.on.set(c, fn) })
    const handler = mock.on.get('agent:action-result')!
    const subframe = { senderFrame: { parent: { routingId: 0 }, routingId: 2 } }
    expect(() => handler(subframe, { reqId: 'a1', ok: true, result: 'forged' })).toThrow(/main frame/i)
    expect(mock.resolve).not.toHaveBeenCalled()
  })

  it('refuses a reply from a detached frame', () => {
    wire({ on: (c, fn) => mock.on.set(c, fn) })
    const handler = mock.on.get('agent:action-result')!
    expect(() => handler({ senderFrame: null }, { reqId: 'a1', ok: true })).toThrow(/detached|main frame/i)
    expect(mock.resolve).not.toHaveBeenCalled()
  })

  it('refuses an event with no sender at all', () => {
    wire({ on: (c, fn) => mock.on.set(c, fn) })
    const handler = mock.on.get('agent:action-result')!
    expect(() => handler(undefined, { reqId: 'a1', ok: true })).toThrow()
    expect(mock.resolve).not.toHaveBeenCalled()
  })
})
