import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './TerminalSession.module.css'

const MAX_RECORDING_MS = 30_000
const MAX_BYTES = 5 * 1024 * 1024
const SAMPLE_RATE = 16_000

type Phase = 'idle' | 'requesting' | 'recording' | 'transcribing'

/** Short push-to-talk dictation: result is placed in the input for user review. */
export function VoiceDictation({ active, onTranscript }: { active: boolean; onTranscript: (text: string) => void }): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const generation = useRef(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transcribing = useRef(false)
  const mounted = useRef(true)
  const activeRef = useRef(active)
  activeRef.current = active

  const discard = useCallback(() => {
    generation.current++
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const current = recorder.current
    recorder.current = null
    if (current && current.state !== 'inactive') { current.ondataavailable = null; current.onstop = null; try { current.stop() } catch { /* already stopped */ } }
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    void window.workspace.speech.revokeMicrophone().catch(() => {})
    if (transcribing.current) { transcribing.current = false; void window.workspace.speech.cancelTranscription().catch(() => {}) }
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; discard() }
  }, [discard])
  useEffect(() => {
    if (!active) { discard(); setPhase('idle') }
  }, [active, discard])

  const start = useCallback(async () => {
    if (!active || phase !== 'idle') return
    const id = ++generation.current
    const valid = (): boolean => mounted.current && activeRef.current && generation.current === id
    setError('')
    setPhase('requesting')
    try {
      const status = await window.workspace.speech.sttStatus()
      if (!valid()) return
      if (!status.filesPresent) throw new Error(`Install a compatible local Whisper model in ${status.modelDir} before dictating.`)
      if (status.busy) throw new Error('Local transcription is already in progress.')
      const allowed = await window.workspace.speech.authorizeMicrophone()
      if (!valid()) { if (allowed) await window.workspace.speech.revokeMicrophone(); return }
      if (!allowed) { setPhase('idle'); return }
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
      if (!valid()) { media.getTracks().forEach((track) => track.stop()); await window.workspace.speech.revokeMicrophone(); return }
      stream.current = media
      const chunks: Blob[] = []
      let size = 0
      let tooLarge = false
      const current = new MediaRecorder(media)
      recorder.current = current
      current.ondataavailable = (event) => {
        size += event.data.size
        if (size > MAX_BYTES) { tooLarge = true; chunks.length = 0; if (current.state !== 'inactive') current.stop(); return }
        if (event.data.size) chunks.push(event.data)
      }
      current.onerror = () => { if (valid()) { discard(); setError('Microphone recording failed.'); setPhase('idle') } }
      current.onstop = () => {
        media.getTracks().forEach((track) => track.stop())
        if (stream.current === media) stream.current = null
        if (recorder.current === current) recorder.current = null
        if (timer.current) clearTimeout(timer.current)
        timer.current = null
        void window.workspace.speech.revokeMicrophone().catch(() => {})
        if (!valid()) return
        setPhase('transcribing')
        void (async () => {
          let context: AudioContext | null = null
          try {
            if (tooLarge || !chunks.length) throw new Error('Recording is empty or too large.')
            const encoded = await new Blob(chunks, { type: current.mimeType }).arrayBuffer()
            if (!valid()) return
            context = new AudioContext()
            const decoded = await context.decodeAudioData(encoded)
            if (decoded.duration > 30.5 || decoded.duration < 0.1) throw new Error('Recording must be between 0.1 and 30 seconds.')
            const length = Math.min(SAMPLE_RATE * 30, Math.ceil(decoded.duration * SAMPLE_RATE))
            const offline = new OfflineAudioContext(1, length, SAMPLE_RATE)
            const source = offline.createBufferSource()
            source.buffer = decoded
            source.connect(offline.destination)
            source.start()
            const resampled = await offline.startRendering()
            if (!valid()) return
            transcribing.current = true
            const text = await window.workspace.speech.transcribeLocal(new Float32Array(resampled.getChannelData(0)), 'es')
            if (!valid()) return
            transcribing.current = false
            if (!text) throw new Error('No speech was recognized.')
            onTranscript(text)
          } catch (e) {
            if (valid()) transcribing.current = false
            if (valid()) setError(e instanceof Error ? e.message : 'Local transcription failed.')
          } finally {
            if (context) void context.close().catch(() => {})
            if (valid()) setPhase('idle')
          }
        })()
      }
      current.start(1000)
      if (!valid()) { discard(); return }
      setPhase('recording')
      timer.current = setTimeout(() => { if (current.state !== 'inactive') current.stop() }, MAX_RECORDING_MS)
    } catch (e) {
      if (valid()) { discard(); setError(e instanceof Error ? e.message : 'Could not start dictation.'); setPhase('idle') }
    }
  }, [active, phase, discard, onTranscript])

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }, [])
  const cancel = useCallback(() => { discard(); setPhase('idle'); setError('') }, [discard])

  return <span>
    {phase === 'idle' ? <button className={styles.modeToggle} type="button" disabled={!active} onClick={() => void start()} title="Record up to 30 seconds for local Spanish transcription; review before sending">🎙 Dictate locally (experimental)</button>
      : phase === 'recording' ? <button className={styles.modeToggle} type="button" onClick={stop}>■ Stop recording</button>
        : <span role="status">{phase === 'requesting' ? 'Requesting microphone…' : 'Transcribing locally…'}</span>}
    {phase !== 'idle' && <button className={styles.modeToggle} type="button" onClick={cancel}>Cancel</button>}
    {error && <span className={styles.statusError} role="alert">{error}</span>}
  </span>
}
