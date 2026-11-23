// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantResponseEvent, AssistantRunOwner } from '../../../../shared/agentRun'

/*
 * VOX-REACH-04 — the run lifecycle that the shipped agent surface really uses.
 *
 * `lib/sessions/sessionStore` is the only engine that starts runs for Chat, the
 * landscape cards and the terminal's agent tabs. It already owns runId → session
 * attribution, so it is also the only place that can honestly say "this reply
 * belongs to that session". The reply reader binds to these events instead of
 * re-subscribing to agent IPC per component.
 *
 * One invariant carries the whole batch: a run whose replies arrive as a
 * provenance-checked `agent:assistant-response` stream is read from that stream
 * ALONE. Main emits both channels for a claude run (launchRun.ts wires
 * `sink.assistantText` and `sink.assistantResponse` from the same parsed line),
 * so a reader listening to both would speak every reply twice.
 *
 * The store is re-imported per test: its run registry, live flags and IPC
 * subscriptions are module state, and a subscriber that outlives a test would
 * make the next one pass for the wrong reason.
 *
 * Mocked collaborators (reviewStore, activityStore, appHarness) are not the
 * subject of any assertion here; they are notified side effects of a turn.
 * `sessionModel`, `runTraceModel` and the response consumer are the real ones.
 */
vi.mock('../../components/Review/reviewStore', () => ({
  reviewStore: { openRun: vi.fn(), patchRun: vi.fn(), getSnapshot: () => ({ runs: [] }) },
}))
vi.mock('../../components/Review/activityStore', () => ({
  activityStore: { record: vi.fn(), clear: vi.fn() },
}))
vi.mock('./appHarness', () => ({
  afterTurn: vi.fn(async () => {}),
  briefFirst: vi.fn(async () => ''),
}))

import type { ReplyEvent } from './sessionStore'

type Store = typeof import('./sessionStore').sessionStore
type Cb = (...args: never[]) => void

const bus = new Map<string, Cb[]>()
const on = (name: string) => (cb: Cb): (() => void) => {
  const list = bus.get(name) ?? []
  list.push(cb)
  bus.set(name, list)
  return () => bus.set(name, list.filter((x) => x !== cb))
}
const fire = (name: string, ...args: unknown[]): void => {
  for (const cb of bus.get(name) ?? []) (cb as (...a: unknown[]) => void)(...args)
}

const EPOCH = 'epoch-1'
/** When true, main acknowledges provenance like src/main/handlers/agent.ts does. */
let structured = false
let calls: unknown[][] = []

const agent = {
  // Mirrors the real return: `{ pid, checkpointId, provider, model, responseOwner }`.
  run: vi.fn(async (runId: string, _prompt: string, _files: string[], _file: string | null, _mode: string, _agent: string | null, conversationId: string) => {
    calls.push([runId, conversationId])
    return {
      pid: 1, checkpointId: null, provider: 'claude', model: 'claude:x',
      ...(structured ? { responseOwner: { sessionId: conversationId, runId, epoch: EPOCH } } : {}),
    }
  }),
  cancel: vi.fn(async () => {}),
  forgetConversation: vi.fn(async () => {}),
  onOutput: on('output'),
  onAssistantText: on('assistantText'),
  onAssistantResponse: on('assistantResponse'),
  onDone: on('done'),
  onActivity: on('activity'),
  onRunMeta: on('runMeta'),
  onArtifacts: on('artifacts'),
}

let sessionStore: Store
/** The events a subscriber saw, in arrival order. */
let seen: ReplyEvent[] = []

const lastRunId = (): string => calls.at(-1)![0] as string
/** The provider conversation id main stamps into `responseOwner.sessionId`. */
const lastConvo = (): string => calls.at(-1)![1] as string
const ownerOf = (runId: string): AssistantRunOwner => ({ sessionId: lastConvo(), runId, epoch: EPOCH })

const source = { provider: 'claude' as const, sessionId: 'prov-1', turnId: null }
const ev = (owner: AssistantRunOwner, sequence: number, rest: Record<string, unknown>): AssistantResponseEvent =>
  ({ owner, source, sequence, ...rest }) as unknown as AssistantResponseEvent

