import { describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../../shared/speech/defaults'
import { MAX_REPLY_RESERVATIONS, MAX_REPLY_SESSIONS } from '../../shared/speech/replies'
import { ReplyReadingSessions, replyDestination } from './replies'
import type { ReadingOutcome } from './reading'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const harness = () => {
  const result = deferred<ReadingOutcome>()
  let next = 0
  const enqueue = vi.fn(() => ({ id: ++next, result: result.promise }))
  const cancel = vi.fn()
  const sessions = new ReplyReadingSessions<object>({ enqueue, cancel })
  const owner = {}, other = {}
  const config = defaultConfig()
  const session = sessions.open(owner, 'tab-1', config)
  const reply = sessions.reserve(owner, session.id, 'run-1')
  return { result, enqueue, cancel, sessions, owner, other, config, session, reply }
}

describe('document-owned completed-reply reading sessions', () => {
  it('freezes approved config and queues without interrupting other speech', async () => {
    const h = harness()
    h.config.tts.profiles[0].engine = 'openai'
    h.config.tts.profiles[0].voice = 'changed'
    const read = h.sessions.finish(h.owner, h.session.id, h.reply.id, 'Hello.')
    const [, config, context] = h.enqueue.mock.calls[0] as unknown as [string, ReturnType<typeof defaultConfig>, object]
    expect(config.tts.profiles[0].engine).toBe('kokoro')
    expect(config.tts.profiles[0].voice).not.toBe('changed')
    expect(config.playback.on_retrigger).toBe('queue')
    expect(context).toBe(h.owner)
    h.result.resolve({ finished: true })
    expect(await read).toEqual({ finished: true })
  })
  it('owns cancellation before the finish IPC acknowledgement and does not cancel another session', async () => {
    const h = harness()
    const second = h.sessions.open(h.owner, 'tab-2', h.config)
    const secondReply = h.sessions.reserve(h.owner, second.id, 'run-2')
    const a = h.sessions.finish(h.owner, h.session.id, h.reply.id, 'First.')
    const b = h.sessions.finish(h.owner, second.id, secondReply.id, 'Second.')
    h.sessions.close(h.owner, h.session.id)
    expect(h.cancel).toHaveBeenCalledExactlyOnceWith(1)
    h.result.resolve({ finished: true })
    await Promise.all([a, b])
    expect(h.cancel).toHaveBeenCalledTimes(1)
  })
  it('cannot reopen a closed session through a delayed reservation or finish call', async () => {
    const h = harness()
    h.sessions.close(h.owner, h.session.id)
    expect(() => h.sessions.reserve(h.owner, h.session.id, 'late-run')).toThrow(/session/i)
    await expect(h.sessions.finish(h.owner, h.session.id, h.reply.id, 'late')).rejects.toThrow(/session/i)
    expect(h.enqueue).not.toHaveBeenCalled()
  })
  it('requires the same document and session for every reservation', async () => {
    const h = harness()
    const second = h.sessions.open(h.owner, 'tab-2', h.config)
    expect(() => h.sessions.reserve(h.other, h.session.id, 'run')).toThrow(/session/i)
    expect(() => h.sessions.close(h.other, h.session.id)).toThrow(/session/i)
    await expect(h.sessions.finish(h.other, h.session.id, h.reply.id, 'private')).rejects.toThrow(/session/i)
    await expect(h.sessions.finish(h.owner, second.id, h.reply.id, 'foreign')).rejects.toThrow(/reservation/i)
    expect(h.enqueue).not.toHaveBeenCalled()
  })
  it('consumes text at most once, even while audio is still draining', async () => {
    const h = harness()
    const read = h.sessions.finish(h.owner, h.session.id, h.reply.id, 'Once.')
    await expect(h.sessions.finish(h.owner, h.session.id, h.reply.id, 'replayed')).rejects.toThrow(/reservation/i)
    expect(h.enqueue).toHaveBeenCalledTimes(1)
    h.result.resolve({ finished: true }); await read
    await expect(h.sessions.finish(h.owner, h.session.id, h.reply.id, 'late')).rejects.toThrow(/reservation/i)
  })
  it('discards unsuccessful replies without starting synthesis and frees their reservation', async () => {
    const h = harness()
    expect(await h.sessions.finish(h.owner, h.session.id, h.reply.id, null)).toEqual({ finished: false, error: 'Cancelled' })
    expect(h.enqueue).not.toHaveBeenCalled()
    expect(h.sessions.reserve(h.owner, h.session.id, 'run-1').id).not.toBe(h.reply.id)
  })
  it('can cancel a single draining reservation without ending its consent session', async () => {
    const h = harness()
    const read = h.sessions.finish(h.owner, h.session.id, h.reply.id, 'Hello.')
    await h.sessions.finish(h.owner, h.session.id, h.reply.id, null)
    expect(h.cancel).toHaveBeenCalledExactlyOnceWith(1)
    h.result.resolve({ finished: false, error: 'Cancelled' }); await read
    expect(h.sessions.reserve(h.owner, h.session.id, 'next').id).toBeTruthy()
  })
  it('bounds sessions and globally counts waiting as well as draining replies', async () => {
    const h = harness()
    for (let i = 1; i < MAX_REPLY_SESSIONS; i++) h.sessions.open(h.owner, `tab-${i + 1}`, h.config)
    expect(() => h.sessions.open(h.owner, 'overflow', h.config)).toThrow(/limit/i)
    for (let i = 1; i < MAX_REPLY_RESERVATIONS; i++) h.sessions.reserve(h.owner, h.session.id, `run-${i + 1}`)
    const read = h.sessions.finish(h.owner, h.session.id, h.reply.id, 'Draining.')
    expect(() => h.sessions.reserve(h.owner, h.session.id, 'overflow')).toThrow(/limit/i)
    h.result.resolve({ finished: true }); await read
    expect(h.sessions.reserve(h.owner, h.session.id, 'now-available').id).toBeTruthy()
  })
  it('stop-all invalidates pending completions but permits explicitly reserved future runs', async () => {
    const h = harness()
    const other = h.sessions.open(h.other, 'other-document', h.config)
    const otherReply = h.sessions.reserve(h.other, other.id, 'other-run')
    const read = h.sessions.finish(h.owner, h.session.id, h.reply.id, 'First.')
    h.sessions.stopWork()
    expect(h.cancel).toHaveBeenCalledExactlyOnceWith(1)
    await expect(h.sessions.finish(h.other, other.id, otherReply.id, 'stale')).rejects.toThrow(/reservation/i)
    expect(h.sessions.reserve(h.owner, h.session.id, 'future').id).toBeTruthy()
    h.result.resolve({ finished: false, error: 'Cancelled' }); await read
  })
  it('document teardown closes only that document; global teardown releases all sessions', () => {
    const h = harness()
    const other = h.sessions.open(h.other, 'other-document', h.config)
    h.sessions.closeContext(h.owner)
    expect(() => h.sessions.reserve(h.owner, h.session.id, 'late')).toThrow(/session/i)
    expect(h.sessions.reserve(h.other, other.id, 'live').id).toBeTruthy()
    h.sessions.closeAll()
    expect(() => h.sessions.reserve(h.other, other.id, 'late')).toThrow(/session/i)
  })
  it('fails boundedly on invalid identities, duplicate live run IDs and oversized text', async () => {
    const h = harness()
    for (const id of ['', 'x'.repeat(129), 1, null, '../private', '\u001b']) {
      expect(() => h.sessions.open(h.owner, id as string, h.config)).toThrow(/identity/i)
      expect(() => h.sessions.reserve(h.owner, h.session.id, id as string)).toThrow(/identity/i)
    }
    expect(() => h.sessions.reserve(h.owner, h.session.id, 'run-1')).toThrow(/reserved/i)
    for (const [index, text] of ['', ' ', 'x'.repeat(20_001), 1, {}].entries()) {
      const reply = h.sessions.reserve(h.owner, h.session.id, `malformed-${index}`)
      await expect(h.sessions.finish(h.owner, h.session.id, reply.id, text)).rejects.toThrow(/text/i)
    }
    expect(h.enqueue).not.toHaveBeenCalled()
  })
  it('releases a rejected completion instead of leaking a reservation under a smaller approved text limit', async () => {
    const h = harness()
    const config = defaultConfig()
    config.trigger.max_text_length = 5
    h.result.resolve({ finished: true })
    const session = h.sessions.open(h.owner, 'small-limit', config)
    for (let i = 0; i < MAX_REPLY_RESERVATIONS * 2; i++) {
      const reply = h.sessions.reserve(h.owner, session.id, `invalid-${i}`)
      await expect(h.sessions.finish(h.owner, session.id, reply.id, 'Too long.')).rejects.toThrow(/text/i)
      await expect(h.sessions.finish(h.owner, session.id, reply.id, 'Retry')).rejects.toThrow(/reservation/i)
    }
    expect(h.sessions.reserve(h.owner, session.id, 'valid-future-run').id).toBeTruthy()
    expect(h.enqueue).not.toHaveBeenCalled()
  })
  it('releases failed enqueue reservations without retrying or falling back to another engine', async () => {
    const h = harness()
    h.enqueue.mockImplementationOnce(() => { throw new Error('busy') })
    await expect(h.sessions.finish(h.owner, h.session.id, h.reply.id, 'Hello.')).rejects.toThrow('busy')
    await expect(h.sessions.finish(h.owner, h.session.id, h.reply.id, 'retry')).rejects.toThrow(/reservation/i)
    expect(h.enqueue).toHaveBeenCalledTimes(1)
  })
  it('describes only implemented destinations without exposing config or keys', () => {
    const cfg = defaultConfig()
    expect(replyDestination(cfg)).toEqual({ engine: 'kokoro', voice: cfg.tts.profiles[0].voice, remote: false })
    cfg.tts.profiles[0].engine = 'openai'
    expect(replyDestination(cfg).remote).toBe(true)
    cfg.tts.profiles[0].engine = 'piper'
    cfg.tts.profiles[0].voice = 'es_ES-davefx-medium'
    expect(replyDestination(cfg)).toEqual({ engine: 'piper', voice: 'es_ES-davefx-medium', remote: false })
    cfg.tts.profiles[0].engine = 'elevenlabs'
    expect(() => replyDestination(cfg)).toThrow(/implemented/i)
  })
})
