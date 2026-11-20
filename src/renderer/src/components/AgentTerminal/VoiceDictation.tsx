import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './TerminalSession.module.css'
import { startEnergyMonitor } from './energyMonitor'
import { SUPPORTED_VOICE_LANGUAGES, dictationText, isRtlVoiceLanguage, voiceLanguageName, type VoiceLanguage } from './voiceDictationI18n'

const MAX_RECORDING_MS = 30_000
const MAX_BYTES = 5 * 1024 * 1024
const SAMPLE_RATE = 16_000

type Phase = 'idle' | 'requesting' | 'recording' | 'transcribing'

/** Short push-to-talk dictation: result is placed in the input for user review. */
export function VoiceDictation({ active, onTranscript }: { active: boolean; onTranscript: (text: string) => void }): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [autoEnd, setAutoEnd] = useState(false)
  const [language, setLanguage] = useState<VoiceLanguage>('es')
  const labels = dictationText(language)
  const generation = useRef(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopMonitor = useRef<(() => void) | null>(null)
  const permissionToken = useRef<string | null>(null)
  const transcribing = useRef<string | null>(null)
  const mounted = useRef(true)
  const activeRef = useRef(active)
  activeRef.current = active

  const discard = useCallback(() => {
    generation.current++
    stopMonitor.current?.()
    stopMonitor.current = null
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const current = recorder.current
    recorder.current = null
    if (current && current.state !== 'inactive') { current.ondataavailable = null; current.onstop = null; try { current.stop() } catch { /* already stopped */ } }
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    const token = permissionToken.current
    permissionToken.current = null
    if (token) void window.workspace.speech.revokeMicrophone(token).catch(() => {})
    const job = transcribing.current
    transcribing.current = null
    if (job) void window.workspace.speech.cancelTranscription(job).catch(() => {})
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
      const token = crypto.randomUUID()
      permissionToken.current = token
      const allowed = await window.workspace.speech.authorizeMicrophone(token)
      if (!valid()) { if (allowed) await window.workspace.speech.revokeMicrophone(token); return }
      if (!allowed) { permissionToken.current = null; setPhase('idle'); return }
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
      if (!valid()) { media.getTracks().forEach((track) => track.stop()); await window.workspace.speech.revokeMicrophone(token); return }
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
        stopMonitor.current?.()
        stopMonitor.current = null
        media.getTracks().forEach((track) => track.stop())
        if (stream.current === media) stream.current = null
        if (recorder.current === current) recorder.current = null
        if (timer.current) clearTimeout(timer.current)
        timer.current = null
        if (permissionToken.current === token) permissionToken.current = null
        void window.workspace.speech.revokeMicrophone(token).catch(() => {})
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
            if (!valid()) return
            if (decoded.duration > 30.5 || decoded.duration < 0.1) throw new Error('Recording must be between 0.1 and 30 seconds.')
            const length = Math.min(SAMPLE_RATE * 30, Math.ceil(decoded.duration * SAMPLE_RATE))
            const offline = new OfflineAudioContext(1, length, SAMPLE_RATE)
            const source = offline.createBufferSource()
            source.buffer = decoded
            source.connect(offline.destination)
            source.start()
            const resampled = await offline.startRendering()
            if (!valid()) return
            const job = crypto.randomUUID()
            transcribing.current = job
            const text = await window.workspace.speech.transcribeLocal(new Float32Array(resampled.getChannelData(0)), language, job)
            if (!valid()) return
            transcribing.current = null
            if (!text) throw new Error('No speech was recognized.')
            onTranscript(text)
          } catch (e) {
            if (valid()) transcribing.current = null
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
      if (autoEnd) stopMonitor.current = startEnergyMonitor(media, () => {
        if (valid() && current.state === 'recording') current.stop()
      }, () => { if (valid()) setError('Automatic end is unavailable. Use Stop recording.') })
      timer.current = setTimeout(() => { if (current.state !== 'inactive') current.stop() }, MAX_RECORDING_MS)
    } catch (e) {
      if (valid()) { discard(); setError(e instanceof Error ? e.message : 'Could not start dictation.'); setPhase('idle') }
    }
  }, [active, phase, autoEnd, language, discard, onTranscript])

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }, [])
  const cancel = useCallback(() => { discard(); setPhase('idle'); setError('') }, [discard])

  return <span lang={language} dir={isRtlVoiceLanguage(language) ? 'rtl' : 'ltr'}>
    <label>{labels.language}{' '}
      <select aria-label="Dictation language" value={language} disabled={!active || phase !== 'idle'} onChange={(event) => {
        const value = event.target.value
        if (SUPPORTED_VOICE_LANGUAGES.some((entry) => entry.code === value)) setLanguage(value as VoiceLanguage)
      }}>
        {SUPPORTED_VOICE_LANGUAGES.map((entry) => <option key={entry.code} value={entry.code} lang={entry.code}>{entry.name}</option>)}
      </select>
    </label>{' '}
    <label title={labels.autoStopTitle}>
      <input type="checkbox" checked={autoEnd} disabled={!active || phase !== 'idle'} onChange={(event) => setAutoEnd(event.target.checked)} /> {labels.autoStop}
    </label>{' '}
    {phase === 'idle' ? <button className={styles.modeToggle} type="button" disabled={!active} onClick={() => void start()} title={labels.dictateTitle.replace('{language}', voiceLanguageName(language))}>🎙 {labels.dictate}</button>
      : phase === 'recording' ? <button className={styles.modeToggle} type="button" onClick={stop}>■ {labels.stop}</button>
        : <span role="status">{phase === 'requesting' ? labels.requesting : labels.transcribing}</span>}
    {phase !== 'idle' && <button className={styles.modeToggle} type="button" onClick={cancel}>{labels.cancel}</button>}
    {error && <span className={styles.statusError} role="alert" dir="auto">{error}</span>}
  </span>
}