/** Drives a full, well-formed structured response for one run. */
const streamReply = (runId: string, text: string): void => {
  const owner = ownerOf(runId)
  fire('assistantResponse', ev(owner, 1, { type: 'response-start', responseId: 'r1' }))
  fire('assistantResponse', ev(owner, 2, { type: 'text-delta', responseId: 'r1', text }))
  fire('assistantResponse', ev(owner, 3, { type: 'response-end', responseId: 'r1', outcome: 'completed' }))
  fire('assistantResponse', ev(owner, 4, { type: 'run-end', outcome: 'completed' }))
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  bus.clear()
  calls = []
  seen = []
  structured = false
  Object.defineProperty(window, 'workspace', {
    configurable: true,
    value: {
      fs: { getWorkspaceRoot: async () => null, onRootChanged: () => {} },
      sessions: { load: async () => null, save: async () => {} },
      agent,
      skills: { list: async () => [] },
    },
  })
  ;({ sessionStore } = await import('./sessionStore'))
  // `start()` reads the workspace root asynchronously and `load(null)` resets
  // the session list; let that settle before the test creates anything, or the
  // first created session is wiped mid-test.
  sessionStore.onReplyEvents(() => {})()
  for (let i = 0; i < 10; i++) await Promise.resolve()
})

/** Subscribes and starts one run in a fresh session; resolves once run() settled. */
const startRun = async (id: string, prompt = 'hola'): Promise<string> => {
  sessionStore.create({ id })
  sessionStore.onReplyEvents((e) => seen.push(e))
  await sessionStore.send(id, prompt)
  return lastRunId()
}

