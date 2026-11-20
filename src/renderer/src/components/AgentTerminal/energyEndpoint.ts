/**
 * Conservative energy-based endpointing, not speech recognition. The caller
 * supplies monotonic time and measured RMS. It never fires before speech-like
 * energy has been sustained, and manual stop remains available.
 */
export class EnergyEndpoint {
  private candidateSince: number | null = null
  private detected = false
  private lastLoudAt: number | null = null
  private lastTime = -1
  private completed = false
  constructor(private readonly threshold = 0.025, private readonly startMs = 300, private readonly silenceMs = 1200) {}

  update(rms: number, timeMs: number): boolean {
    if (this.completed || !Number.isFinite(rms) || rms < 0 || !Number.isFinite(timeMs) || timeMs < this.lastTime) return false
    this.lastTime = timeMs
    if (rms >= this.threshold) {
      this.candidateSince ??= timeMs
      this.lastLoudAt = timeMs
      if (timeMs - this.candidateSince >= this.startMs) this.detected = true
      return false
    }
    this.candidateSince = null
    if (this.detected && this.lastLoudAt !== null && timeMs - this.lastLoudAt >= this.silenceMs) {
      this.completed = true
      return true
    }
    return false
  }
}

export function rms(samples: Float32Array): number {
  if (!samples.length) return 0
  let sum = 0
  for (const value of samples) {
    if (!Number.isFinite(value)) return 0
    sum += value * value
  }
  return Math.sqrt(sum / samples.length)
}
