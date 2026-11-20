import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * RT-06 — unbounded in-flight action round-trips.
 *
 * Every `run` over the agent socket holds a promise in `pending` until the
 * renderer replies or the 30s timer fires, and the socket accepts one connection
 * per request with no connection limit. Nothing bounded how many could be in
 * flight at once: an agent (or an action loop that forgets to await) grows the
 * map and the open sockets until the process is killed. The refusal has to be a
 * reply, not a hang, because the caller is a CLI that would otherwise wait out
 * the full timeout for each one.
 */

const mock = vi.hoisted(() => ({
  win: null as any,
  sends: 0,
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  BrowserWindow: {
    getFocusedWindow: () => mock.win,
    getAllWindows: () => [mock.win],
  },
}))

import { invokeGrantedAction } from './actionBridge'
import { setContext } from '../context/workspaceContext'
import { grants } from './grants'

const token = grants.issue('bound-test', 'all', 'bound-test')

/** A window that never replies, so every request stays in flight. */
const silentWindow = (): any => ({
  isDestroyed: () => false,
  webContents: { send: () => { mock.sends += 1 } },
})

/**
 * The production dispatch path: `invokeGrantedAction` → real deps → the renderer
 * round-trip that owns the pending map. Injecting a resolver here would test a
 * fast path the bound does not govern.
 */
const run = (): ReturnType<typeof invokeGrantedAction> =>
  invokeGrantedAction({ cmd: 'run', token, actionId: 'files.new-folder' })

describe('RT-06 bounded in-flight round-trips', () => {
  beforeEach(() => {
    mock.sends = 0
    mock.win = silentWindow()
    setContext({
      root: '/ws',
      surface: 'files',
      folder: '/ws',
      openFile: null,
      actions: [],
      allActionIds: ['files.new-folder'],
    })
  })
  afterEach(() => { vi.useRealTimers() })

  it('refuses the request past the ceiling instead of queueing forever', async () => {
    vi.useFakeTimers()
    const inflight = Array.from({ length: 64 }, () => run())
    // The 64 in-flight requests are parked; the 65th must be refused promptly.
    const overflow = await run()
    expect(overflow).toEqual({ ok: false, error: expect.stringContaining('too many actions in flight') })
    // Only the accepted 64 reached the renderer.
    expect(mock.sends).toBe(64)
    // Let every parked promise settle so nothing leaks into the next test.
    await vi.runAllTimersAsync()
    await Promise.all(inflight)
  })

  it('frees the slot when a round-trip completes, so the bridge recovers', async () => {
    vi.useFakeTimers()
    const inflight = Array.from({ length: 64 }, () => run())
    expect(await run()).toMatchObject({ ok: false })
    // Time every in-flight request out (they resolve as failures), releasing slots.
    await vi.runAllTimersAsync()
    await Promise.all(inflight)
    const after = run()
    await vi.runAllTimersAsync()
    expect(await after).toMatchObject({ ok: false, error: 'action timed out' })
    expect(mock.sends).toBe(65)
  })
})

describe('RT-06 run identity still precedes the bound', () => {
  beforeEach(() => {
    mock.sends = 0
    mock.win = silentWindow()
    setContext({
      root: '/ws', surface: 'files', folder: '/ws', openFile: null,
      actions: [], allActionIds: ['files.new-folder'],
    })
  })

  it('refuses an ungranted run before counting it against the ceiling', async () => {
    const reply = await invokeGrantedAction({ cmd: 'run', token: 'forged', actionId: 'files.new-folder' })
    expect(reply).toMatchObject({ ok: false, error: expect.stringContaining('no run identity') })
    expect(mock.sends).toBe(0)
  })
})
