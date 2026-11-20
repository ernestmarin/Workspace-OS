import { describe, expect, it, vi } from 'vitest'
import { InterfaceCommandController } from './interfaceCommandController'

describe('InterfaceCommandController one-shot visual confirmation (VOX-U2 & VOX-U3)', () => {
  const ctx = { documentId: 'doc-1', tabId: 'tab-1', epoch: 1 }

  it('proposes an exact Spanish/English command without executing it, then executes once upon explicit visual confirmation', () => {
    const callbacks = {
      'show-agent': vi.fn(),
      'focus-agent-input': vi.fn(),
      'show-files': vi.fn(),
      'show-browser': vi.fn(),
      'show-voice-settings': vi.fn(),
    }
    const ctrl = new InterfaceCommandController({ ttlMs: 15_000 })

    const pending = ctrl.ingestFinalTranscript(
      'commands',
      ctx,
      { type: 'final', id: 'tr-1', context: ctx, text: 'abre archivos' },
      'es',
      1_000,
    )
    expect(pending).not.toBeNull()
    expect(pending?.proposal.command).toBe('show-files')
    // Recognition alone NEVER executes callbacks!
    expect(callbacks['show-files']).not.toHaveBeenCalled()

    // Explicit user click confirms once
    const ok = ctrl.confirm(pending!.proposalId, ctx, callbacks, 2_000)
    expect(ok).toBe(true)
    expect(callbacks['show-files']).toHaveBeenCalledTimes(1)

    // Replay of the same proposalId is rejected (one-shot)
    expect(ctrl.confirm(pending!.proposalId, ctx, callbacks, 2_001)).toBe(false)
    expect(callbacks['show-files']).toHaveBeenCalledTimes(1)
  })

  it('rejects expired proposals and invalidates pending confirmation on tab/epoch switch, hide, or stop', () => {
    const callbacks = {
      'show-agent': vi.fn(),
      'focus-agent-input': vi.fn(),
      'show-files': vi.fn(),
      'show-browser': vi.fn(),
      'show-voice-settings': vi.fn(),
    }
    const ctrl = new InterfaceCommandController({ ttlMs: 5_000 })

    const p1 = ctrl.ingestFinalTranscript(
      'commands',
      ctx,
      { type: 'final', id: 'tr-2', context: ctx, text: 'open browser' },
      'en',
      1_000,
    )!
    // Expired at t = 6_001
    expect(ctrl.confirm(p1.proposalId, ctx, callbacks, 6_001)).toBe(false)
    expect(callbacks['show-browser']).not.toHaveBeenCalled()

    // Fresh proposal invalidated by tab/epoch change
    const p2 = ctrl.ingestFinalTranscript(
      'commands',
      ctx,
      { type: 'final', id: 'tr-3', context: ctx, text: 'focus agent input' },
      'en',
      7_000,
    )!
    expect(ctrl.confirm(p2.proposalId, { ...ctx, tabId: 'tab-2' }, callbacks, 7_500)).toBe(false)
    ctrl.invalidate()
    expect(ctrl.current()).toBeNull()
    expect(ctrl.confirm(p2.proposalId, ctx, callbacks, 7_600)).toBe(false)
    expect(callbacks['focus-agent-input']).not.toHaveBeenCalled()
  })
})
