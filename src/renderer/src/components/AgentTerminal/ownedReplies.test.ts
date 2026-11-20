import { describe, expect, it, vi } from 'vitest'
import { OwnedReplies } from './ownedReplies'
import type { ReplySpeechResult, ReplySpeechSession } from '../../../../shared/speech/replies'

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const session = (id = 'lease-1'): ReplySpeechSession => ({ id, engine: 'kokoro', voice: 'af_heart', remote: false })
const harness = () => {
  const api = {
    openReplySession: vi.fn(async (_tab: string) => session() as ReplySpeechSession | null),
    reserveReply: vi.fn(async (_session: string, run: string) => ({ id: `reply-${run}` })),
    finishReply: vi.fn(async (_session: string, _reply: string, text: string | null): Promise<ReplySpeechResult> => text === null ? { finished: false, error: 'Cancelled' } : { finished: true }),
    closeReplySession: vi.fn(async (_session: string) => {}),
  }
  const onState = vi.fn(), onError = vi.fn()
  const reader = new OwnedReplies(api, { onState, onError })
  return { api, reader, onState, onError }
}

describe('owned completed-reply reader (never global speak)', () => {
  it('is opt-in and reads only owned successful runs, once, after prose extraction', async () => {
    const h = harness()
    h.reader.begin('off'); h.reader.append('off', 'private'); h.reader.finish('off', true)
    expect(h.api.reserveReply).not.toHaveBeenCalled()
    await h.reader.enable('tab')
    h.reader.begin('a'); h.reader.append('other', 'foreign')
    h.reader.append('a', 'Read [guide](https://private).\n\n```\ncode\n```')
    h.reader.finish('a', true); h.reader.finish('a', true)
    await flush()
    expect(h.api.finishReply).toHaveBeenCalledExactlyOnceWith('lease-1', 'reply-a', 'Read guide.')
    expect(h.onError).not.toHaveBeenCalled()
  })
  it('closes a late opt-in acknowledgement instead of arming a hidden or unmounted tab', async () => {
    const h = harness(), open = deferred<ReplySpeechSession | null>()
    h.api.openReplySession.mockReturnValueOnce(open.promise)
    const enabled = h.reader.enable('tab')
    h.reader.disable()
    open.resolve(session('late'))
    await enabled
    h.reader.begin('late-run'); h.reader.append('late-run', 'private'); h.reader.finish('late-run', true)
    await flush()
    expect(h.api.closeReplySession).toHaveBeenCalledExactlyOnceWith('late')
    expect(h.api.reserveReply).not.toHaveBeenCalled()
    expect(h.onState.mock.lastCall?.[0].enabled).toBe(false)
  })
  it('never lets an old opt-in acknowledgement replace a newer epoch', async () => {
    const h = harness(), old = deferred<ReplySpeechSession | null>()
    h.api.openReplySession.mockReturnValueOnce(old.promise)
    const first = h.reader.enable('tab')
    h.reader.disable()
    h.api.openReplySession.mockResolvedValueOnce(session('new'))
    await h.reader.enable('tab')
    old.resolve(session('old')); await first
    h.reader.begin('a'); h.reader.append('a', 'New.'); h.reader.finish('a', true)
    await flush()
    expect(h.api.closeReplySession).toHaveBeenCalledWith('old')
    expect(h.api.closeReplySession).not.toHaveBeenCalledWith('new')
    expect(h.api.finishReply).toHaveBeenCalledWith('new', 'reply-a', 'New.')
  })
  it('does not start speech after disabling while a reservation acknowledgement is delayed', async () => {
    const h = harness(), reserve = deferred<{ id: string }>()
    await h.reader.enable('tab')
    h.api.reserveReply.mockReturnValueOnce(reserve.promise)
    h.reader.begin('a'); await flush()
    h.reader.append('a', 'private'); h.reader.finish('a', true)
    h.reader.disable()
    reserve.resolve({ id: 'late-ticket' }); await flush()
    expect(h.api.closeReplySession).toHaveBeenCalledWith('lease-1')
    expect(h.api.finishReply.mock.calls.some(([, , text]) => text !== null)).toBe(false)
  })
  it('closes its session even while a completed reply is still playing and finish IPC is pending', async () => {
    const h = harness(), drain = deferred<ReplySpeechResult>()
    await h.reader.enable('tab')
    h.api.finishReply.mockReturnValueOnce(drain.promise)
    h.reader.begin('a'); h.reader.append('a', 'Playing.'); h.reader.finish('a', true)
    await flush(); h.reader.disable()
    expect(h.api.closeReplySession).toHaveBeenCalledExactlyOnceWith('lease-1')
    drain.resolve({ finished: false, error: 'Cancelled' }); await flush()
    expect(h.onError).not.toHaveBeenCalled()
  })
  it('discards failure, overflow and ambiguous markup without sending partial reply text', async () => {
    const h = harness(); await h.reader.enable('tab')
    for (const [id, text, ok] of [['failed', 'Valid.', false], ['overflow', 'x'.repeat(20_001), true], ['markup', '`private', true]] as const) {
      h.reader.begin(id); h.reader.append(id, text); h.reader.finish(id, ok)
    }
    await flush()
    expect(h.api.finishReply).toHaveBeenCalledTimes(3)
    expect(h.api.finishReply.mock.calls.every(([, , text]) => text === null)).toBe(true)
  })
  it('stops current/pending replies without disabling future consent or touching the agent', async () => {
    const h = harness(); await h.reader.enable('tab')
    const reserve = deferred<{ id: string }>()
    h.api.reserveReply.mockReturnValueOnce(reserve.promise)
    h.reader.begin('a'); await flush(); h.reader.append('a', 'old'); h.reader.stop()
    reserve.resolve({ id: 'pending' }); await flush()
    h.reader.finish('a', true)
    h.reader.begin('next'); h.reader.append('next', 'Next.'); h.reader.finish('next', true)
    await flush()
    expect(h.api.finishReply).toHaveBeenCalledWith('lease-1', 'pending', null)
    expect(h.api.finishReply).toHaveBeenCalledWith('lease-1', 'reply-next', 'Next.')
    expect(h.api.closeReplySession).not.toHaveBeenCalled()
  })
  it('bounds pending and draining runs and rejects duplicate registration', async () => {
    const h = harness(), drain = deferred<ReplySpeechResult>()
    await h.reader.enable('tab')
    h.api.finishReply.mockReturnValue(drain.promise)
    for (let i = 0; i < 10; i++) { h.reader.begin(`run-${i}`); h.reader.append(`run-${i}`, 'Bounded.'); h.reader.finish(`run-${i}`, true) }
    h.reader.begin('run-0'); await flush()
    expect(h.api.reserveReply).toHaveBeenCalledTimes(8)
    expect(h.api.finishReply).toHaveBeenCalledTimes(8)
    drain.resolve({ finished: true }); await flush()
  })
  it('does not let a stale rejected reservation clear a newer epoch using the same run ID', async () => {
    const h = harness()
    let reject!: (error: Error) => void
    const old = new Promise<{ id: string }>((_resolve, fail) => { reject = fail })
    await h.reader.enable('tab')
    h.api.reserveReply.mockReturnValueOnce(old)
    h.reader.begin('same'); await flush(); h.reader.disable()
    h.api.openReplySession.mockResolvedValueOnce(session('new'))
    await h.reader.enable('tab')
    h.reader.begin('same'); h.reader.append('same', 'New epoch.')
    await flush(); reject(new Error('late failure')); await flush()
    h.reader.finish('same', true); await flush()
    expect(h.api.finishReply).toHaveBeenCalledWith('new', 'reply-same', 'New epoch.')
    expect(h.onError).not.toHaveBeenCalled()
  })
  it('handles declined consent and transport failures without fallback or unhandled rejection', async () => {
    const h = harness()
    h.api.openReplySession.mockResolvedValueOnce(null)
    await h.reader.enable('tab'); h.reader.begin('declined')
    expect(h.api.reserveReply).not.toHaveBeenCalled()
    h.api.openReplySession.mockRejectedValueOnce(new Error('offline'))
    await h.reader.enable('tab')
    expect(h.onError).toHaveBeenCalledTimes(1)
    await h.reader.enable('tab')
    h.api.reserveReply.mockRejectedValueOnce(new Error('queue full'))
    h.reader.begin('failed'); h.reader.append('failed', 'No fallback.'); h.reader.finish('failed', true)
    await flush()
    expect(h.onError).toHaveBeenCalledTimes(2)
    expect(h.api.finishReply).not.toHaveBeenCalled()
  })
})
