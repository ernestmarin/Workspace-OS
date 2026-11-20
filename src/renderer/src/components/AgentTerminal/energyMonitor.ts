import { EnergyEndpoint, rms } from './energyEndpoint'

/** Monitor microphone energy locally; no frames are sent or retained here. */
export function startEnergyMonitor(stream: MediaStream, onEndpoint: () => void, onUnavailable: () => void): () => void {
  let context: AudioContext | null = null
  let interval: ReturnType<typeof setInterval> | null = null
  let closed = false
  const cleanup = (): void => {
    if (closed) return
    closed = true
    if (interval) clearInterval(interval)
    interval = null
    if (context) void context.close().catch(() => {})
  }
  try {
    context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    // Keep the analyser in the rendering graph without audible microphone feedback.
    const silentGain = context.createGain()
    silentGain.gain.value = 0
    analyser.connect(silentGain)
    silentGain.connect(context.destination)
    const samples = new Float32Array(analyser.fftSize)
    const detector = new EnergyEndpoint()
    const activeContext = context
    void activeContext.resume().then(() => {
      if (closed) return
      interval = setInterval(() => {
        if (closed) return
        try {
          analyser.getFloatTimeDomainData(samples)
          if (detector.update(rms(samples), performance.now())) { cleanup(); onEndpoint() }
        } catch { cleanup(); onUnavailable() }
      }, 100)
    }).catch(() => { cleanup(); onUnavailable() })
  } catch {
    cleanup()
    onUnavailable()
  }
  return cleanup
}
