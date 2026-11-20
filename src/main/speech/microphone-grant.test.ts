import { describe, expect, it } from 'vitest'
import { MicrophoneGrant } from './microphone-grant'

const token = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
function arm(gate: MicrophoneGrant): void { gate.begin(token); gate.approve(token, 7, main.requestingUrl) }

const main = { isMainFrame: true, requestingUrl: 'file:///app/index.html', mediaTypes: ['audio'] }

describe('microphone permission grant', () => {
  it('allows one audio-only request for the approved window and main frame', () => {
    const gate = new MicrophoneGrant(() => 100)
    arm(gate)
    expect(gate.consume(7, main.requestingUrl, main)).toBe(true)
    expect(gate.consume(7, main.requestingUrl, main)).toBe(false)
  })
  it('fails closed for subframes, video, foreign windows, navigation, and missing types', () => {
    for (const [owner, url, detail] of [
      [8, main.requestingUrl, main],
      [7, 'https://evil.test', main],
      [7, main.requestingUrl, { ...main, requestingUrl: 'https://evil.test' }],
      [7, main.requestingUrl, { ...main, isMainFrame: false }],
      [7, main.requestingUrl, { ...main, mediaTypes: ['audio', 'video'] }],
      [7, main.requestingUrl, { ...main, mediaTypes: undefined }],
    ] as const) {
      const gate = new MicrophoneGrant(() => 100)
      arm(gate)
      expect(gate.consume(owner, url, detail)).toBe(false)
      expect(gate.consume(7, main.requestingUrl, main)).toBe(false)
    }
  })
  it('does not allow stale cleanup to revoke a different request', () => {
    const gate = new MicrophoneGrant()
    gate.begin(token)
    gate.revoke(other)
    expect(gate.approve(token, 7, main.requestingUrl)).toBe(true)
    gate.revoke(other)
    expect(gate.consume(7, main.requestingUrl, main)).toBe(true)
  })
  it('cannot approve a cancelled prompt, including after a newer request begins', () => {
    const gate = new MicrophoneGrant()
    gate.begin(token)
    expect(() => gate.begin(other)).toThrow('already open')
    gate.revoke(token)
    gate.begin(other)
    expect(gate.approve(token, 7, main.requestingUrl)).toBe(false)
    gate.revokePending(token)
    expect(gate.approve(other, 7, main.requestingUrl)).toBe(true)
    gate.revoke(other)
    expect(gate.consume(7, main.requestingUrl, main)).toBe(false)
  })
  it('expires, clears and validates grants', () => {
    let now = 100
    const gate = new MicrophoneGrant(() => now)
    expect(() => gate.begin('invalid')).toThrow()
    arm(gate)
    now += 10_000
    expect(gate.consume(7, main.requestingUrl, main)).toBe(false)
    arm(gate)
    gate.clear()
    expect(gate.consume(7, main.requestingUrl, main)).toBe(false)
  })
})
