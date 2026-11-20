import { useEffect, useState } from 'react'
import type { SpeechStatus } from '../../../../shared/speech/types'
import styles from '../Settings/SettingsPanel.module.css'

/**
 * How each readiness state is shown. Only `verified_offline` may read as ready —
 * the mapping lives next to the UI that renders it so the wording and the
 * classification cannot drift.
 */
const READINESS_LABEL: Record<string, string> = {
  verified_offline: 'verified offline (checksums match)',
  unverified_files_present: 'files present, NOT verified — local speech stays off',
  corrupt: 'corrupt — a file does not match its recorded checksum',
  missing: 'missing',
  invalid_location: 'refused — outside the model folder, or a symbolic link',
}

export function VoiceSettings(): JSX.Element {
  const [engine, setEngine] = useState<'kokoro' | 'openai'>('kokoro')
  const [voice, setVoice] = useState('af_heart')
  const [key, setKey] = useState('')
  const [keySet, setKeySet] = useState(false)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<SpeechStatus | null>(null)
  const [notice, setNotice] = useState('')
  const [shortcut, setShortcut] = useState('')
  const [installing, setInstalling] = useState(false)
  const [lookahead, setLookahead] = useState<boolean | null>(null)
  const [savingLookahead, setSavingLookahead] = useState(false)
  const [kokoroFiles, setKokoroFiles] = useState<Awaited<ReturnType<typeof window.workspace.speech.kokoroStatus>> | null>(null)
  // VOX-A4c: artifact-level integrity, so "present" is never shown as "ready".
  const [models, setModels] = useState<Awaited<ReturnType<typeof window.workspace.speech.modelDiagnostics>> | null>(null)
  const [checkingModels, setCheckingModels] = useState(false)
  // A failed check must not look like "nothing to report": an unreadable model
  // folder is exactly when the panel matters.
  const [modelError, setModelError] = useState<string | null>(null)
  useEffect(() => {
    let mounted = true
    void window.workspace.speech.config().then((config) => {
      if (!mounted) return
      setShortcut(config.hotkey.enabled ? config.hotkey.shortcut : '')
      setLookahead(config.playback.prefetch_next_fragment)
      const profile = config.tts.profiles.find((item) => item.id === config.tts.active_profile_id)
      if (profile?.engine === 'openai' || profile?.engine === 'kokoro') { setEngine(profile.engine); setVoice(profile.voice) }
    }).catch((error: Error) => { if (mounted) setNotice(error.message) })
    const refreshInstall = (): void => { void window.workspace.speech.kokoroInstallStatus().then((s) => { if (mounted) setInstalling(s.busy) }).catch(() => {}) }
    refreshInstall()
    const timer = window.setInterval(refreshInstall, 2000)
    void window.workspace.speech.kokoroStatus().then((s) => { if (mounted) setKokoroFiles(s) }).catch(() => {})
    void window.workspace.speech.modelDiagnostics()
      .then((s) => { if (mounted) setModels(s) })
      .catch((error: Error) => { if (mounted) setModelError(error.message) })
    void window.workspace.speech.keyStatus().then((s) => { if (mounted) setKeySet(!!s.SPEECH_OPENAI_API_KEY) }).catch(() => {})
    void window.workspace.speech.status().then((s) => { if (mounted) setStatus(s) }).catch(() => {})
    const unsubscribe = window.workspace.speech.onEvent((event) => {
      if (event.type === 'state') setStatus(event.status)
      else if (event.type === 'error') setNotice(event.message)
      else if (!event.result.finished && event.result.error !== 'Cancelled') setNotice(event.result.error ?? 'Speech failed')
    })
    return () => { mounted = false; window.clearInterval(timer); unsubscribe() }
  }, [])
  const choose = async (next: 'kokoro' | 'openai'): Promise<void> => {
    const nextVoice = next === 'openai' ? 'alloy' : 'af_heart'
    try { await window.workspace.speech.selectEngine(next, nextVoice); setEngine(next); setVoice(nextVoice); setNotice('') }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not select engine') }
  }
  const saveKey = async (value: string): Promise<void> => {
    try { const s = await window.workspace.speech.setOpenAiKey(value); setKeySet(!!s.SPEECH_OPENAI_API_KEY); setKey(''); setNotice(value.trim() ? 'Key saved in secure storage.' : 'Stored key removed; environment overrides may still apply.') }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save key') }
  }
  const speak = async (): Promise<void> => {
    try { setNotice(''); await window.workspace.speech.speak(text) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not start speech') }
  }
  return <section className={styles.section} data-testid="settings-voice">
    <h3 className={styles.sectionTitle}>Voice</h3>
    <p className={styles.hint}>Read text aloud. OpenAI sends the text to OpenAI; Kokoro requires a separately installed local engine.</p>
    <div className={styles.segmented}>
      <button type="button" className={engine === 'kokoro' ? styles.segOn : styles.segOff} onClick={() => void choose('kokoro')}>Kokoro (local)</button>
      <button type="button" className={engine === 'openai' ? styles.segOn : styles.segOff} onClick={() => void choose('openai')}>OpenAI</button>
    </div>
    {engine === 'kokoro' && <div className={styles.field}>
      <p className={styles.hint}>The bundled Kokoro wrapper supports English voices only. Spanish and other local output languages need a different or extended adapter.</p>
      <button type="button" className={styles.btn} onClick={() => void window.workspace.speech.prepareKokoro().then((s) => { setKokoroFiles(s); setNotice('Project files prepared. Python dependencies and model files must still be installed separately.') }).catch((error: Error) => setNotice(error.message))}>Prepare Kokoro project files</button>
      <p className={styles.hint}>Installing dependencies downloads and runs third-party packages using uv. Model weights are not downloaded by this step.</p>
      <button type="button" className={styles.btn} disabled={installing || !kokoroFiles?.project || !kokoroFiles?.wrapper} onClick={() => {
        setInstalling(true)
        setNotice('Installing Kokoro dependencies…')
        void window.workspace.speech.installKokoroDependencies().then((s) => { setKokoroFiles(s); setNotice('Dependencies installed. Model files are still required.') }).catch((error: Error) => setNotice(error.message)).finally(() => setInstalling(false))
      }}>{installing ? 'Installing…' : 'Install Python dependencies'}</button>
      {installing && <button type="button" className={styles.btn} onClick={() => void window.workspace.speech.cancelKokoroInstall().catch((error: Error) => setNotice(error.message))}>Cancel dependency installation</button>}
      {kokoroFiles && <>
        <span>Project folder: {kokoroFiles.projectDir}</span>
        <span>Wrapper: {kokoroFiles.wrapper ? 'present' : 'missing'} · Project: {kokoroFiles.project ? 'present' : 'missing'} · Python environment: {kokoroFiles.environment ? 'present' : 'missing'}</span>
        <span>Duration model: {kokoroFiles.model ? 'present' : 'missing'} · Voices: {kokoroFiles.voices ? 'present' : 'missing'}</span>
        <span>Put kokoro-v1.0-duration.onnx and voices-v1.0.bin in its models folder. File presence is not a synthesis test; see docs/voice.md for details.</span>
        <button type="button" className={styles.btn} onClick={() => void window.workspace.speech.kokoroStatus().then(setKokoroFiles).catch((error: Error) => setNotice(error.message))}>Refresh file status</button>
      </>}
      <div data-testid="model-integrity">
        <span><strong>Local model integrity</strong> — files present is not the same as verified.</span>
        {models ? (
          <>
            <span className={styles.hint}>Checked {new Date(models.checkedAt).toLocaleString()} · manifest v{models.manifestVersion}</span>
            {models.models.map((m) => (
              <span key={m.id} data-model={m.id} data-readiness={m.readiness}>
                {m.label}: {READINESS_LABEL[m.readiness]}
                {m.counts.artifacts > 0 && ` (${m.counts.verified}/${m.counts.artifacts} verified`}
                {m.counts.unverified > 0 && `, ${m.counts.unverified} unverified`}
                {m.counts.corrupt > 0 && `, ${m.counts.corrupt} mismatched`}
                {m.counts.missing > 0 && `, ${m.counts.missing} missing`}
                {m.counts.artifacts > 0 && ')'}
                {m.recovery.map((hint) => (
                  <span key={hint.code} className={styles.hint}> · {hint.message}</span>
                ))}
              </span>
            ))}
          </>
        ) : <span className={styles.hint}>{modelError ? `Verification failed: ${modelError}` : 'Model integrity has not been checked yet.'}</span>}
        <button
          type="button"
          className={styles.btn}
          disabled={checkingModels}
          onClick={() => {
            setCheckingModels(true)
            setModelError(null)
            void window.workspace.speech.modelDiagnostics()
              .then((next) => { setModels(next); setModelError(null) })
              .catch((error: Error) => { setModelError(error.message); setNotice(error.message) })
              .finally(() => setCheckingModels(false))
          }}
        >{checkingModels ? 'Verifying…' : 'Verify model files'}</button>
        <span className={styles.hint}>Verification reads the files and compares pinned checksums offline. Nothing is downloaded, and no file is modified or removed.</span>
      </div>
    </div>}
    <label className={styles.field}>Voice
      <select className={styles.select} value={voice} onChange={(e) => {
        const next = e.target.value
        void window.workspace.speech.selectEngine(engine, next).then(() => setVoice(next)).catch((error: Error) => setNotice(error.message))
      }}>
        {(engine === 'openai' ? ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] : ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'am_adam', 'am_michael', 'bf_emma', 'bm_george']).map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
    </label>
    {engine === 'openai' && <label className={styles.field}>OpenAI API key ({keySet ? 'configured' : 'not configured'})
      <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
      <button className={styles.btn} type="button" disabled={!key.trim()} onClick={() => void saveKey(key)}>Save key securely</button>
      {keySet && <button className={styles.btn} type="button" onClick={() => void saveKey('')}>Remove stored key</button>}
    </label>}
    <label className={styles.field}>
      <span><input type="checkbox" checked={lookahead ?? false} disabled={savingLookahead || lookahead === null} onChange={(event) => {
        const enabled = event.target.checked
        setSavingLookahead(true)
        void window.workspace.speech.setLookahead(enabled).then(() => { setLookahead(enabled); setNotice('Playback setting saved for future readings.') }).catch((error: Error) => setNotice(error.message)).finally(() => setSavingLookahead(false))
      }} /> Prepare the next fragment during playback</span>
      <span className={styles.hint}>Prepares at most one next fragment to reduce gaps. Uses the selected engine, including cloud transmission when configured. This is not live token/audio streaming; off uses serial synthesis. Changes apply to future readings.</span>
    </label>
    <label className={styles.field}>Global read-clipboard shortcut (optional)
      <input value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="For example CommandOrControl+Shift+Y" />
    </label>
    <p className={styles.hint}>Saving enables a system-wide shortcut. It reads the clipboard on each press; cloud engines send that text to the provider. Clear and save to disable.</p>
    <button type="button" className={styles.btn} onClick={() => void window.workspace.speech.setHotkey(shortcut).then((s) => { setShortcut(s.shortcut); setNotice(s.shortcut ? 'Shortcut enabled.' : 'Shortcut disabled.') }).catch((error: Error) => setNotice(error.message))}>Save shortcut</button>
    <label className={styles.field}>Text to read
      <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={100000} />
    </label>
    <div className={styles.keyField}>
      <button type="button" className={styles.btn} disabled={!text.trim()} onClick={() => void speak()}>Speak</button>
      <button type="button" className={styles.btn} onClick={() => void window.workspace.speech.readClipboard().catch((error: Error) => setNotice(error.message))}>Read clipboard</button>
      <button type="button" className={styles.btn} disabled={!status?.speaking || !status.readingId} onClick={() => {
        const id = status?.readingId
        if (id) void window.workspace.speech.cancelReading(id).then((cancelled) => { if (!cancelled) setNotice('That reading has already ended.') }).catch((error: Error) => setNotice(error.message))
      }}>Stop current reading</button>
      <button type="button" className={styles.btn} disabled={!status?.speaking} onClick={() => void window.workspace.speech.stop().catch((error: Error) => setNotice(error.message))}>Stop all readings</button>
      <span className={styles.hint}>{status?.speaking ? (status.synthesizing ? 'Speaking or preparing audio…' : 'Speaking…') : 'Idle'}</span>
    </div>
    <p className={styles.hint}>Stopping the current reading leaves queued readings intact. Stopping all clears the queue. Neither stops an agent run or reverses its actions.</p>
    {notice && <p role="status" className={styles.errText}>{notice}</p>}
  </section>
}
