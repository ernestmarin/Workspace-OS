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
  it('extracts prose across deltas, excluding fenced/inline code and link destinations', () => {
    const replies = new SpokenReplies()
    replies.begin('a')
    for (const delta of 'Read [guide](https://private).\n\n```\nprivate\n```\n\nDone `code`.'.split('')) replies.append('a', delta)
    expect(replies.finish('a', true)).toBe('Read guide.\n\nDone.')
  })
  it('fails closed instead of reading incomplete code, invalid Unicode or unsupported markup', () => {
    const replies = new SpokenReplies()
    for (const text of ['```\nprivate', '`private', '[label](private', '<script>private</script>', '\ud800']) {
      replies.begin('a'); replies.append('a', text)
      expect(replies.finish('a', true)).toBeNull()
    }
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
