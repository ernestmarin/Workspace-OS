import { describe, expect, it } from 'vitest'
import { MicrophoneGrant } from './microphone-grant'

const main = { isMainFrame: true, requestingUrl: 'file:///app/index.html', mediaTypes: ['audio'] }

describe('microphone permission grant', () => {
  it('allows one audio-only request for the approved window and main frame', () => {
    const gate = new MicrophoneGrant(() => 100)
    gate.arm(7, main.requestingUrl)
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
      gate.arm(7, main.requestingUrl)
      expect(gate.consume(owner, url, detail)).toBe(false)
      expect(gate.consume(7, main.requestingUrl, main)).toBe(false)
    }
  })
  it('expires, clears and validates grants', () => {
    let now = 100
    const gate = new MicrophoneGrant(() => now)
    expect(() => gate.arm(0, '')).toThrow()
    gate.arm(7, main.requestingUrl)
    now += 10_000
    expect(gate.consume(7, main.requestingUrl, main)).toBe(false)
    gate.arm(7, main.requestingUrl)
    gate.clear()
    expect(gate.consume(7, main.requestingUrl, main)).toBe(false)
  })
})
