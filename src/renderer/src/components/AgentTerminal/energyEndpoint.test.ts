import { describe, expect, it } from 'vitest'
import { EnergyEndpoint, rms } from './energyEndpoint'

describe('local energy endpoint', () => {
  it('never ends silence without a sustained start', () => {
    const gate = new EnergyEndpoint()
    expect(gate.update(0, 0)).toBe(false)
    expect(gate.update(0.5, 100)).toBe(false)
    expect(gate.update(0, 200)).toBe(false)
    expect(gate.update(0, 5000)).toBe(false)
  })
  it('ends once after sustained energy and silence', () => {
    const gate = new EnergyEndpoint()
    expect(gate.update(0.1, 0)).toBe(false)
    expect(gate.update(0.1, 300)).toBe(false)
    expect(gate.update(0, 1499)).toBe(false)
    expect(gate.update(0, 1500)).toBe(true)
    expect(gate.update(0, 2000)).toBe(false)
  })
  it('resets the silence clock when energy resumes and ignores invalid readings', () => {
    const gate = new EnergyEndpoint()
    gate.update(0.1, 0); gate.update(0.1, 300)
    gate.update(0, 800); gate.update(0.1, 900)
    expect(gate.update(NaN, 2000)).toBe(false)
    expect(gate.update(0, 100)).toBe(false)
    expect(gate.update(0, 2099)).toBe(false)
    expect(gate.update(0, 2100)).toBe(true)
  })
  it('calculates bounded sample energy', () => {
    expect(rms(new Float32Array())).toBe(0)
    expect(rms(new Float32Array([0.5, -0.5]))).toBe(0.5)
    expect(rms(new Float32Array([NaN]))).toBe(0)
  })
})