describe('sessionStore reply lifecycle (VOX-REACH-04)', () => {
  it('attributes a run to the session that asked, from begin to terminal event', async () => {
    const runId = await startRun('dock-a') // legacy path: main flattened the reply text

    expect(seen[0]).toEqual({ type: 'begin', sessionId: 'dock-a', runId })
    fire('assistantText', runId, 'Hola.')
    fire('done', runId, 0, null)

    expect(seen).toEqual([
      { type: 'begin', sessionId: 'dock-a', runId },
      { type: 'text', sessionId: 'dock-a', runId, text: 'Hola.' },
      { type: 'finish', sessionId: 'dock-a', runId, ok: true },
    ])
  })

  it('ignores agent events for runs this store never started', async () => {
    const runId = await startRun('dock-a')
    fire('assistantText', 'run-of-someone-else', 'not mine')
    fire('done', 'run-of-someone-else', 0, null)
    expect(seen.filter((e) => e.type === 'text')).toEqual([])
    expect(seen.filter((e) => e.runId === runId && e.type === 'finish')).toEqual([])
  })

  it('reads a provenance-checked stream once, never doubling it with the flattened channel', async () => {
    structured = true
    const runId = await startRun('dock-a')
    streamReply(runId, 'Una sola vez.')
    // Main sends the same reply flattened on the legacy channel too.
    fire('assistantText', runId, 'Una sola vez.')
    fire('done', runId, 0, null)

    expect(seen.filter((e) => e.type === 'text')).toEqual([
      { type: 'text', sessionId: 'dock-a', runId, text: 'Una sola vez.' },
    ])
    expect(seen.filter((e) => e.type === 'finish')).toEqual([
      { type: 'finish', sessionId: 'dock-a', runId, ok: true },
    ])
  })

  it('falls back to the flattened channel when main returns no responseOwner', async () => {
    const runId = await startRun('dock-a') // structured === false
    fire('assistantText', runId, 'Legado.')
    fire('done', runId, 0, null)
    expect(seen.filter((e) => e.type === 'text')).toEqual([
      { type: 'text', sessionId: 'dock-a', runId, text: 'Legado.' },
    ])
    expect(seen.filter((e) => e.type === 'finish')).toEqual([
      { type: 'finish', sessionId: 'dock-a', runId, ok: true },
    ])
  })

  it('reports a failed run as not-ok so a half answer is never spoken', async () => {
    const runId = await startRun('dock-a')
    fire('assistantText', runId, 'Parcial')
    fire('done', runId, 1, null)
    expect(seen.at(-1)).toEqual({ type: 'finish', sessionId: 'dock-a', runId, ok: false })
  })

  it('cancels a quarantined structured stream instead of speaking a broken reply', async () => {
    structured = true
    const runId = await startRun('dock-a')
    const start = ev(ownerOf(runId), 1, { type: 'response-start', responseId: 'r1' })
    fire('assistantResponse', start)
    // Sequence must be strictly monotonic; a replayed sequence quarantines.
    fire('assistantResponse', start)
    fire('done', runId, 0, null)

    expect(seen.filter((e) => e.type === 'text')).toEqual([])
    expect(seen.some((e) => e.type === 'cancel' && e.runId === runId)).toBe(true)
    expect(seen.some((e) => e.type === 'finish')).toBe(false)
  })

  it('cancels a structured stream that never reached run-end rather than inventing a reply', async () => {
    structured = true
    const runId = await startRun('dock-a')
    const owner = ownerOf(runId)
    fire('assistantResponse', ev(owner, 1, { type: 'response-start', responseId: 'r1' }))
    fire('assistantResponse', ev(owner, 2, { type: 'text-delta', responseId: 'r1', text: 'Sin cerrar.' }))
    fire('done', runId, 0, null)

    expect(seen.some((e) => e.type === 'text')).toBe(true) // the prose was seen…
    expect(seen.some((e) => e.type === 'finish')).toBe(false) // …but never read aloud
    expect(seen.at(-1)).toEqual({ type: 'cancel', sessionId: 'dock-a', runId })
  })

  it('cancels the reply when the run itself fails to start', async () => {
    agent.run.mockRejectedValueOnce(new Error('spawn failed'))
    sessionStore.create({ id: 'dock-a' })
    sessionStore.onReplyEvents((e) => seen.push(e))
    await sessionStore.send('dock-a', 'hola')
    expect(seen.some((e) => e.type === 'cancel')).toBe(true)
    expect(seen.some((e) => e.type === 'finish')).toBe(false)
  })

  it('keeps two concurrent sessions apart', async () => {
    sessionStore.create({ id: 'dock-a' })
    sessionStore.create({ id: 'dock-b' })
    sessionStore.onReplyEvents((e) => seen.push(e))
    await sessionStore.send('dock-a', 'uno')
    const runA = lastRunId()
    await sessionStore.send('dock-b', 'dos')
    const runB = lastRunId()
    expect(runA).not.toBe(runB)

    fire('assistantText', runB, 'para b')
    fire('assistantText', runA, 'para a')
    fire('done', runA, 0, null)
    fire('done', runB, 0, null)

    expect(seen.filter((e) => e.type === 'text')).toEqual([
      { type: 'text', sessionId: 'dock-b', runId: runB, text: 'para b' },
      { type: 'text', sessionId: 'dock-a', runId: runA, text: 'para a' },
    ])
  })

  it('stops reporting once the subscriber leaves', async () => {
    sessionStore.create({ id: 'dock-a' })
    const off = sessionStore.onReplyEvents((e) => seen.push(e))
    await sessionStore.send('dock-a', 'hola')
    const runId = lastRunId()
    expect(seen).toEqual([{ type: 'begin', sessionId: 'dock-a', runId }])

    off()
    fire('assistantText', runId, 'nadie escucha')
    fire('done', runId, 0, null)
    expect(seen).toEqual([{ type: 'begin', sessionId: 'dock-a', runId }])
  })

  it('reports each terminal event once, however the run ends', async () => {
    structured = true
    const runId = await startRun('dock-a')
    streamReply(runId, 'Una vez.')
    fire('done', runId, 0, null)
    fire('done', runId, 0, null) // a late duplicate must not re-read the reply

    expect(seen.filter((e) => e.type === 'finish')).toHaveLength(1)
    expect(seen.filter((e) => e.type === 'cancel')).toHaveLength(0)
  })
})
