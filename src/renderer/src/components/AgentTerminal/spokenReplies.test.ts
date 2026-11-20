import { describe, expect, it } from 'vitest'
import { SpokenReplies } from './spokenReplies'

describe('opt-in agent reply buffers', () => {
  it('collects only explicitly registered runs and only returns successful text once', () => {
    const replies = new SpokenReplies()
    replies.append('unregistered', 'private')
    expect(replies.finish('unregistered', true)).toBeNull()
    expect(replies.begin('one')).toBe(true)
    replies.append('one', 'Hola ')
    replies.append('other', 'foreign')
    replies.append('one', 'mundo')
    expect(replies.finish('one', true)).toBe('Hola mundo')
    expect(replies.finish('one', true)).toBeNull()
  })
  it('drops oversized, failed and disabled replies instead of speaking partial text', () => {
    const replies = new SpokenReplies(5, 2)
    replies.begin('a'); replies.append('a', '123456')
    expect(replies.finish('a', true)).toBeNull()
    replies.begin('b'); replies.append('b', 'text')
    expect(replies.finish('b', false)).toBeNull()
    replies.begin('c'); replies.append('c', 'text'); replies.clear()
    expect(replies.finish('c', true)).toBeNull()
  })
  it('bounds concurrent runs and never resets an existing run', () => {
    const replies = new SpokenReplies(10, 1)
    expect(replies.begin('a')).toBe(true)
    replies.append('a', 'text')
    expect(replies.begin('a')).toBe(false)
    expect(replies.begin('b')).toBe(false)
    expect(replies.finish('a', true)).toBe('text')
    expect(replies.begin('b')).toBe(true)
  })
})
