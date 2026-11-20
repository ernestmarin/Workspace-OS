import { describe, expect, it } from 'vitest'
import { initialConversationState, transitionConversation, type ConversationState } from './conversation'

function begun() {
  const listening = transitionConversation(initialConversationState('a'), { type: 'start' }).state
  const result = transitionConversation(listening, { type: 'submit', text: '  Abre el proyecto  ' })
  return { state: result.state, ticket: result.effects.submit!.ticket }
}

describe('voice conversation lifecycle', () => {
  it('starts opt-in and dispatches only finalized nonempty bounded transcripts', () => {
    const off = initialConversationState('a')
    expect(transitionConversation(off, { type: 'submit', text: 'hola' }).effects).toEqual({})
    const listening = transitionConversation(off, { type: 'start' }).state
    expect(transitionConversation(listening, { type: 'submit', text: '  ' }).state).toBe(listening)
    expect(transitionConversation(listening, { type: 'submit', text: 'x'.repeat(20_001) }).state).toBe(listening)
    const next = transitionConversation(listening, { type: 'submit', text: ' hola ' })
    expect(next.state.phase).toBe('thinking')
    expect(next.effects.submit?.text).toBe('hola')
    expect(transitionConversation(next.state, { type: 'submit', text: 'second' }).effects).toEqual({})
  })

  it('interrupts playback without cancelling or starting another agent run', () => {
    const { state, ticket } = begun()
    const speaking = transitionConversation(state, { type: 'audio-started', ticket }).state
    const interrupted = transitionConversation(speaking, { type: 'interrupt' })
    expect(interrupted.state.phase).toBe('thinking')
    expect(interrupted.effects).toEqual({ stopPlayback: true })
    expect(transitionConversation(interrupted.state, { type: 'audio-started', ticket }).state).toBe(interrupted.state)
    expect(transitionConversation(interrupted.state, { type: 'submit', text: 'next' }).effects).toEqual({})
    expect(transitionConversation(interrupted.state, { type: 'run-finished', ticket }).state.phase).toBe('listening')
  })

  it('ignores late callbacks after stop, restart and a new turn', () => {
    const { state, ticket } = begun()
    const stopped = transitionConversation(state, { type: 'stop' })
    expect(stopped.effects.stopPlayback).toBe(true)
    const restarted = transitionConversation(stopped.state, { type: 'start' }).state
    const newTurn = transitionConversation(restarted, { type: 'submit', text: 'nuevo' }).state
    for (const event of [
      { type: 'audio-started' as const, ticket },
      { type: 'run-finished' as const, ticket },
      { type: 'fail' as const, ticket, message: 'old error' },
    ]) expect(transitionConversation(newTurn, event).state).toBe(newTurn)
  })

  it('handles audio and run completion separately and recovers explicitly from error', () => {
    const { state, ticket } = begun()
    const speaking = transitionConversation(state, { type: 'audio-started', ticket }).state
    const thinking = transitionConversation(speaking, { type: 'audio-finished', ticket }).state
    expect(thinking.phase).toBe('thinking')
    const failed = transitionConversation(thinking, { type: 'fail', ticket, message: 'failed' })
    expect(failed.state.phase).toBe('error')
    expect(failed.effects.stopPlayback).toBe(true)
    expect(transitionConversation(failed.state, { type: 'submit', text: 'again' }).state).toBe(failed.state)
    expect(transitionConversation(failed.state, { type: 'start' }).state.phase).toBe('listening')
  })

  it('does not leak state across independent sessions', () => {
    const a = begun()
    let b: ConversationState = initialConversationState('b')
    b = transitionConversation(b, { type: 'start' }).state
    expect(b.phase).toBe('listening')
    b = transitionConversation(b, { type: 'submit', text: 'hello' }).state
    expect(transitionConversation(b, { type: 'audio-started', ticket: a.ticket }).state).toBe(b)
    expect(a.state.phase).toBe('thinking')
  })
})
