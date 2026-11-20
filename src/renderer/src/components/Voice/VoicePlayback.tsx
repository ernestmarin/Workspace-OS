import { useEffect } from 'react'

/** Global audio sink; it remains mounted while users change workspace surfaces. */
export function VoicePlayback(): null {
  useEffect(() => {
    let active: { id: string; source: AudioBufferSourceNode; context: AudioContext } | null = null
    let disposed = false
    const unsubscribe = window.workspace.speech.onPlayback((message) => {
      if (message.type === 'cancel') {
        if (active?.id === message.id) {
          const current = active
          active = null
          current.source.onended = null
          current.source.stop()
          void current.context.close()
        }
        return
      }
      if (active || disposed) { void window.workspace.speech.playbackDone(message.id, false); return }
      let context: AudioContext | undefined
      try {
        const bytes = atob(message.pcmBase64)
        if (bytes.length % (2 * message.channels) !== 0) throw new Error('Invalid PCM')
        const frames = bytes.length / (2 * message.channels)
        context = new AudioContext({ sampleRate: message.sampleRate })
        const buffer = context.createBuffer(message.channels, frames, message.sampleRate)
        for (let channel = 0; channel < message.channels; channel++) {
          const target = buffer.getChannelData(channel)
          for (let i = 0; i < frames; i++) {
            const offset = (i * message.channels + channel) * 2
            const value = bytes.charCodeAt(offset) | (bytes.charCodeAt(offset + 1) << 8)
            target[i] = (value >= 32768 ? value - 65536 : value) / 32768
          }
        }
        const gain = context.createGain()
        gain.gain.value = Math.max(0, Math.min(1, message.volume / 100))
        gain.connect(context.destination)
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(gain)
        const playbackContext = context
        active = { id: message.id, source, context }
        source.onended = () => {
          if (active?.id !== message.id) return
          active = null
          void playbackContext.close()
          void window.workspace.speech.playbackDone(message.id, true)
        }
        source.start()
        void context.resume().catch(() => {
          if (active?.id !== message.id) return
          active = null
          source.onended = null
          try { source.stop() } catch { /* already stopped */ }
          void playbackContext.close()
          void window.workspace.speech.playbackDone(message.id, false)
        })
      } catch {
        if (context) void context.close()
        active = null
        void window.workspace.speech.playbackDone(message.id, false)
      }
    })
    return () => {
      disposed = true
      unsubscribe()
      if (active) {
        active.source.onended = null
        try { active.source.stop() } catch { /* already stopped */ }
        void active.context.close()
        void window.workspace.speech.playbackDone(active.id, false)
      }
    }
  }, [])
  return null
}
